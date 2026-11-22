/**
 * Utils.gs
 *
 * Small, single-purpose helper functions shared across the project.
 */

/**
 * Builds the JSON response returned to the caller.
 *
 * NOTE ON HTTP STATUS CODES: Apps Script web apps built on
 * ContentService cannot set a custom HTTP status code — every
 * response is delivered as HTTP 200 at the transport level,
 * regardless of the outcome. The requirements describe failures as
 * "HTTP 400 or 500" as an interface-contract convention; in this
 * implementation that distinction lives entirely in the `ok` field
 * of the JSON body, which every client (including the Python
 * client) already relies on to determine success/failure. Callers
 * must check `ok`, not the HTTP status.
 *
 * @param {boolean} ok
 * @param {string=} error Error message, required when ok is false.
 * @return {ContentService.TextOutput}
 */
function jsonResponse(ok, error) {
  const body = ok ? { ok: true } : { ok: false, error: error };
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Current time as a UTC ISO 8601 string, e.g. "2025-08-18T14:32:45Z".
 * Storage is always UTC regardless of the configured TIMEZONE, which
 * is used only for logging/display (see requirements 2.4, 4.5).
 *
 * @return {string}
 */
function nowUtcIso() {
  return Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

/**
 * Generates a cryptographically random 256-bit token as a 64-character
 * hex string, for use as WEBHOOK_TOKEN.
 *
 * Built from two v4 UUIDs (Apps Script's available source of secure
 * randomness), concatenated and stripped of separators. A v4 UUID has
 * 122 random bits (version/variant digits are fixed), so the 64-character
 * result carries about 244 bits of entropy, which is plenty for this use.
 *
 * @return {string}
 */
function generateRandomToken() {
  const raw = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  return raw.substring(0, 64);
}

/**
 * Runs fn(), retrying on failure up to maxRetries additional times
 * with the given per-attempt delays. Does not distinguish error
 * types — callers should only wrap operations where blanket retry
 * is appropriate (i.e. not validation/auth failures).
 *
 * @param {function(): *} fn
 * @param {number} maxRetries Number of retries AFTER the first attempt.
 * @param {number[]} delaysMs Delay in ms before each retry. Must have
 *   at least maxRetries entries.
 * @return {*} Whatever fn() returns.
 * @throws The last error, if all attempts fail.
 */
function withRetry(fn, maxRetries, delaysMs) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        Logger.log('Retry attempt ' + (attempt + 1) + '/' + maxRetries +
          ' after transient error: ' + err.message);
        Utilities.sleep(delaysMs[attempt]);
      }
    }
  }
  throw lastError;
}

/**
 * Best-effort detection of Google API quota/rate-limit errors, based
 * on substrings that appear in known Apps Script/Sheets API error
 * messages. Not exhaustive — worst case, a quota error is reported
 * with the generic "unable to..." message instead of the more
 * specific quota message, which is a fine degradation.
 *
 * @param {Error} err
 * @return {boolean}
 */
function isQuotaError(err) {
  const message = (err && err.message) || '';
  return message.indexOf('too many times') !== -1 ||
    message.indexOf('Rate Limit') !== -1 ||
    message.indexOf('rate limit') !== -1 ||
    message.indexOf('quota') !== -1 ||
    message.indexOf('Quota') !== -1;
}

/**
 * Constant-time string comparison, for secrets.
 *
 * @param {*} a
 * @param {*} b
 * @return {boolean}
 */
function safeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Neutralizes spreadsheet formula injection: a string starting with
 * =, +, - or @ would be interpreted as a formula by appendRow, so it is
 * prefixed with a single quote (shown as plain text in the sheet).
 *
 * @param {*} value
 * @return {*}
 */
function sanitizeCell(value) {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

/**
 * Size of a request body in bytes (UTF-8), not characters.
 *
 * @param {string} contents
 * @return {number}
 */
function byteLength(contents) {
  return Utilities.newBlob(contents).getBytes().length;
}
