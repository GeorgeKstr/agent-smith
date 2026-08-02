"""Sandbox backends for isolated tool execution.

Provides:
- DirectSandboxBackend: runs commands directly on the host (default)
- DockerSandboxBackend: runs commands inside a Docker container

Usage:
    backend = get_sandbox_backend(db)
    result = backend.exec("python --version", timeout=30)
"""

from __future__ import annotations

import os
import shlex
import subprocess
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from .db import ProjectDB


class SandboxResult:
    """Result of a sandboxed command execution."""

    def __init__(self, exit_code: int, stdout: str, stderr: str, timed_out: bool = False):
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr
        self.timed_out = timed_out

    @property
    def success(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


class SandboxBackend(ABC):
    """Abstract base for sandbox backends."""

    @abstractmethod
    def exec(self, command: str, cwd: Path | str | None = None, timeout: int = 60, stdin_data: str | None = None) -> SandboxResult:
        """Execute a command and return the result."""
        ...

    @abstractmethod
    def name(self) -> str:
        """Human-readable name for this backend."""
        ...

    def close(self) -> None:
        """Clean up resources. Called when the backend is no longer needed."""
        pass


class DirectSandboxBackend(SandboxBackend):
    """Runs commands directly on the host (no isolation)."""

    def __init__(self, root_path: Path):
        self.root_path = root_path

    def name(self) -> str:
        return "direct"

    def exec(self, command: str, cwd: Path | str | None = None, timeout: int = 60, stdin_data: str | None = None) -> SandboxResult:
        parts = shlex.split(command)
        effective_cwd = cwd or self.root_path
        # Pipe sudo password if configured and command uses sudo
        sudo_pw = os.getenv("SMITH_SUDO_PASSWORD", "").strip()
        if sudo_pw and parts[0] == "sudo" and not stdin_data:
            # sudo needs -S to read password from stdin (not /dev/tty)
            if "-S" not in parts:
                parts.insert(1, "-S")
            stdin_data = sudo_pw + "\n"
        # Include common bin directories in PATH so locally-installed
        # tools (php, composer, node, go, cargo, etc.) are discoverable.
        env = os.environ.copy()
        user_bins = [
            p / "bin"
            for p in (
                Path.home() / ".local",
                Path.home() / ".cargo",
                Path.home() / ".npm-global",
                Path.home() / ".composer" / "vendor" / "bin",
                Path.home() / ".lmstudio" / "bin",
            )
        ]
        extra = [str(b) for b in user_bins if b.is_dir()]
        # Also check common system tool paths
        for sys_dir in ("/usr/local/bin", "/opt/homebrew/bin", "/usr/local/sbin"):
            if os.path.isdir(sys_dir) and sys_dir not in env.get("PATH", ""):
                extra.append(sys_dir)
        if extra:
            env["PATH"] = ":".join(extra + [env.get("PATH", "")])
        try:
            completed = subprocess.run(
                parts,
                cwd=effective_cwd,
                env=env,
                input=stdin_data,
                text=True,
                capture_output=True,
                timeout=max(1, min(int(timeout), 300)),
            )
            return SandboxResult(
                exit_code=completed.returncode,
                stdout=completed.stdout or "",
                stderr=completed.stderr or "",
            )
        except subprocess.TimeoutExpired:
            return SandboxResult(exit_code=-1, stdout="", stderr="", timed_out=True)
        except Exception as exc:
            return SandboxResult(exit_code=-1, stdout="", stderr=str(exc))


class DockerSandboxBackend(SandboxBackend):
    """Runs commands inside a Docker container.

    Mounts the project root at /workspace inside the container.
    Requires Docker to be installed and the user to have permissions.
    """

    def __init__(
        self,
        root_path: Path,
        image: str = "python:3.14-slim",
        extra_args: list[str] | None = None,
    ):
        self.root_path = root_path
        self.image = image
        self.extra_args = extra_args or []
        self._container_id: str | None = None

    def name(self) -> str:
        return f"docker:{self.image}"

    def _docker_cmd(self, command: str, timeout: int) -> list[str]:
        """Build the docker run command."""
        cmd = [
            "docker", "run", "--rm",
            "-v", f"{self.root_path}:/workspace:Z",
            "-w", "/workspace",
        ]
        # Add resource limits
        cmd.extend(["--memory", "2g"])
        cmd.extend(["--cpus", "2"])
        cmd.extend(self.extra_args)
        cmd.append(self.image)
        cmd.extend(["sh", "-c", command])
        return cmd

    def exec(self, command: str, cwd: Path | str | None = None, timeout: int = 60, stdin_data: str | None = None) -> SandboxResult:
        safe_timeout = max(5, min(int(timeout), 300))
        docker_cmd = self._docker_cmd(command, safe_timeout)
        try:
            completed = subprocess.run(
                docker_cmd,
                input=stdin_data,
                capture_output=True,
                text=True,
                timeout=safe_timeout + 10,  # extra buffer for Docker overhead
            )
            return SandboxResult(
                exit_code=completed.returncode,
                stdout=completed.stdout or "",
                stderr=completed.stderr or "",
            )
        except subprocess.TimeoutExpired:
            return SandboxResult(exit_code=-1, stdout="", stderr="", timed_out=True)
        except FileNotFoundError:
            return SandboxResult(
                exit_code=-1,
                stdout="",
                stderr="Docker not found. Install Docker or set sandbox.mode to 'none'.",
            )
        except Exception as exc:
            return SandboxResult(exit_code=-1, stdout="", stderr=str(exc))

    def close(self) -> None:
        pass


def get_sandbox_backend(db: ProjectDB) -> SandboxBackend:
    """Factory: read sandbox settings from DB and return the appropriate backend.

    Settings:
        sandbox.mode: "none" (default) | "docker"
        sandbox.image: Docker image name (default: "python:3.14-slim")
    """
    mode = db.get_setting("sandbox.mode", "none")
    root = db.root_path

    if mode == "docker":
        image = db.get_setting("sandbox.image", "python:3.14-slim")
        return DockerSandboxBackend(root, image=image)

    return DirectSandboxBackend(root)
