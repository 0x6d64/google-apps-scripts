# Open Questions — Python Client Design

## Core interface & modes

1. **Dual-mode symmetry**: in JSON mode (`--json`), should validation errors be returned to the caller as JSON so a weak LLM can retry (e.g., "text exceeds 1000 chars, shorten and resubmit"), or should they fail silently to logs since the LLM may not act on them anyway?

2. **Program name**: keep it `gsnote` (universal identifier) or rename to something that signals it's now Python (e.g., `gsnote.py`, `note`, `pynote`)? Does it matter if it's a symlink or wrapper?

3. **Installation method**: should this be a standalone script (copy to `~/bin/gsnote`), a pip-installable package, or a Python module that users import? This affects versioning and updates.

## Configuration & secrets

4. **Config file format**: stick with environment variables + optional shell source file, or use an actual config file (e.g., TOML, INI, YAML)? Trade-off: TOML is cleaner but adds a new file format to maintain; env vars are simpler but less discoverable.

5. **Separate config for JSON mode**: should JSON mode allow different `GSNOTE_URL` or `GSNOTE_TOKEN` (e.g., for different webhooks or tokens per mode), or always use the same configuration?

6. **Token in stdin payload**: in JSON mode, should the client require the token in the stdin JSON (e.g., `{"token": "...", "source": "llm", ...}`) or always inject it from environment? Second option is cleaner (LLM never sees token) but means the JSON payload is incomplete without env setup.

## Idempotency & request handling

7. **Human-mode request IDs**: how should a human user provide a request ID? Optional flag like `gsnote --id "my-id" pebble "text"`, or omit the feature for human mode (only LLM mode uses it)?

8. **LLM-mode request IDs**: should the client auto-generate a UUID if the JSON doesn't include `id`, or require the LLM to supply one? Auto-generating means deduplication is always available; requiring means the LLM chooses whether to enable it.

9. **Retry strategy on transient errors**: should the client retry (hiding transient failures from the caller) or surface retry information (e.g., `{"ok": false, "error": "temporary error, please retry"}`) so the LLM or human can decide? If the webhook retries internally, does the client need to retry too?

## Output & logging

10. **JSON mode output verbosity**: should `{"ok": false, "error": "..."}` errors be detailed (e.g., "Google Sheets API quota exhausted, retry after 60s") or generic (e.g., "webhook error") to avoid confusing a weak LLM with too much context?

11. **Logging destination**: in both modes, should logs go to stderr, a log file, or both? Should JSON mode silence stdout except for the JSON response?

12. **Exit codes for JSON mode**: should `--json` mode still set exit codes (0 for success, 1 for error), or always exit 0 and let the LLM parse the JSON response?

## Timeout & resilience

13. **HTTP timeout**: what timeout is reasonable for the webhook POST? (e.g., 5 seconds, 30 seconds?) Should this be configurable?

14. **Backoff/retry on quota exhaustion**: if the webhook returns "API quota exhausted," should the client automatically retry with backoff, or return immediately so the caller decides?

## Dependencies & compatibility

15. **HTTP library choice**: use `urllib.request` (stdlib, zero deps) or `requests` (nicer API, one dependency via pip)? This affects how easy the setup is.

16. **Python version minimum**: support Python 3.6+, 3.8+, 3.10+, or 3.12+? Affects which stdlib features are available (e.g., `json` with default=False keyword, `tomllib` in 3.11+).

17. **Type hints**: add type annotations to the Python code for IDE/linting support, or keep it simple and untyped? Affects maintainability but not functionality.

## Human convenience

18. **Shell alias/function**: should the Python script be wrapped in a shell alias or function for ease of use, or just call the script directly? (e.g., `alias gsnote='python ~/bin/gsnote.py'` vs `gsnote` as a symlink)

19. **Interactive prompt mode**: should there be a fallback mode (e.g., `gsnote --prompt`) that launches an interactive editor if text is not provided, or keep it simple (text is always required)?

20. **Configuration wizard**: should there be a `gsnote --setup` command that walks the user through setting `GSNOTE_URL` and `GSNOTE_TOKEN`, or document it manually?
