# sheetpost

Append rows to a Google Sheet via HTTPS POST requests.

## Architecture Flow

```text
[ Terminal / Cron / LLM ]
          │
          │ (POST with token + payload)
          ▼
   [ Google Apps Script Web App ]
          │
          │ (Auth validation + Auto-creation if sheet is missing)
          ▼
   [ Google Sheets Spreadsheet ]
```

## Setup

### Step 1: Deploy Webhook as Web App

1. **Create Google Sheet**: Create a blank sheet at [Google Sheets](https://sheets.google.com).
2. **Open Apps Script Editor**: Click **Extensions** → **Apps Script** from the spreadsheet menu.
3. **Add Webhook Files**: Replace or create files in the script editor matching `webhook/src/`:
   * `Code.gs`
   * `Config.gs`
   * `Utils.gs`
4. **Deploy Web App**:
   * Click **Deploy** → **New deployment**.
   * Click the gear icon and select **Web app**.
   * Set configuration:
     * **Description**: `sheetpost webhook`
     * **Execute as**: `Me (your-email@gmail.com)`
     * **Who has access**: `Anyone`
   * Click **Deploy** and authorize spreadsheet and Drive permissions.
   * Copy the **Web App URL** (e.g., `https://script.google.com/macros/s/AKfycb.../exec`).

### Step 2: Bootstrap and Retrieve Token

1. **Initialize Web App**: Open the Web App URL in a web browser.
2. **Retrieve Token**:
   * The initial visit triggers setup, generating default properties and a 256-bit `WEBHOOK_TOKEN`.
   * Copy the displayed `WEBHOOK_TOKEN` immediately.
   * Subsequent requests to this URL will return an "Access Denied" page.

### Step 3: Configure Python Client

Configure `SHEETPOST_URL` and `SHEETPOST_TOKEN` via environment variables or a `.env` file.

#### Environment Variables

Configure terminal environment (e.g., `.bashrc`, `.zshrc`):

```bash
export SHEETPOST_URL="https://script.google.com/macros/s/AKfycb.../exec"
export SHEETPOST_TOKEN="your_secure_webhook_token"
```

#### .env File

Create a `.env` file in `~/.env` or `./.env`:

```env
SHEETPOST_URL=https://script.google.com/macros/s/AKfycb.../exec
SHEETPOST_TOKEN=your_secure_webhook_token
```

## Client Usage

Run the client with the `--help` flag to view usage instructions and options.
