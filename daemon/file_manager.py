import os
import shutil
from typing import List, Dict, Any

from daemon.config import SERVERS_DIR

class PathTraversalError(PermissionError):
    """Exception raised when an operation attempts to access files outside the server root directory."""
    pass

class FileManager:
    """
    Safe file system operations wrapper designed to prevent directory traversal vulnerabilities.
    Enforces a strict sandbox within each server's root directory: /srv/daemon/servers/<server_uuid>
    """

    def _resolve_safe_path(self, server_uuid: str, relative_path: str) -> str:
        """
        Normalizes and resolves a target path, ensuring it lies strictly within the server's root folder.
        Uses realpath to resolve symlinks and '..' parent directory references.
        """
        # 1. Clean the server uuid to prevent traversal through the server folder name itself
        clean_uuid = os.path.basename(server_uuid)
        server_root = os.path.realpath(os.path.join(SERVERS_DIR, clean_uuid))

        # 2. Normalize and strip leading separators from user input to force it to join as a relative path
        cleaned_rel_path = relative_path.lstrip("/\\")
        joined_path = os.path.join(server_root, cleaned_rel_path)
        
        # 3. Resolve actual absolute path (handles relative references like ..)
        resolved_path = os.path.realpath(joined_path)

        # 4. Check if the server root is the common prefix.
        try:
            common_prefix = os.path.commonpath([server_root, resolved_path])
            if common_prefix != server_root:
                raise PathTraversalError(
                    f"Access Denied: Path '{relative_path}' lies outside the container sandbox."
                )
        except ValueError:
            # Raised if paths are on different drives on Windows
            raise PathTraversalError("Access Denied: Target path resides on a different volume.")

        return resolved_path

    def list_directory(self, server_uuid: str, relative_path: str = "") -> List[Dict[str, Any]]:
        """
        Lists files and subdirectories within a server's directory.
        """
        target_dir = self._resolve_safe_path(server_uuid, relative_path)
        
        if not os.path.exists(target_dir):
            raise FileNotFoundError("Directory not found")
        if not os.path.isdir(target_dir):
            raise NotADirectoryError("Path is not a directory")

        results = []
        for entry in os.scandir(target_dir):
            stat = entry.stat()
            results.append({
                "name": entry.name,
                "is_directory": entry.is_dir(),
                "size": stat.st_size if entry.is_file() else 0,
                "modified_at": stat.st_mtime
            })
        
        # Sort directories first, then alphabetically
        results.sort(key=lambda x: (not x["is_directory"], x["name"].lower()))
        return results

    def read_file(self, server_uuid: str, relative_path: str) -> str:
        """
        Reads the contents of a text file inside the server workspace.
        """
        target_file = self._resolve_safe_path(server_uuid, relative_path)
        
        if not os.path.exists(target_file):
            raise FileNotFoundError("File not found")
        if not os.path.is_file(target_file):
            raise IsADirectoryError("Target path is a directory, not a file")

        with open(target_file, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    def write_file(self, server_uuid: str, relative_path: str, content: str) -> None:
        """
        Writes (or overwrites) a file within the server workspace.
        """
        target_file = self._resolve_safe_path(server_uuid, relative_path)
        
        # Ensure parent directory exists
        os.makedirs(os.path.dirname(target_file), exist_ok=True)
        
        with open(target_file, "w", encoding="utf-8") as f:
            f.write(content)

    def create_directory(self, server_uuid: str, relative_path: str) -> None:
        """
        Creates a new directory within the server workspace.
        """
        target_dir = self._resolve_safe_path(server_uuid, relative_path)
        os.makedirs(target_dir, exist_ok=True)

    def delete_path(self, server_uuid: str, relative_path: str) -> None:
        """
        Deletes a file or directory within the server workspace.
        """
        target_path = self._resolve_safe_path(server_uuid, relative_path)
        
        if not os.path.exists(target_path):
            raise FileNotFoundError("Path not found")
            
        if os.path.isdir(target_path):
            shutil.rmtree(target_path)
        else:
            os.remove(target_path)

    def rename_path(self, server_uuid: str, old_relative_path: str, new_relative_path: str) -> None:
        """
        Renames or moves a file/directory within the server workspace.
        Ensures both paths resolve safely within the sandbox.
        """
        old_path = self._resolve_safe_path(server_uuid, old_relative_path)
        new_path = self._resolve_safe_path(server_uuid, new_relative_path)
        
        if not os.path.exists(old_path):
            raise FileNotFoundError(f"Source file not found: {old_relative_path}")
            
        # Ensure target's parent folder exists
        os.makedirs(os.path.dirname(new_path), exist_ok=True)
        
        shutil.move(old_path, new_path)
