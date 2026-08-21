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
var MAX_ID_LENGTH = 100;
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

    if (entry.id) {
      const isDuplicate = handleIdempotency(spreadsheet, entry.id);
      if (isDuplicate) {
        Logger.log('Duplicate request id, skipping write: type=' + entry.type);
        return jsonResponse(true);
      }
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

  let id;
  if (body.id !== undefined && body.id !== null) {
    if (typeof body.id !== 'string' || body.id.length === 0) {
      return { valid: false, error: 'invalid id' };
    }
    if (body.id.length > MAX_ID_LENGTH) {
      return { valid: false, error: 'id exceeds ' + MAX_ID_LENGTH + ' characters' };
    }
    id = body.id;
  }

  return {
    valid: true,
    data: { text: body.text, type: body.type, id: id }
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
 * Idempotency check/record for a caller-supplied request id, per
 * requirements 2.6. Checking for an existing id and recording a new
 * one both happen under the same lock acquisition, so two concurrent
 * requests with the same id can't both pass the check.
 *
 * @param {Spreadsheet} spreadsheet
 * @param {string} id
 * @return {boolean} true if this id was already seen (caller should
 *   skip the write and return success), false if it's new.
 */
function handleIdempotency(spreadsheet, id) {
  const metadataSheet = getOrCreateMetadataSheet(spreadsheet);
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    if (isDuplicateId(metadataSheet, id)) {
      return true;
    }
    recordId(metadataSheet, id);
    return false;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Finds or creates the hidden "_metadata" sheet used to track
 * previously-seen request ids for idempotency (requirements 2.5, 2.6).
 *
 * @param {Spreadsheet} spreadsheet
 * @return {Sheet}
 */
function getOrCreateMetadataSheet(spreadsheet) {
  let sheet = spreadsheet.getSheetByName('_metadata');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('_metadata');
    sheet.appendRow(['Request ID', 'Timestamp (UTC)']);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

/**
 * @param {Sheet} metadataSheet
 * @param {string} id
 * @return {boolean}
 */
function isDuplicateId(metadataSheet, id) {
  const finder = metadataSheet.getRange('A:A').createTextFinder(id).matchEntireCell(true);
  return finder.findNext() !== null;
}

/**
 * @param {Sheet} metadataSheet
 * @param {string} id
 */
function recordId(metadataSheet, id) {
  metadataSheet.appendRow([id, nowUtcIso()]);
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
