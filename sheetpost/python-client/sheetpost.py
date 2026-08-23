#!/usr/bin/env python3
"""
sheetpost — submit notes to a Google Sheets webhook.
Python 3.10+, stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, Optional, TextIO


# --------------------------------------------------------------------------
# Exceptions
# --------------------------------------------------------------------------

class SheetpostError(Exception):
    """Base class for all sheetpost errors. `message` is the short,
    machine-safe string shown to the user / emitted in --json mode."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class ConfigError(SheetpostError):
    pass


class ValidationError(SheetpostError):
    pass


class _RetryableNetworkError(Exception):
    """Internal signal: a network-level failure eligible for retry."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


# --------------------------------------------------------------------------
# .env file loader
# --------------------------------------------------------------------------

def _load_env_file() -> dict[str, str]:
    """
    Load SHEETPOST_* variables from .env files.

    Checks:
        1. ~/.env (home directory, lower priority)
        2. ./.env (current directory, higher priority)

    Returns:
        dict of variables actually loaded and set.

    Behavior:
        - Reads KEY=VALUE format (one per line, # comments ignored)
        - Only loads SHEETPOST_* variables
        - Does not override existing os.environ values (explicit env vars win)
        - Silently skips missing files
        - Silently skips invalid lines
        - ./.env overrides ~/.env on conflicts
    """
    loaded: dict[str, str] = {}

    # Check home directory first (lower priority)
    home_env = Path.home() / ".env"
    if home_env.exists():
        try:
            _load_from_file(home_env, loaded)
        except (OSError, UnicodeDecodeError):
            pass

    # Check current directory (higher priority, can override home)
    cwd_env = Path(".env")
    if cwd_env.exists():
        try:
            _load_from_file(cwd_env, loaded)
        except (OSError, UnicodeDecodeError):
            pass

    return loaded


def _load_from_file(path: Path, loaded: dict[str, str]) -> None:
    """
    Load SHEETPOST_* variables from a single .env file.

    Updates *loaded* dict and os.environ in-place.
    Does not override explicit os.environ values (set outside .env files).
    Will override previous .env file values (cwd .env beats ~/.env).
    """
    lines = path.read_text().splitlines()

    for line in lines:
        # Skip comments and empty lines
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        # Parse KEY=VALUE
        if "=" not in line:
            continue

        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()

        # Only load SHEETPOST_* vars
        if not key.startswith("SHEETPOST_"):
            continue

        # Don't override explicit env vars (explicit env beats .env files)
        # But DO override previous .env file values (cwd .env beats ~/.env)
        if key in os.environ and key not in loaded:
            # This key was set outside .env (explicit), skip it
            continue

        # Set it and record it (will override previous .env values)
        os.environ[key] = value
        loaded[key] = value


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Note:
    """A single note to submit. Validation is explicit (call .validate()),
    not implicit on construction, so callers can build a Note first and
    decide how to report validation errors (stderr vs JSON)."""

    type: str
    text: str

    MAX_TEXT_LEN: ClassVar[int] = 1000
    MAX_TYPE_LEN: ClassVar[int] = 200

    def validate(self) -> None:
        if not isinstance(self.type, str) or not self.type.strip():
            raise ValidationError("missing type")
        if not isinstance(self.text, str) or not self.text.strip():
            raise ValidationError("missing text")
        if len(self.text) > self.MAX_TEXT_LEN:
            raise ValidationError("text too long")
        if len(self.type) > self.MAX_TYPE_LEN:
            raise ValidationError("type too long")

    def to_payload(self, token: str) -> dict:
        return {"token": token, "type": self.type, "text": self.text}


@dataclass(frozen=True)
class Config:
    url: str
    token: str

    @classmethod
    def from_env(cls) -> "Config":
        # Load .env files if present (~/.env and/or ./.env)
        _load_env_file()

        url = os.environ.get("SHEETPOST_URL")
        token = os.environ.get("SHEETPOST_TOKEN")

        if not url:
            raise ConfigError("SHEETPOST_URL not set")
        if not token:
            raise ConfigError("SHEETPOST_TOKEN not set")
        if not url.startswith("https://"):
            raise ConfigError("SHEETPOST_URL must use https")

        return cls(url=url, token=token)


@dataclass(frozen=True)
class SubmitResult:
    ok: bool
    error: Optional[str] = None

    def to_json(self) -> str:
        payload = {"ok": self.ok}
        if not self.ok:
            payload["error"] = self.error
        return json.dumps(payload)


# --------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------

class WebhookClient:
    """Handles submission of a Note to the configured webhook, including
    the retry policy (network errors only, 1 retry, 1s delay)."""

    TIMEOUT: ClassVar[int] = 5
    MAX_RETRIES: ClassVar[int] = 1
    RETRY_DELAY: ClassVar[int] = 1

    def __init__(self, config: Config):
        self.config = config

    def submit(self, note: Note) -> SubmitResult:
        payload = json.dumps(note.to_payload(self.config.token)).encode("utf-8")

        last_error = "unknown error"
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                return self._send(payload)
            except _RetryableNetworkError as e:
                last_error = e.message
                if attempt < self.MAX_RETRIES:
                    time.sleep(self.RETRY_DELAY)
                    continue
                return SubmitResult(ok=False, error=last_error)

        return SubmitResult(ok=False, error=last_error)  # unreachable, keeps type checkers happy

    def _send(self, payload: bytes) -> SubmitResult:
        request = urllib.request.Request(
            self.config.url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.TIMEOUT) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            # HTTP-level error (4xx/5xx): a webhook concern, not retryable.
            body = e.read().decode("utf-8", errors="replace")
            return self._parse_error_body(body, fallback=f"HTTP {e.code}")
        except urllib.error.URLError as e:
            # Network-level failure: retryable.
            raise _RetryableNetworkError(self._classify(e.reason)) from e
        except socket.timeout as e:
            raise _RetryableNetworkError("Connection timeout") from e
        except OSError as e:
            # Catch-all for socket-level errors not wrapped in URLError.
            raise _RetryableNetworkError(self._classify(e)) from e

        return self._parse_success_body(body)

    @staticmethod
    def _classify(reason: BaseException) -> str:
        """Classify by exception type, not message text (message text is
        platform-dependent and shouldn't be relied on for control flow)."""
        if isinstance(reason, socket.timeout):
            return "Connection timeout"
        if isinstance(reason, socket.gaierror):
            return "DNS lookup failed"
        if isinstance(reason, ConnectionRefusedError):
            return "Connection refused"
        return str(reason) or reason.__class__.__name__

    @staticmethod
    def _parse_success_body(body: str) -> SubmitResult:
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return SubmitResult(ok=False, error="malformed response")

        if not isinstance(data, dict) or "ok" not in data:
            return SubmitResult(ok=False, error="malformed response")

        if data.get("ok") is True:
            return SubmitResult(ok=True)

        return SubmitResult(ok=False, error=str(data.get("error", "unknown error")))

    @staticmethod
    def _parse_error_body(body: str, fallback: str) -> SubmitResult:
        try:
            data = json.loads(body)
            error = data.get("error", fallback) if isinstance(data, dict) else fallback
        except json.JSONDecodeError:
            error = fallback
        return SubmitResult(ok=False, error=error)


# --------------------------------------------------------------------------
# CLI runners
# --------------------------------------------------------------------------

class HumanModeCLI:
    def __init__(self, client: WebhookClient):
        self.client = client

    def run(self, note_type: Optional[str], text_parts: list[str]) -> int:
        text = " ".join(text_parts)
        note = Note(type=note_type, text=text)

        try:
            note.validate()
        except ValidationError as e:
            print(f"Error: {e.message}", file=sys.stderr)
            return 1

        result = self.client.submit(note)
        if result.ok:
            print("\u2713 Note saved")
            return 0
        print(f"\u2717 Error: {result.error}")
        return 1


class MachineModeCLI:
    def __init__(self, client: WebhookClient):
        self.client = client

    def run(self, stdin: TextIO) -> int:
        raw = stdin.read()

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            print(SubmitResult(ok=False, error="malformed JSON").to_json())
            return 1

        if not isinstance(data, dict):
            print(SubmitResult(ok=False, error="malformed JSON").to_json())
            return 1

        note = Note(type=data.get("type"), text=data.get("text"))

        try:
            note.validate()
        except ValidationError as e:
            print(SubmitResult(ok=False, error=e.message).to_json())
            return 1

        result = self.client.submit(note)
        print(result.to_json())
        return 0 if result.ok else 1


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Submit notes to a Google Sheets webhook",
        usage="sheetpost [--json] TYPE [TEXT ...]\n       sheetpost --json < input.json",
        epilog="""
EXAMPLES:

  Human mode (interactive):
    sheetpost phone "Call mom at 5pm"
    sheetpost desktop "Line 1\\nLine 2"

  Machine mode (JSON stdin/stdout):
    echo '{"type":"llm", "text":"User asked about Python"}' | sheetpost --json

  Typical JSON mode workflow:
    1. Generate JSON: {"type":"llm", "text":"..."}
    2. Pipe to sheetpost: | sheetpost --json
    3. Parse response: {"ok": true} or {"ok": false, "error": "..."}

CONFIGURATION:

  Use environment variables or .env files:
    export SHEETPOST_URL="https://script.google.com/macros/s/<script-id>/exec"
    export SHEETPOST_TOKEN="secret-token"

  Or create ~/.env or ./.env:
    SHEETPOST_URL=https://...
    SHEETPOST_TOKEN=secret

MACHINE MODE (--json):

  Input JSON schema:
    {"type": "string", "text": "string"}

  Output on success:
    {"ok": true}

  Output on error:
    {"ok": false, "error": "missing text"}

  Error codes:
    - missing type, missing text
    - text too long (>1000 chars), type too long (>200 chars)
    - malformed JSON
    - webhook unavailable, invalid response
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Machine mode: read JSON from stdin, write JSON to stdout (no human output)",
    )
    parser.add_argument("type", nargs="?", help="Note type identifier (e.g., pebble, phone, llm)")
    parser.add_argument("text", nargs="*", help="Note text (joined with spaces)")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    if sys.version_info < (3, 10):
        print("Error: Python 3.10+ required", file=sys.stderr)
        return 1

    parser = build_arg_parser()
    args = parser.parse_args(argv)

    try:
        config = Config.from_env()
    except ConfigError as e:
        print(f"Error: {e.message}", file=sys.stderr)
        return 1

    client = WebhookClient(config)

    if args.json:
        return MachineModeCLI(client).run(sys.stdin)

    if not args.type:
        parser.print_usage(sys.stderr)
        return 1

    return HumanModeCLI(client).run(args.type, args.text)


if __name__ == "__main__":
    sys.exit(main())