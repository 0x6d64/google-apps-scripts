# Python Client: `sheetpost` Requirements

## 1. Purpose

Implement a command-line tool to submit notes to the Google Sheets webhook.

Example usage:

```bash
# Direct arguments
sheetpost note "Remember to buy coffee"

# JSON input mode
echo '{"type": "llm", "text": "The user asked about Python"}' | sheetpost --json
```

## 2. Technical Requirements

### 2.1 Language and Dependencies

* **Language**: Python 3.10+
* **Dependencies**: Built-in libraries only (`json`, `urllib`, `argparse`, `sys`, `os`, `pathlib`).
* **External packages**: None.

### 2.2 Timeout

HTTP requests to the webhook have a 5-second timeout.

### 2.3 Retry Logic

* Retry only on network-level failures (refused, timeout, DNS, socket errors).
* Do not retry on HTTP errors (4xx, 5xx) or validation errors.
* Maximum of 1 retry (2 attempts total) with a 1-second delay between attempts.

## 3. Human Mode

### 3.1 Command Interface

```bash
sheetpost <type> <text...>
```

#### Parameters
* `<type>`: Required category identifier (no spaces).
* `<text...>`: Required note text (one or more arguments, joined with spaces).

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

Configure using environment variables or `.env` files.

#### Environment Variables
```bash
export SHEETPOST_URL="https://script.google.com/macros/d/.../usercontent"
export SHEETPOST_TOKEN="<secret-token>"
```

#### .env File
Place `.env` in the home directory (`~/.env`) or project directory (`./.env`):
```env
SHEETPOST_URL=https://script.google.com/macros/d/.../usercontent
SHEETPOST_TOKEN=<secret-token>
```

If variables are missing, the client prints an error and exits with code 1.

### 3.3 .env Loading Precedence

The client loads variables from `.env` files in this order of precedence (highest to lowest):
1. Environment variables set in the terminal.
2. `./.env` (current directory).
3. `~/.env` (home directory).

* Only loads variables prefixed with `SHEETPOST_`.
* Skips missing files and malformed lines.

### 3.4 Request Payload

```json
{
  "token": "<SHEETPOST_TOKEN>",
  "type": "<type>",
  "text": "<joined text>"
}
```

### 3.5 Response Handling

#### Success (HTTP 200 and `ok: true`)
Output:
```
✓ Note saved
```
Exit code: 0

#### Webhook Failure (HTTP error or `ok: false`)
Output:
```
✗ Error: <error message from webhook>
```
Exit code: 1

#### Network Error
Output:
```
✗ Network error: <reason>
```
Exit code: 1

#### Malformed Webhook Response
Output:
```
✗ Error: Invalid response from webhook
```
Exit code: 1

## 4. Machine Mode (`--json` flag)

Reads JSON from stdin and writes JSON to stdout.

### 4.1 Invocation

```bash
sheetpost --json
```

### 4.2 JSON Input Schema

```json
{
  "type": "llm",
  "text": "The observation to log"
}
```

#### Fields
* `type` (string): Required type identifier.
* `text` (string): Required note content.

Ignore unknown fields.

### 4.3 JSON Output Schema

#### Success Response
```json
{"ok": true}
```
Exit code: 0

#### Failure Response
```json
{"ok": false, "error": "<error message>"}
```
Exit code: 1

### 4.4 Machine Mode Semantics

* Output only JSON to stdout.
* No stderr output.
* Never print the token.

### 4.5 LLM Integration Example

```bash
echo '{"type": "llm", "text": "log text"}' | sheetpost --json
```

## 5. Security

* Do not print the token in logs, responses, or errors.
* Load token only from the environment or `.env` files.
* Ensure `SHEETPOST_URL` starts with `https://`.
* Escape JSON payload inputs.

## 6. Installation and Project Structure

### 6.1 Project Layout

```
sheetpost/
├── README.md
├── src/
│   └── sheetpost.py
├── test/
│   └── test_sheetpost.py
├── bin/
│   └── sheetpost
├── test.sh
└── ENV_INTEGRATION.md
```

### 6.2 Installation

Add the execution script to your PATH:

```bash
# Symlink option
mkdir -p ~/.local/bin
ln -s "$PWD/bin/sheetpost" ~/.local/bin/sheetpost
```

## 7. Validation and Error Handling

### 7.1 Input Validation

Validate:
1. `type` is present and non-empty.
2. `text` is present and non-empty.
3. `text` <= 1000 characters.
4. `type` <= 200 characters.

Error messages:
* `missing type`
* `missing text`
* `text too long`
* `type too long`
* `malformed JSON`

### 7.2 Configuration Validation

* Validate `SHEETPOST_URL` starts with `https://`.
* Validate required variables are non-empty.

## 8. Acceptance Criteria

The client is complete when:
1. It successfully appends entries to the Google Sheet.
2. Unicode, spaces, and multi-line notes work correctly.
3. Network failures are retried once, then reported.
4. Exit code matches the outcome (0 for success, 1 for error).
5. `--json` processes stdin and outputs stdout without logging to stderr.
6. Requires Python 3.10+ (checked at startup).
7. Uses standard library only.
