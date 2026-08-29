/**
 * Router.gs
 *
 * HTTP entry points for unified calendar + sheet bridge.
 * Dispatches requests to appropriate handlers based on payload.
 */

/**
 * HTTP GET entry point. Calendar events only.
 * Expected params: ?secret=...&text=...
 *
 * @param {Object} e Apps Script event object
 * @return {ContentService.TextOutput}
 */
function doGet(e) {
  const result = handleCalendarEvent(e.parameter.secret, e.parameter.text);
  return jsonResponse(result.ok, result.error);
}

/**
 * HTTP POST entry point. Dispatches by payload shape.
 * body.token present → sheet webhook
 * else (body.secret present) → calendar event
 *
 * @param {Object} e Apps Script event object
 * @return {ContentService.TextOutput}
 */
function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      Logger.log('Rejected: missing request body');
      return jsonResponse(false, 'missing request body');
    }

    if (e.postData.contents.length > 10 * 1024) {
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

    // Dispatch by field presence
    if (body.token !== undefined) {
      // Sheet webhook: token + text + type
      const result = handleSheetWebhook(body.token, body.text, body.type);
      return jsonResponse(result.ok, result.error);
    } else {
      // Calendar event: secret + text
      const result = handleCalendarEvent(body.secret, body.text);
      return jsonResponse(result.ok, result.error);
    }
  } catch (err) {
    Logger.log('Router error: ' + (err && err.message) + '\n' + (err && err.stack));
    return jsonResponse(false, 'internal error');
  }
}
