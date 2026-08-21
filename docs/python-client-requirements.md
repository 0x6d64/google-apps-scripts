# Python Client — `sheetpost` Requirements

## 1. Purpose

Provide a command-line tool for submitting notes to the Google Sheets webhook from the shell or from a local LLM.

The `sheetpost` command allows humans, shell scripts, cron jobs, and LLM agents to quickly log text entries.

Example usage:

```bash
# Human mode
sheetpost note "Remember to buy coffee"

# LLM mode (receives structured input, produces structured output)
echo '{"type": "llm", "text": "The user asked about Python"}' | sheetpost --json
```

---

## 2. Technical requirements

### 2.1 Language and dependencies

- **Language**: Python 3.10+
- **Dependencies**: builtin only (`json`, `urllib`, `argparse`, `sys`, `os`, `uuid`)
- **No external packages** (`requests`, `httpx`, etc.)
- **Rationale**: simplicity, zero installation overhead, single-file deployment

### 2.2 Timeout

HTTP requests to the webhook shall have a **5-second timeout**. If the webhook does not respond within 5 seconds, the request fails with a network error message.

### 2.3 Retry logic

The client shall retry only on **network-level failures**:

- connection refused
- connection timeout
- DNS failure
- socket errors

The client shall **not retry** on HTTP errors (4xx, 5xx). Those are webhook concerns. Retry up to **1 time** (total 2 attempts) with a 1-second delay between attempts.

Do not retry on validation errors or malformed requests.

---

## 3. Human mode (command-line interface)

### 3.1 Command interface

```bash
sheetpost <type> <text...>
```

#### Parameters

- `<type>`: required type identifier (no spaces)
  - examples: `pebble`, `phone`, `desktop`, `terminal`, `cron`, `llm`, etc.

- `<text...>`: required note text (one or more arguments)
  - joined with spaces to form the complete note
  - supports spaces, punctuation, special characters
  - supports multi-line text via shell quoting

#### Examples

```bash
sheetpost pebble "Remember to buy coffee"
sheetpost phone Remember to call mom at 5pm
sheetpost desktop "Line 1
Line 2"
sheetpost desktop "He said \"hello\" to me"
sheetpost phone "Unicode: ă, é, 中文"
```

### 3.2 Configuration

Configuration via environment variables:

```bash
export SHEETPOST_URL="https://script.google.com/macros/d/.../usercontent"
export SHEETPOST_TOKEN="<your-secret-token>"
```

If either is unset, the client prints an error and exits with code 1:

```
Error: SHEETPOST_URL not set
Error: SHEETPOST_TOKEN not set
```

### 3.3 JSON payload (human mode)

The client constructs a JSON request:

```json
{
  "token": "<SHEETPOST_TOKEN>",
  "type": "<type>",
  "text": "<joined text>"
}
```

The `id` field is omitted unless the user explicitly provides `--id` (see 3.4).

### 3.4 Optional: request ID for idempotency

Users can optionally provide a request ID to enable idempotency (duplicate prevention):

```bash
sheetpost --id "my-request-123" pebble "My note"
```

If provided, the JSON includes:

```json
{
  "token": "...",
  "type": "pebble",
  "text": "My note",
  "id": "my-request-123"
}
```

**The client does not auto-generate IDs.** It is the caller's responsibility to provide a unique ID if idempotency is desired. This allows:

- humans to omit `--id` and permit duplicates on retries
- scripts to generate UUIDs, timestamps, or custom IDs as needed
- LLMs to include idempotency if their framework supports it

### 3.5 Response handling (human mode)

#### Success (HTTP 200 and `ok: true`)

```
✓ Note saved
```

Exit code 0.

#### Failure (HTTP error or `ok: false`)

```
✗ Error: <short error message from webhook>
```

Exit code 1.

#### Network error

```
✗ Network error: <reason>
```

Examples:

```
✗ Network error: Connection timeout
✗ Network error: DNS lookup failed
✗ Network error: Connection refused
```

Exit code 1.

#### Malformed webhook response

```
✗ Error: Invalid response from webhook
```

Exit code 1.

---

## 4. Machine mode (`--json` flag)

Machine mode is designed for automation: structured input via stdin, structured output to stdout. No human-readable formatting, no stderr output in this mode.

### 4.1 Invocation

```bash
sheetpost --json
```

Reads JSON from stdin, writes JSON to stdout.

### 4.2 JSON input schema

The client reads a single JSON object from stdin:

```json
{
  "type": "llm",
  "text": "The observation to log",
  "id": "optional-unique-request-id"
}
```

#### Required fields

- `type` (string): type identifier
- `text` (string): note content

#### Optional fields

- `id` (string): unique request ID for idempotency (caller must provide; client does not generate)

Unknown fields are ignored.

### 4.3 JSON output schema

The client writes a single JSON object to stdout:

```json
{"ok": true}
```

or

```json
{"ok": false, "error": "short error message"}
```

#### Success response

```json
{"ok": true}
```

Exit code 0.

#### Failure response

Possible error messages (short, machine-readable):

```json
[
{"ok": false, "error": "missing type"},
{"ok": false, "error": "missing text"},
{"ok": false, "error": "text too long"},
{"ok": false, "error": "type too long"},
{"ok": false, "error": "invalid token"},
{"ok": false, "error": "webhook unavailable"},
{"ok": false, "error": "malformed response"}
]
```

Exit code 1.

### 4.4 Machine mode semantics

- **No human-readable output**: only JSON to stdout
- **No logging to stderr**: stderr is silent (no debug info, no retries printed)
- **No token in output**: same security as human mode
- **Structured error messages**: caller can parse `error` field and act accordingly
- **Environment variables**: same as human mode (`SHEETPOST_URL`, `SHEETPOST_TOKEN`)

### 4.5 Example: LLM tool call flow

An LLM agent wants to log an observation:

```
LLM output:
{
  "tool": "sheetpost",
  "input": {"type": "llm", "text": "The user requested a Python script"}
}

Wrapper script calls:
echo '{"type": "llm", "text": "The user requested a Python script"}' | sheetpost --json

Client output to LLM:
{"ok": true}

If error:
{"ok": false, "error": "text too long"}
```

The LLM caller (or wrapper script) is responsible for:

- passing the JSON input to `sheetpost --json`
- parsing the JSON output
- handling errors (retry, log, notify)

---

## 5. Configuration

### 5.1 Environment variables

```bash
SHEETPOST_URL="https://script.google.com/macros/d/.../usercontent"
SHEETPOST_TOKEN="<secret-token>"
```

Both are required. If missing, the client exits with an error.

### 5.2 No config file

Environment variables only. Users can:

- export them in `.bashrc` or `.zshrc`
- pass them to the script: `SHEETPOST_URL="..." SHEETPOST_TOKEN="..." sheetpost pebble "note"`
- source from a shell script: `source ~/.sheetpost_env && sheetpost pebble "note"`

**Note**: if storing secrets in a file (e.g., `.sheetpost_env`), protect it:

```bash
chmod 600 ~/.sheetpost_env
```

---

## 6. Security

The client shall:

1. never print the token (not in logs, not in responses, not in error messages)
2. read the token only from `SHEETPOST_TOKEN` environment variable
3. use HTTPS only (validate that `SHEETPOST_URL` starts with `https://`)
4. not store credentials locally (environment variables only)
5. properly escape and encode JSON input using `json.dumps()` (prevent injection)

---

## 7. Installation and deployment

### 7.1 File structure in repository

```
sheetpost/
├── README.md
├── src/
│   ├── Code.gs
│   ├── Config.gs
│   └── Utils.gs
├── appsscript.json
├── src/
│   └── sheetpost.py
├── test/
│   └── test_sheetpost.py
└── examples/
    └── ollama_function_calling.json
```

### 7.2 Installation

1. **Clone or download the repository**:

```bash
git clone <repo-url>
cd sheetpost
```

2. **Install the client**:

```bash
# Option A: Add bin/ to PATH
export PATH="$PWD/bin:$PATH"

# Option B: Symlink to ~/.local/bin
mkdir -p ~/.local/bin
ln -s "$PWD/bin/sheetpost" ~/.local/bin/sheetpost
export PATH="$HOME/.local/bin:$PATH"

# Option C: Copy directly to /usr/local/bin (requires sudo)
sudo cp bin/sheetpost /usr/local/bin/sheetpost
```

3. **Set environment variables**:

```bash
export SHEETPOST_URL="https://script.google.com/macros/d/.../usercontent"
export SHEETPOST_TOKEN="<your-token-from-webhook-setup>"

# Optionally save to a shell script for later:
# ~/ .sheetpost_env
```

4. **Test**:

```bash
sheetpost pebble "test note"
```

### 7.3 The `bin/sheetpost` script

A single Python script (`#!/usr/bin/env python3`), executable, no extension:

```bash
chmod +x bin/sheetpost
```

The script should:

- have a shebang line: `#!/usr/bin/env python3`
- be runnable directly: `./bin/sheetpost pebble "test"`
- detect Python 3.10+ and fail with a clear error if an older version is used

---

## 8. Usage examples

### 8.1 Human mode

```bash
# Simple note
sheetpost phone "Call mom at 5pm"

# From a shell script
#!/bin/bash
sheetpost desktop "Backup completed at $(date)"

# From cron
0 9 * * * sheetpost cron "Daily backup started"

# With idempotency
sheetpost --id "backup-2025-01-15" cron "Daily backup started"

# Multi-line
sheetpost desktop "$(cat <<EOF
First observation
Second observation
Third observation
EOF
)"
```

### 8.2 Machine mode (LLM integration)

```bash
# From a Python wrapper script calling an LLM
import json
import subprocess

# LLM produces tool call
tool_input = {"type": "llm", "text": "User asked for help"}

# Call sheetpost
result = subprocess.run(
    ["sheetpost", "--json"],
    input=json.dumps(tool_input),
    capture_output=True,
    text=True
)

response = json.loads(result.stdout)
if response["ok"]:
    print("Note logged")
else:
    print(f"Error: {response['error']}")
```

```bash
# Direct invocation (shell)
echo '{"type": "llm", "text": "The user asked about Python"}' | sheetpost --json
```

---

## 9. LLM integration examples

### 9.1 Ollama function calling

Example tool definition for Ollama's function-calling mode:

```json
{
  "name": "sheetpost",
  "description": "Log an observation or note to the personal notes sheet",
  "parameters": {
    "type": "object",
    "properties": {
      "type": {
        "type": "string",
        "description": "type identifier (e.g., 'llm', 'pebble', 'phone')"
      },
      "text": {
        "type": "string",
        "description": "The note or observation to log (max 1000 chars)"
      },
      "id": {
        "type": "string",
        "description": "Optional: unique request ID for idempotency (to prevent duplicate entries)"
      }
    },
    "required": ["type", "text"]
  }
}
```

**Usage in Ollama prompt**:

```
You have access to the following tools:
{
  "type": "function",
  "function": {
    "name": "sheetpost",
    "description": "Log an observation or note to the personal notes sheet",
    "parameters": { ... (see above) }
  }
}

When you want to log something, output a tool call like:
{
  "tool": "sheetpost",
  "input": {"type": "llm", "text": "The user requested ..."}
}
```

### 9.2 Generic LLM prompt example

For LLMs without built-in function-calling support, instruct them to output JSON:

```
When you want to log a note, output:
{
  "tool": "sheetpost",
  "input": {
    "type": "llm",
    "text": "<what you want to log>"
  }
}

Example:
User: "What's 2+2?"
Assistant: The answer is 4.
{
  "tool": "sheetpost",
  "input": {
    "type": "llm",
    "text": "User asked: What's 2+2? Answer: 4"
  }
}
```

---

## 10. Error handling

### 10.1 Input validation

The client shall validate:

1. `type` is present and non-empty
2. `text` is present and non-empty
3. `text` does not exceed 1000 characters
4. `type` does not exceed 200 characters
5. `id` (if present) does not exceed 100 characters
6. JSON is valid (if in `--json` mode)

Error messages are short:

```
missing type
missing text
text too long
type too long
id too long
malformed JSON
```

### 10.2 Environment variable validation

If `SHEETPOST_URL` or `SHEETPOST_TOKEN` are missing, exit immediately with:

```
Error: SHEETPOST_URL not set
Error: SHEETPOST_TOKEN not set
```

Validate that `SHEETPOST_URL` starts with `https://` (not `http://`):

```
Error: SHEETPOST_URL must use https
```

### 10.3 Network errors

On network-level failures, retry up to 1 time (2 attempts total) with 1-second backoff.

If both attempts fail, print (human mode) or return (machine mode):

```
Network error: Connection timeout
Network error: DNS lookup failed
Network error: Connection refused
```

### 10.4 Webhook errors

If the webhook returns HTTP 4xx or 5xx, or `ok: false`:

**Human mode**:
```
✗ Error: <short error from webhook>
```

**Machine mode**:
```json
{"ok": false, "error": "<short error from webhook>"}
```

### 10.5 Malformed webhook response

If the webhook's response is not valid JSON or does not contain `ok` field:

**Human mode**:
```
✗ Error: Invalid response from webhook
```

**Machine mode**:
```json
{"ok": false, "error": "malformed response"}
```

---

## 11. Testing

### 11.1 Manual testing checklist

#### Setup (1 test)

1. configure `SHEETPOST_URL` and `SHEETPOST_TOKEN`
2. verify webhook is deployed and accessible
3. run `sheetpost pebble "test"` and verify row appears in spreadsheet

#### Human mode — valid requests (6 tests)

1. simple text: `sheetpost phone "Hello"`
2. text with spaces: `sheetpost phone "Remember to buy milk"`
3. text with punctuation: `sheetpost desktop "What's next? Do this!"`
4. text with quotes: `sheetpost desktop 'He said "hi" to me'`
5. multi-line text: `sheetpost desktop $'Line 1\nLine 2'`
6. Unicode: `sheetpost phone "Reminder: ă, é, 中文"`

#### Human mode — error cases (5 tests)

1. missing `SHEETPOST_URL`: `unset SHEETPOST_URL && sheetpost pebble "test"` → error
2. missing `SHEETPOST_TOKEN`: `unset SHEETPOST_TOKEN && sheetpost pebble "test"` → error
3. missing type: `sheetpost "test"` → usage error
4. missing text: `sheetpost pebble` → usage error
5. invalid token: set wrong token, run `sheetpost pebble "test"` → webhook error

#### Machine mode — valid requests (3 tests)

1. minimal input: `echo '{"type":"llm", "text":"test"}' | sheetpost --json` → `{"ok":true}`
2. with id: `echo '{"type":"llm", "text":"test", "id":"123"}' | sheetpost --json` → `{"ok":true}`
3. Unicode: `echo '{"type":"llm", "text":"ă, é, 中文"}' | sheetpost --json` → `{"ok":true}`

#### Machine mode — error cases (4 tests)

1. missing type: `echo '{"text":"test"}' | sheetpost --json` → `{"ok":false, "error":"missing type"}`
2. missing text: `echo '{"type":"llm"}' | sheetpost --json` → `{"ok":false, "error":"missing text"}`
3. text too long: `echo '{"type":"llm", "text":"...1001 chars..."}' | sheetpost --json` → `{"ok":false, "error":"text too long"}`
4. malformed JSON: `echo 'not json' | sheetpost --json` → `{"ok":false, "error":"malformed JSON"}`

#### Idempotency (1 test)

1. `sheetpost --id "test-123" pebble "test"` twice → one row created, same timestamp

**Test method**: manual invocation. Verify rows in spreadsheet and exit codes.

---

## 12. Acceptance criteria

The Python client is complete when:

1. `sheetpost pebble "test note"` submits to webhook and creates a row (with correct `SHEETPOST_URL` and `SHEETPOST_TOKEN`).
2. multi-word, multi-line, and Unicode text are stored correctly.
3. missing environment variables are caught with clear errors.
4. network errors and HTTP errors are caught and reported.
5. token is never printed or logged.
6. exit code is 0 on success, 1 on error.
7. `--json` mode reads structured JSON from stdin and writes structured JSON to stdout.
8. `--json` mode produces no stderr output.
9. machine mode error messages are short and machine-parseable.
10. human mode error messages are human-readable.
11. Python version 3.10+ is required and checked at startup.
12. uses only stdlib (no external dependencies).
13. `--id` flag in human mode allows optional idempotency (caller provides ID, not auto-generated).
14. client retries only on network errors, not on HTTP/validation errors.
15. Ollama function-calling example is included in the repository.

---

## Assumptions

- **Python 3.10+** is available on all deployment targets.
- **stdlib only**: `json`, `urllib`, `argparse`, `sys`, `os`, `uuid` (for reading IDs, not generating).
- **Single-user personal setup**: no concurrent LLM instances; low traffic volume.
- **Configuration via environment variables**: no config files, no secrets management system.
- **No auto-generated request IDs**: caller (human, script, or LLM) is responsible for providing `id` if idempotency is desired.
- **Short error messages for machines**: LLM callers need to parse errors and adjust; verbose errors are for humans in human mode.
- **Webhook already handles API-level retries**: client retries only network-level failures to avoid stacking retries.
