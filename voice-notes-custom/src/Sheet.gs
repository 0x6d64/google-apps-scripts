/**
 * Sheet.gs
 *
 * Webhook validation and Google Sheets entry logging.
 */

var MAX_BODY_BYTES = 10 * 1024;
var MAX_TEXT_LENGTH = 1000;
var MAX_TYPE_LENGTH = 200;
var LOCK_TIMEOUT_MS = 5000;
var RETRY_COUNT = 2;
var RETRY_DELAYS_MS = [1000, 3000];

/**
 * Handles direct webhook entry logging.
 * Validates the shared secret, checks text/type lengths, appends row to sheet.
 *
 * @param {string} token Shared secret from request
 * @param {string} text Entry text
 * @param {string} type Entry type
 * @return {{ok: boolean, error: (string|undefined)}}
 */
function handleSheetWebhook(token, text, type) {
  try {
    const config = getConfig();

    if (!config.sharedSecret) {
      Logger.log('Rejected: SHARED_SECRET is not configured — run setup() first');
      return { ok: false, error: 'server not configured' };
    }

    if (token !== config.sharedSecret) {
      Logger.log('Rejected: invalid token');
      return { ok: false, error: 'invalid token' };
    }

    if (typeof text !== 'string' || text.length === 0) {
      Logger.log('Rejected: missing text');
      return { ok: false, error: 'missing text' };
    }
    if (text.length > MAX_TEXT_LENGTH) {
      Logger.log('Rejected: text too long');
      return { ok: false, error: 'text exceeds ' + MAX_TEXT_LENGTH + ' characters' };
    }

    if (typeof type !== 'string' || type.length === 0) {
      Logger.log('Rejected: missing type');
      return { ok: false, error: 'missing type' };
    }
    if (type.length > MAX_TYPE_LENGTH) {
      Logger.log('Rejected: type too long');
      return { ok: false, error: 'type exceeds ' + MAX_TYPE_LENGTH + ' characters' };
    }

    let spreadsheet;
    try {
      spreadsheet = withRetry(
        function () { return getOrCreateSpreadsheet(config.spreadsheetName); },
        RETRY_COUNT,
        RETRY_DELAYS_MS
      );
    } catch (err) {
      Logger.log('Spreadsheet access failed: ' + err.message);
      return { ok: false, error: quotaAwareMessage(err, 'unable to access spreadsheet') };
    }

    const sheet = getOrCreateSheet(spreadsheet, config.sheetName);
    const timestamp = nowUtcIso();

    try {
      withRetry(
        function () { return appendEntry(sheet, [timestamp, text, type]); },
        RETRY_COUNT,
        RETRY_DELAYS_MS
      );
    } catch (err) {
      Logger.log('Append failed: ' + err.message);
      return { ok: false, error: quotaAwareMessage(err, 'unable to write entry') };
    }

    Logger.log('Sheet entry accepted: type=' + type + ', text_length=' + text.length);
    return { ok: true };
  } catch (err) {
    Logger.log('Sheet handler error: ' + (err && err.message) + '\n' + (err && err.stack));
    return { ok: false, error: 'internal error' };
  }
}

/**
 * Finds the configured spreadsheet by name, or creates it if missing.
 * The resulting spreadsheet ID is cached in Script Properties so
 * later requests can open it directly by ID (fast path).
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
 * interleaved writes from concurrent requests corrupting rows.
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
