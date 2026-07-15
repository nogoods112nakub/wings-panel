import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

from daemon.config import DAEMON_TOKEN
from daemon.container_lifecycle import ContainerLifecycle
from daemon.file_manager import FileManager, PathTraversalError
from panel.schemas import DaemonServerInstall, AllocationBase

logger = logging.getLogger("daemon.main")
logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Pterodactyl-like Game Server Daemon (Wings-Logic)",
    description="Local node daemon that controls Docker containers and streams console logs",
    version="1.0.0"
)

container_lifecycle = ContainerLifecycle()
file_manager = FileManager()

header_scheme = APIKeyHeader(name="X-Daemon-Token", auto_error=False)


def verify_token(token: Optional[str] = Depends(header_scheme)):
    if not token or token != DAEMON_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing Daemon Token")
    return token


class PowerAction(BaseModel):
    action: str

class FileWriteBody(BaseModel):
    path: str
    content: str

class FileFolderBody(BaseModel):
    path: str

class FileRenameBody(BaseModel):
    old_path: str
    new_path: str


# --- System Health Endpoint ---
@app.get("/api/system")
def system_info():
    import platform
    import os
    docker_ok = False
    try:
        client = container_lifecycle.get_client()
        client.ping()
        docker_ok = True
    except Exception:
        pass
    return {
        "version": "1.0.0",
        "docker_connected": docker_ok,
        "hostname": platform.node(),
        "servers_dir": os.getenv("SERVERS_DIR", "/srv/daemon/servers"),
        "docker_url": os.getenv("DOCKER_URL", "unix://var/run/docker.sock"),
    }


@app.get("/api/servers/{uuid}/status")
def server_status(uuid: str, token: Optional[str] = Depends(header_scheme)):
    if not token or token != DAEMON_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")
    stats = container_lifecycle.get_resource_usage(uuid)
    return stats


# --- Daemon REST Endpoints ---
@app.post("/api/servers", status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_token)])
def install_server(payload: DaemonServerInstall):
    try:
        container_id = container_lifecycle.install_container(
            server_uuid=payload.uuid,
            docker_image=payload.docker_image,
            cpu_limit=payload.cpu_limit,
            memory_limit_mb=payload.memory_limit,
            disk_limit_mb=payload.disk_limit,
            primary_port=payload.primary_port,
            allocations=[a.model_dump() for a in payload.allocations],
            startup_command=payload.startup_command
        )
        return {"status": "success", "container_id": container_id}
    except Exception as e:
        logger.error(f"[{payload.uuid}] Installation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/servers/{uuid}/power", dependencies=[Depends(verify_token)])
def power_server(uuid: str, payload: PowerAction):
    action = payload.action.lower()
    try:
        if action == "start":
            container_lifecycle.start_container(uuid)
        elif action == "stop":
            container_lifecycle.stop_container(uuid)
        elif action == "kill":
            container_lifecycle.kill_container(uuid)
        elif action == "restart":
            try:
                container_lifecycle.stop_container(uuid, timeout=5)
            except Exception:
                pass
            container_lifecycle.start_container(uuid)
        else:
            raise HTTPException(status_code=400, detail="Invalid power action")
        return {"status": "success", "action": action}
    except Exception as e:
        logger.error(f"[{uuid}] Power action '{action}' failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/servers/{uuid}/resources", dependencies=[Depends(verify_token)])
def server_resources(uuid: str):
    stats = container_lifecycle.get_resource_usage(uuid)
    if stats.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Container not found")
    return stats


@app.delete("/api/servers/{uuid}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_token)])
def delete_server(uuid: str):
    try:
        container_lifecycle.delete_container(uuid)
        return None
    except Exception as e:
        logger.error(f"[{uuid}] Deletion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- File Manager REST Endpoints ---
@app.get("/api/servers/{uuid}/files/list", dependencies=[Depends(verify_token)])
def list_files(uuid: str, path: str = ""):
    try:
        return file_manager.list_directory(uuid, path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Directory not found")
    except PathTraversalError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/servers/{uuid}/files/read", dependencies=[Depends(verify_token)])
def read_file(uuid: str, path: str):
    try:
        content = file_manager.read_file(uuid, path)
        return {"content": content}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except PathTraversalError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/servers/{uuid}/files/write", dependencies=[Depends(verify_token)])
def write_file(uuid: str, body: FileWriteBody):
    try:
        file_manager.write_file(uuid, body.path, body.content)
        return {"status": "success"}
    except PathTraversalError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/servers/{uuid}/files/folder", dependencies=[Depends(verify_token)])
def create_folder(uuid: str, body: FileFolderBody):
    try:
        file_manager.create_directory(uuid, body.path)
        return {"status": "success"}
    except PathTraversalError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/servers/{uuid}/files/delete", dependencies=[Depends(verify_token)])
def delete_file(uuid: str, path: str):
    try:
        file_manager.delete_path(uuid, path)
        return {"status": "success"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Path not found")
    except PathTraversalError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/servers/{uuid}/files/rename", dependencies=[Depends(verify_token)])
def rename_file(uuid: str, body: FileRenameBody):
    try:
        file_manager.rename_path(uuid, body.old_path, body.new_path)
        return {"status": "success"}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PathTraversalError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- WebSocket Console ---
def write_to_container_stdin(container, command: str):
    socket = container.attach_socket(params={"stdin": True, "stream": True})
    try:
        payload = (command + "\n").encode("utf-8")
        if hasattr(socket, "_sock") and socket._sock:
            socket._sock.send(payload)
        elif hasattr(socket, "send"):
            socket.send(payload)
        elif hasattr(socket, "write"):
            socket.write(payload)
        else:
            import os
            os.write(socket.fileno(), payload)
    finally:
        socket.close()


@app.websocket("/api/servers/{uuid}/console")
async def server_console_websocket(websocket: WebSocket, uuid: str, token: str = Query(None)):
    if not token or token != DAEMON_TOKEN:
        await websocket.accept()
        await websocket.close(code=4001, reason="Invalid token")
        return

    client = container_lifecycle.get_client()
    container_name = f"wings-{uuid}"
    try:
        container = client.containers.get(container_name)
    except Exception:
        await websocket.accept()
        await websocket.close(code=4004, reason="Container not found")
        return

    await websocket.accept()
    logger.info(f"[{uuid}] WebSocket console client connected.")

    log_queue = asyncio.Queue(maxsize=200)
    loop = asyncio.get_running_loop()
    thread_pool = ThreadPoolExecutor(max_workers=1)

    def read_docker_logs():
        try:
            stream = container.logs(stdout=True, stderr=True, stream=True, follow=True, tail=100)
            for chunk in stream:
                line = chunk.decode("utf-8", errors="replace")
                asyncio.run_coroutine_threadsafe(log_queue.put(line), loop)
        except Exception as e:
            logger.error(f"[{uuid}] Error reading log stream: {e}")
        finally:
            asyncio.run_coroutine_threadsafe(log_queue.put(None), loop)

    loop.run_in_executor(thread_pool, read_docker_logs)

    async def ws_writer_task():
        try:
            while True:
                log_chunk = await log_queue.get()
                if log_chunk is None:
                    break
                await websocket.send_text(log_chunk)
                log_queue.task_done()
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error(f"[{uuid}] WS writer error: {e}")

    async def ws_reader_task():
        try:
            while True:
                command = await websocket.receive_text()
                await loop.run_in_executor(None, write_to_container_stdin, container, command)
        except WebSocketDisconnect:
            logger.info(f"[{uuid}] Console client disconnected.")
        except Exception as e:
            logger.error(f"[{uuid}] WS reader error: {e}")

    writer_task = asyncio.create_task(ws_writer_task())
    reader_task = asyncio.create_task(ws_reader_task())

    done, pending = await asyncio.wait([writer_task, reader_task], return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    thread_pool.shutdown(wait=False)
    logger.info(f"[{uuid}] Console WebSocket session cleaned up.")
