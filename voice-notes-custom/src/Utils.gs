/**
 * Utils.gs
 *
 * Small, single-purpose helper functions shared across both calendar and sheet features.
 */

/**
 * Builds the JSON response returned to the caller.
 *
 * NOTE ON HTTP STATUS CODES: Apps Script web apps built on
 * ContentService cannot set a custom HTTP status code — every
 * response is delivered as HTTP 200 at the transport level,
 * regardless of the outcome. The ok field of the JSON body is
 * the sole indicator of success/failure.
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
 * Storage is always UTC regardless of the configured TIMEZONE.
 *
 * @return {string}
 */
function nowUtcIso() {
  return Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

/**
 * Generates a cryptographically random 256-bit token as a 64-character
 * hex string, for use as SHARED_SECRET.
 *
 * Built from two v4 UUIDs (Apps Script's available source of secure
 * randomness), concatenated and stripped of separators. Two UUIDs
 * provide comfortably more than 256 bits of entropy; we truncate to
 * exactly 64 hex characters (256 bits) for a predictable, fixed length.
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
 * Picks a client-facing error message: the specific quota message
 * when the underlying error looks like a rate-limit/quota error,
 * otherwise the generic fallback.
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
