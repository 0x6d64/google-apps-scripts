# sheetpost

Enter data into a Google Sheet with a simple `POST` request.

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


## How to Set Up

### Step 1: Deploy the Webhook as a Web App

1. **Create a Google Sheet**:
   - Open [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet.
   - Note down the name of your spreadsheet if you want to configure it later (by default, it will use `"Notes"`).

2. **Open the Apps Script Editor**:
   - From your spreadsheet, click on **Extensions** → **Apps Script**.
   - Alternatively, create a standalone script at [script.google.com](https://script.google.com).

3. **Add the Webhook Files**:
   - In the Apps Script editor, replace `Code.gs` and add other files to match the codebase files inside `webhook/src/`:
     - `Code.gs` (Main request handling)
     - `Config.gs` (Configuration & Setup)
     - `Utils.gs` (Helper and utilities)
   - *Note: If you use the command line, you can link the project and push the code directly using [clasp](docs/webhook-requirements.md#72-deployment-process).*

4. **Deploy as a Web App**:
   - In the upper right corner of the Apps Script editor, click **Deploy** → **New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Set the following configurations:
     - **Description**: `sheetpost webhook`
     - **Execute as**: `Me (your-email@gmail.com)`
     - **Who has access**: `Anyone`
   - Click **Deploy**.
   - Review and grant permissions (Google will ask you to authorize access to Google Sheets and Drive).
   - **Copy the Web App URL** (e.g., `https://script.google.com/macros/s/AKfycb.../exec`).

### Step 2: Self-Bootstrap and Generate Token

1. **Visit your Web App URL**:
   - Open your web browser and navigate to the **Web App URL** you copied in Step 1.
   - The script will automatically trigger the one-time self-bootstrapping setup:
     - It creates default configuration values (e.g. `SPREADSHEET_NAME` to `"Notes"`, `SHEET_NAME` to `"Notes"`, `TIMEZONE` to `UTC`).
     - It generates a cryptographically secure, random 256-bit `WEBHOOK_TOKEN`.
2. **Copy the Generated Token**:
   - The webpage will display: **`✓ Setup Complete`** along with your **`WEBHOOK_TOKEN`**.
   - **Copy the token immediately.** For security, this token is stored in your Script Properties and will *never* be shown on this page again. Subsequent visits to this URL will show a secure **"Access Denied"** page.

---

### Step 3: Configure the Python Client

The Python CLI client (`sheetpost.py`) needs to know your Web App URL and the generated webhook token.

You can configure them either as system environment variables or inside a `.env` file.

#### Option A: Create a `.env` file (Recommended)
Create a `.env` file in either your home directory (`~/.env`) or in the project directory (`./.env`):

```env
SHEETPOST_URL=https://script.google.com/macros/s/AKfycb.../exec
SHEETPOST_TOKEN=your_secure_webhook_token_here
```

#### Option B: Export Environment Variables
Export them in your terminal configuration (e.g., `.bashrc`, `.zshrc`):

```bash
export SHEETPOST_URL="https://script.google.com/macros/s/AKfycb.../exec"
export SHEETPOST_TOKEN="your_secure_webhook_token_here"
```

---

### How to Use the client

Use the `--help` flag to see all available options.
