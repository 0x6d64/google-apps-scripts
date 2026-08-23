/**
 * Code.gs
 *
 * Main webhook entry point and request handling for the sheetpost
 * Apps Script Web App. See ../webhook-requirements.md for the full
 * specification this implements.
 */

var MAX_BODY_BYTES = 10 * 1024; // 10 KB, see requirements 2.3 / 5.4
var MAX_TEXT_LENGTH = 1000;
var MAX_TYPE_LENGTH = 200;
var LOCK_TIMEOUT_MS = 5000;
var RETRY_COUNT = 2;
var RETRY_DELAYS_MS = [1000, 3000];

/**
 * HTTP POST entry point. Every code path returns a JSON response
 * (see jsonResponse in Utils.gs) — see the note there on why the
 * HTTP status code itself is always 200.
 *
 * @param {Object} e Apps Script event object.
 * @return {ContentService.TextOutput}
 */
function doPost(e) {
  try {
    const config = getConfig();

    if (!config.webhookToken) {
      Logger.log('Rejected: WEBHOOK_TOKEN is not configured — run setup() first');
      return jsonResponse(false, 'server not configured');
    }

    if (!e.postData || !e.postData.contents) {
      Logger.log('Rejected: missing request body');
      return jsonResponse(false, 'missing request body');
    }

    if (e.postData.contents.length > MAX_BODY_BYTES) {
      Logger.log('Rejected: request body too large');
      return jsonResponse(false, 'request body too large');
    }

    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      Logger.log('Rejected: malformed JSON');
      return jsonResponse(false, 'malformed JSON');
    }

    const validation = validateRequest(body, config);
    if (!validation.valid) {
      Logger.log('Rejected: ' + validation.error);
      return jsonResponse(false, validation.error);
    }

    const entry = validation.data;

    let spreadsheet;
    try {
      spreadsheet = withRetry(
        function () { return getOrCreateSpreadsheet(config.spreadsheetName); },
        RETRY_COUNT,
        RETRY_DELAYS_MS
      );
    } catch (err) {
      Logger.log('Spreadsheet access failed: ' + err.message);
      return jsonResponse(false, quotaAwareMessage(err, 'unable to access spreadsheet'));
    }



    const sheet = getOrCreateSheet(spreadsheet, config.sheetName);
    const timestamp = nowUtcIso();

    try {
      withRetry(
        function () { return appendEntry(sheet, [timestamp, entry.text, entry.type]); },
        RETRY_COUNT,
        RETRY_DELAYS_MS
      );
    } catch (err) {
      Logger.log('Append failed: ' + err.message);
      return jsonResponse(false, quotaAwareMessage(err, 'unable to write entry'));
    }

    Logger.log('Request accepted: type=' + entry.type + ', text_length=' + entry.text.length);
    return jsonResponse(true);

  } catch (err) {
    // Catch-all: never let an unexpected exception escape as a raw
    // Apps Script error page. Details go to the log, not the client.
    Logger.log('Internal error: ' + (err && err.message) + '\n' + (err && err.stack));
    return jsonResponse(false, 'internal error');
  }
}

/**
 * Validates the parsed request body against the field rules in
 * requirements 2.1 / 2.3. Unknown fields are ignored.
 *
 * @param {*} body Parsed JSON body.
 * @param {{webhookToken: string}} config
 * @return {{valid: boolean, error: (string|undefined), data: (Object|undefined)}}
 */
function validateRequest(body, config) {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'invalid request body' };
  }

  if (typeof body.token !== 'string' || body.token.length === 0) {
    return { valid: false, error: 'missing token' };
  }
  if (body.token !== config.webhookToken) {
    return { valid: false, error: 'invalid token' };
  }

  if (typeof body.text !== 'string' || body.text.length === 0) {
    return { valid: false, error: 'missing text' };
  }
  if (body.text.length > MAX_TEXT_LENGTH) {
    return { valid: false, error: 'text exceeds ' + MAX_TEXT_LENGTH + ' characters' };
  }

  if (typeof body.type !== 'string' || body.type.length === 0) {
    return { valid: false, error: 'missing type' };
  }
  if (body.type.length > MAX_TYPE_LENGTH) {
    return { valid: false, error: 'type exceeds ' + MAX_TYPE_LENGTH + ' characters' };
  }

  return {
    valid: true,
    data: { text: body.text, type: body.type }
  };
}

/**
 * Finds the configured spreadsheet by name, or creates it if missing.
 * The resulting spreadsheet ID is cached in Script Properties so
 * later requests can open it directly by ID (fast path) instead of
 * searching by name every time. See requirements 2.5 "Auto-creation".
 *
 * @param {string} name
 * @return {Spreadsheet}
 */
function getOrCreateSpreadsheet(name) {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('SPREADSHEET_ID');

  if (cachedId) {
    try {
      return SpreadsheetApp.openById(cachedId);
    } catch (err) {
      Logger.log('Cached SPREADSHEET_ID is no longer valid, falling back to name lookup: ' + err.message);
    }
  }

  const files = DriveApp.getFilesByName(name);
  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      const spreadsheet = SpreadsheetApp.open(file);
      props.setProperty('SPREADSHEET_ID', spreadsheet.getId());
      return spreadsheet;
    }
  }

  Logger.log('Spreadsheet "' + name + '" not found, creating a new one');
  const spreadsheet = SpreadsheetApp.create(name);
  props.setProperty('SPREADSHEET_ID', spreadsheet.getId());
  return spreadsheet;
}

/**
 * Finds the configured worksheet within the spreadsheet, or creates
 * it with the standard header row if missing. If a blank default
 * "Sheet1" is left over from spreadsheet creation, it is removed.
 *
 * @param {Spreadsheet} spreadsheet
 * @param {string} sheetName
 * @return {Sheet}
 */
function getOrCreateSheet(spreadsheet, sheetName) {
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    sheet.appendRow(['Timestamp (UTC)', 'Text', 'Type']);
    sheet.setFrozenRows(1);
    removeBlankDefaultSheet(spreadsheet, sheetName);
  }

  return sheet;
}

/**
 * Removes the "Sheet1" tab Google creates by default on a brand new
 * spreadsheet, if it's empty and isn't the sheet we're actually using.
 * Purely cosmetic — keeps a freshly auto-created spreadsheet tidy.
 *
 * @param {Spreadsheet} spreadsheet
 * @param {string} keepSheetName
 */
function removeBlankDefaultSheet(spreadsheet, keepSheetName) {
  const defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getName() !== keepSheetName && defaultSheet.getLastRow() === 0) {
    spreadsheet.deleteSheet(defaultSheet);
  }
}

/**
 * Appends one row to the sheet under a script lock, to avoid
 * interleaved writes from concurrent requests corrupting rows. The
 * lock is held only for the append itself (requirements 2.5, 4.4).
 *
 * @param {Sheet} sheet
 * @param {Array} row
 */
function appendEntry(sheet, row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
}



/**
 * Picks a client-facing error message: the specific quota message
 * when the underlying error looks like a rate-limit/quota error,
 * otherwise the generic fallback (requirements 2.8, 2.10).
 *
 * @param {Error} err
 * @param {string} fallbackMessage
 * @return {string}
 */
function quotaAwareMessage(err, fallbackMessage) {
  return isQuotaError(err)
    ? 'Google Sheets API quota exhausted, please try again later'
    : fallbackMessage;
}


/**
 * HTTP GET entry point. Enables one-time automatic self-bootstrapping
 * when first deployed. Generates a WEBHOOK_TOKEN and outputs it in a
 * clean, easy-to-copy HTML layout. Subsequent requests are rejected.
 *
 * @param {Object} e Apps Script event object.
 * @return {HtmlService.HtmlOutput}
 */
function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const existingToken = props.getProperty('WEBHOOK_TOKEN');

  if (existingToken) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><title>Sheetpost Setup</title>' +
      '<style>body { font-family: sans-serif; padding: 40px; text-align: center; color: #333; background-color: #fcfcfc; } ' +
      '.card { max-width: 500px; margin: 40px auto; border: 1px solid #e0e0e0; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); background: #fff; } ' +
      'h1 { color: #d9534f; margin-top: 0; } ' +
      'p { font-size: 1.1em; line-height: 1.5; color: #666; }</style></head>' +
      '<body><div class="card"><h1>Access Denied</h1><p>Webhook is already configured. For security reasons, the existing token cannot be displayed or regenerated via this URL.</p></div></body></html>'
    );
  }

  const token = setup();

  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><title>Sheetpost Setup Complete</title>' +
    '<style>' +
    'body { font-family: sans-serif; padding: 40px; background-color: #f9f9f9; color: #333; } ' +
    '.card { max-width: 600px; margin: 0 auto; background: white; border: 1px solid #e0e0e0; padding: 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); } ' +
    'h1 { color: #2ca02c; margin-top: 0; } ' +
    '.token-box { background: #f1f1f1; border: 1px dashed #ccc; padding: 15px; font-family: monospace; font-size: 1.1em; word-break: break-all; margin: 20px 0; border-radius: 4px; user-select: all; } ' +
    'ol { padding-left: 20px; line-height: 1.6; } ' +
    'code { background: #eee; padding: 2px 5px; border-radius: 3px; font-family: monospace; }' +
    '</style></head>' +
    '<body><div class="card">' +
    '<h1>✓ Setup Complete</h1>' +
    '<p>Google Sheets Webhook has been successfully initialized!</p>' +
    '<p><strong>Your WEBHOOK_TOKEN is:</strong></p>' +
    '<div class="token-box">' + token + '</div>' +
    '<p style="color: #c9302c;"><strong>IMPORTANT:</strong> Copy this token now. It is stored securely in your Script Properties and will never be displayed here again.</p>' +
    '<h3>Next Steps:</h3>' +
    '<ol>' +
    '<li>Set your client-side environment variable:<br><code>export SHEETPOST_TOKEN="' + token + '"</code></li>' +
    '<li>Configure your client-side webhook URL to point to this Web App deployment URL.</li>' +
    '<li>Submit a test note!</li>' +
    '</ol>' +
    '</div></body></html>'
  );
}
