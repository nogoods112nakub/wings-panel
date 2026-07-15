import logging
import os
import docker
import docker.errors
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type, before_sleep_log

from daemon.config import DOCKER_URL, SERVERS_DIR, DOCKER_NETWORK

# Setup logger
logger = logging.getLogger("daemon.lifecycle")
logging.basicConfig(level=logging.INFO)

def is_docker_connection_error(exception):
    """
    Helper function to determine if the exception is due to Docker Daemon connection issues.
    """
    connection_classes = (
        docker.errors.DockerException,
        ConnectionError,
        ImportError  # In case of missing websocket/ssh imports inside docker package
    )
    return isinstance(exception, connection_classes) or "Connection refused" in str(exception)

class ContainerLifecycle:
    """
    Manages the lifecycle of Docker containers that host individual game servers.
    Leverages docker-py SDK and tenacity to ensure robust connections and retries.
    """
    
    def __init__(self):
        self.client = None
        self._connect_docker()

    def _connect_docker(self):
        """
        Attempts to establish a connection to the Docker Daemon.
        """
        try:
            logger.info(f"Connecting to Docker Daemon at {DOCKER_URL}...")
            self.client = docker.DockerClient(base_url=DOCKER_URL)
            self.client.ping()
            logger.info("Successfully connected to Docker Daemon.")
        except Exception as e:
            logger.error(f"Failed to connect to Docker Daemon: {e}. Will attempt lazy reconnect during operations.")
            self.client = None

    def get_client(self) -> docker.DockerClient:
        """
        Returns the active Docker Client. If the connection was lost or not established,
        it attempts to reconnect before proceeding.
        """
        if not self.client:
            self._connect_docker()
        if not self.client:
            raise docker.errors.DockerException("Docker Daemon is unreachable. Unable to perform container operations.")
        return self.client

    # Tenacity decorator: retry up to 5 times with exponential backoff if a connection error occurs
    @retry(
        retry=retry_if_exception_type(docker.errors.DockerException),
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True
    )
    def install_container(self, server_uuid: str, docker_image: str, cpu_limit: float, memory_limit_mb: int, disk_limit_mb: int, primary_port: int, allocations: list, startup_command: str) -> str:
        """
        Installs a new server container (downloads image, creates container, configures limits and allocations).
        
        - CPU Limit: 100.0 means 1 full CPU core. We map this using nano_cpus.
        - Memory Limit: Converted from MB to bytes.
        - Network Allocations: Maps host ports to container ports.
        - Volume Binding: Binds host server files directory (/srv/daemon/servers/<uuid>) to /home/container in container.
        """
        client = self.get_client()
        
        # 1. Pull the Docker Image
        logger.info(f"[{server_uuid}] Pulling image: {docker_image}")
        try:
            client.images.pull(docker_image)
        except docker.errors.ImageNotFound:
            logger.error(f"[{server_uuid}] Image '{docker_image}' not found.")
            raise
        except Exception as e:
            logger.error(f"[{server_uuid}] Failed to pull image: {e}")
            raise

        # 2. Setup server workspace on the host
        server_dir = os.path.join(SERVERS_DIR, server_uuid)
        os.makedirs(server_dir, exist_ok=True)
        
        # Make a mock game script or starter file if workspace is empty
        start_script = os.path.join(server_dir, "start.sh")
        if not os.path.exists(start_script):
            with open(start_script, "w") as f:
                f.write(f"#!/bin/bash\necho 'Starting game server on port {primary_port}...'\n{startup_command}\n")
            os.chmod(start_script, 0o755)

        # 3. Configure Resource Limits
        # nano_cpus = CPU Limit % / 100 * 1,000,000,000 nano CPUs (e.g. 100% = 1,000,000,000 nano cpus)
        nano_cpus = int((cpu_limit / 100.0) * 1_000_000_000)
        mem_limit_bytes = memory_limit_mb * 1024 * 1024
        
        # 4. Map Network Allocations
        # Pterodactyl maps host port directly to the same container port
        port_bindings = {}
        for alloc in allocations:
            # key: container port/proto, value: host port
            port_key = f"{alloc['port']}/tcp"
            port_bindings[port_key] = alloc['port']
            
            # Also map UDP for game protocols
            port_key_udp = f"{alloc['port']}/udp"
            port_bindings[port_key_udp] = alloc['port']

        # 5. Create container
        container_name = f"wings-{server_uuid}"
        logger.info(f"[{server_uuid}] Creating container: {container_name}")
        
        # Clean up any existing container with same name to avoid conflicts
        try:
            old_container = client.containers.get(container_name)
            logger.info(f"[{server_uuid}] Found legacy container, removing it.")
            old_container.remove(force=True)
        except docker.errors.NotFound:
            pass

        # Pterodactyl containers typically run with a specific environment
        environment = {
            "SERVER_PORT": str(primary_port),
            "STARTUP": startup_command,
            "TZ": "UTC"
        }

        container = client.containers.create(
            image=docker_image,
            name=container_name,
            command=["/bin/bash", "start.sh"],
            environment=environment,
            ports=port_bindings,
            volumes={
                server_dir: {
                    "bind": "/home/container",
                    "mode": "rw"
                }
            },
            working_dir="/home/container",
            nano_cpus=nano_cpus,
            mem_limit=mem_limit_bytes,
            memswap_limit=mem_limit_bytes,  # Disable swap (same limit as memory)
            network_mode=DOCKER_NETWORK,
            restart_policy={"Name": "no"},
            user="1000:1000",  # Non-privileged user inside container for isolation
            stdin_open=True,
            tty=True,
            detach=True
        )

        logger.info(f"[{server_uuid}] Container successfully created: {container.id}")
        return container.id

    @retry(
        retry=retry_if_exception_type(docker.errors.DockerException),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=5),
        reraise=True
    )
    def start_container(self, server_uuid: str):
        """Starts the server container."""
        client = self.get_client()
        container_name = f"wings-{server_uuid}"
        logger.info(f"[{server_uuid}] Starting container.")
        try:
            container = client.containers.get(container_name)
            container.start()
        except docker.errors.NotFound:
            logger.error(f"[{server_uuid}] Container not found for start operation.")
            raise

    @retry(
        retry=retry_if_exception_type(docker.errors.DockerException),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=5),
        reraise=True
    )
    def stop_container(self, server_uuid: str, timeout: int = 15):
        """Attempts a graceful stop of the server container."""
        client = self.get_client()
        container_name = f"wings-{server_uuid}"
        logger.info(f"[{server_uuid}] Stopping container gracefully (timeout={timeout}s).")
        try:
            container = client.containers.get(container_name)
            container.stop(timeout=timeout)
        except docker.errors.NotFound:
            logger.warning(f"[{server_uuid}] Container not found during stop. Nothing to stop.")
        except Exception as e:
            logger.error(f"[{server_uuid}] Error stopping container: {e}")
            raise

    @retry(
        retry=retry_if_exception_type(docker.errors.DockerException),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=5),
        reraise=True
    )
    def kill_container(self, server_uuid: str):
        """Forces container termination (SIGKILL)."""
        client = self.get_client()
        container_name = f"wings-{server_uuid}"
        logger.info(f"[{server_uuid}] Killing container.")
        try:
            container = client.containers.get(container_name)
            container.kill()
        except docker.errors.NotFound:
            logger.warning(f"[{server_uuid}] Container not found during kill.")
        except Exception as e:
            logger.error(f"[{server_uuid}] Error killing container: {e}")
            raise

    @retry(
        retry=retry_if_exception_type(docker.errors.DockerException),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=5),
        reraise=True
    )
    def delete_container(self, server_uuid: str):
        """Deletes the container and optionally removes its host files."""
        client = self.get_client()
        container_name = f"wings-{server_uuid}"
        logger.info(f"[{server_uuid}] Deleting container.")
        try:
            container = client.containers.get(container_name)
            container.remove(force=True)
        except docker.errors.NotFound:
            logger.warning(f"[{server_uuid}] Container not found during delete.")
            
        # Clean files
        server_dir = os.path.join(SERVERS_DIR, server_uuid)
        if os.path.exists(server_dir):
            logger.info(f"[{server_uuid}] Deleting host workspace directory: {server_dir}")
            try:
                import shutil
                shutil.rmtree(server_dir)
            except Exception as e:
                logger.error(f"[{server_uuid}] Error deleting host workspace files: {e}")

    def get_resource_usage(self, server_uuid: str) -> dict:
        """
        Collects real-time statistics (CPU, Memory, Disk) for the container.
        """
        client = self.get_client()
        container_name = f"wings-{server_uuid}"
        
        # 1. Fetch Disk Usage on host (files directory size in bytes)
        disk_usage_bytes = 0
        server_dir = os.path.join(SERVERS_DIR, server_uuid)
        if os.path.exists(server_dir):
            for dirpath, _, filenames in os.walk(server_dir):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    if os.path.exists(fp) and not os.path.islink(fp):
                        disk_usage_bytes += os.path.getsize(fp)

        # Convert to MB
        disk_usage_mb = round(disk_usage_bytes / (1024 * 1024), 2)

        try:
            container = client.containers.get(container_name)
            # Check if container is running
            state = container.attrs.get("State", {})
            status = state.get("Status", "unknown")
            
            if status != "running":
                return {
                    "status": status,
                    "cpu_percentage": 0.0,
                    "memory_bytes": 0,
                    "memory_mb": 0.0,
                    "disk_mb": disk_usage_mb
                }
            
            # Fetch docker stats (non-blocking call, stream=False)
            stats = container.stats(stream=False)
            
            # Calculate CPU percentage (requires delta CPU stats)
            cpu_stats = stats.get("cpu_stats", {})
            precpu_stats = stats.get("precpu_stats", {})
            
            cpu_usage = cpu_stats.get("cpu_usage", {}).get("total_usage", 0)
            precpu_usage = precpu_stats.get("cpu_usage", {}).get("total_usage", 0)
            
            system_cpu_usage = cpu_stats.get("system_cpu_usage", 0)
            presystem_cpu_usage = precpu_stats.get("system_cpu_usage", 0)
            
            # Get core count
            online_cpus = cpu_stats.get("online_cpus", len(cpu_stats.get("cpu_usage", {}).get("percpu_usage", [1])))
            if online_cpus == 0:
                online_cpus = 1

            cpu_percentage = 0.0
            cpu_delta = cpu_usage - precpu_usage
            system_delta = system_cpu_usage - presystem_cpu_usage
            
            if system_delta > 0.0 and cpu_delta > 0.0:
                cpu_percentage = (cpu_delta / system_delta) * online_cpus * 100.0
                cpu_percentage = round(cpu_percentage, 2)
            
            # Memory Stats
            mem_stats = stats.get("memory_stats", {})
            memory_bytes = mem_stats.get("usage", 0)
            # Docker memory limit can sometimes include cache. Pterodactyl subtracts cache:
            cache = mem_stats.get("stats", {}).get("cache", 0)
            if memory_bytes > cache:
                memory_bytes -= cache
                
            memory_mb = round(memory_bytes / (1024 * 1024), 2)
            
            return {
                "status": status,
                "cpu_percentage": cpu_percentage,
                "memory_bytes": memory_bytes,
                "memory_mb": memory_mb,
                "disk_mb": disk_usage_mb
            }
            
        except docker.errors.NotFound:
            return {
                "status": "not_found",
                "cpu_percentage": 0.0,
                "memory_bytes": 0,
                "memory_mb": 0.0,
                "disk_mb": disk_usage_mb
            }
        except Exception as e:
            logger.error(f"[{server_uuid}] Error collecting resource usage: {e}")
            return {
                "status": "error",
                "error": str(e),
                "cpu_percentage": 0.0,
                "memory_bytes": 0,
                "memory_mb": 0.0,
                "disk_mb": disk_usage_mb
            }
