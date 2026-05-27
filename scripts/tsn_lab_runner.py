from __future__ import annotations

import argparse
import json
import pathlib
from dataclasses import dataclass
from datetime import UTC, datetime

import paramiko


@dataclass(frozen=True)
class SshTarget:
    host: str
    username: str
    password: str
    port: int = 22


class JumpRunner:
    def __init__(self, jump: SshTarget) -> None:
        self.jump = jump
        self._jump_client: paramiko.SSHClient | None = None

    def __enter__(self) -> "JumpRunner":
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            self.jump.host,
            port=self.jump.port,
            username=self.jump.username,
            password=self.jump.password,
            timeout=10,
            allow_agent=False,
            look_for_keys=False,
        )
        self._jump_client = client
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._jump_client is not None:
            self._jump_client.close()
            self._jump_client = None

    def run_script(self, target_host: str, script: str, *, timeout: int = 120) -> dict[str, str | int]:
        if self._jump_client is None:
            raise RuntimeError("JumpRunner is not connected.")
        command = f"ssh -o BatchMode=yes -o StrictHostKeyChecking=no root@{target_host} bash -s"
        stdin, stdout, stderr = self._jump_client.exec_command(command, timeout=timeout)
        stdin.write(script)
        stdin.flush()
        stdin.channel.shutdown_write()
        output = stdout.read().decode(errors="replace")
        error = stderr.read().decode(errors="replace")
        exit_code = stdout.channel.recv_exit_status()
        return {"stdout": output, "stderr": error, "exit_code": exit_code}


def write_log(log_dir: pathlib.Path, filename: str, target_host: str, script: str, result: dict[str, str | int]) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).isoformat()
    content = (
        f"# target={target_host}\n"
        f"# utc={stamp}\n"
        f"# exit_code={result['exit_code']}\n\n"
        f"```bash\n{script.rstrip()}\n```\n\n"
        f"## STDOUT\n{result['stdout']}\n\n"
        f"## STDERR\n{result['stderr']}\n"
    )
    (log_dir / filename).write_text(content, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run board scripts through a jump host and save logs.")
    parser.add_argument("--jump-host", default="10.10.0.77")
    parser.add_argument("--jump-user", default="marc")
    parser.add_argument("--jump-password", default="1234")
    parser.add_argument("--target-host", required=True)
    parser.add_argument("--script-file", required=True)
    parser.add_argument("--log-file", required=True)
    parser.add_argument("--timeout", type=int, default=120)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    script = pathlib.Path(args.script_file).read_text(encoding="utf-8")
    log_file = pathlib.Path(args.log_file)
    jump = SshTarget(host=args.jump_host, username=args.jump_user, password=args.jump_password)

    with JumpRunner(jump) as runner:
        result = runner.run_script(args.target_host, script, timeout=args.timeout)

    write_log(log_file.parent, log_file.name, args.target_host, script, result)
    print(json.dumps({"target": args.target_host, "exit_code": result["exit_code"], "log_file": str(log_file)}))
    return int(result["exit_code"])


if __name__ == "__main__":
    raise SystemExit(main())
