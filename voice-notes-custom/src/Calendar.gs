/**
 * Calendar.gs
 *
 * Voice note parsing and Google Calendar event creation.
 * When a status event is detected, also appends to sheet.
 */

var DEFAULT_EVENT_MINUTES = 30;
var STATUS_EVENT_MINUTES = 1;
var STATUS_EVENT_COLOR = CalendarApp.EventColor.RED;
var STATUS_EVENT_PREFIX = '📍 ';

var LOCK_TIMEOUT_MS = 5000;
var RETRY_COUNT = 2;
var RETRY_DELAYS_MS = [1000, 3000];

/**
 * Handles calendar event creation from voice input.
 * Validates the shared secret, parses date/time from text, creates
 * Calendar event. If status is detected, also appends to sheet.
 *
 * @param {string} secret Shared secret from request
 * @param {string} text Voice input text
 * @return {{ok: boolean, error: (string|undefined), when: (string|undefined), title: (string|undefined)}}
 */
function handleCalendarEvent(secret, text) {
  try {
    const config = getConfig();

    if (!config.sharedSecret) {
      Logger.log('Rejected: SHARED_SECRET is not configured — run setup() first');
      return { ok: false, error: 'server not configured' };
    }

    if (secret !== config.sharedSecret) {
      Logger.log('Rejected: invalid secret');
      return { ok: false, error: 'invalid secret' };
    }

    text = (text || '').trim();
    if (!text) {
      Logger.log('Rejected: empty text');
      return { ok: false, error: 'empty text' };
    }

    const p = parseWhen(text);
    const cal = CalendarApp.getDefaultCalendar();

    if (p.allDay) {
      const event = cal.createAllDayEvent(p.title, p.date);
      if (p.isStatus && STATUS_EVENT_COLOR != null) {
        event.setColor(STATUS_EVENT_COLOR);
      }
    } else {
      const durationMinutes = getEventDuration(p.isStatus);
      const start = p.date;
      const end = new Date(start.getTime() + durationMinutes * 60000);
      const event = cal.createEvent(p.title, start, end);

      if (p.isStatus) {
        if (STATUS_EVENT_COLOR != null) {
          event.setColor(STATUS_EVENT_COLOR);
        }
        event.setTransparency(CalendarApp.EventTransparency.TRANSPARENT);
      }
    }

    // If status detected, also append to sheet
    if (p.isStatus) {
      const timestamp = nowUtcIso();
      try {
        withRetry(
          function () {
            const config2 = getConfig();
            const spreadsheet = getOrCreateSpreadsheet(config2.spreadsheetName);
            const sheet = getOrCreateSheet(spreadsheet, config2.sheetName);
            appendEntry(sheet, [timestamp, p.title, 'pebble']);
          },
          RETRY_COUNT,
          RETRY_DELAYS_MS
        );
      } catch (err) {
        Logger.log('Status append to sheet failed: ' + err.message);
        // Log but don't fail the calendar event creation
      }
    }

    Logger.log('Calendar event created: title=' + p.title + ', when=' + p.when);
    return {
      ok: true,
      when: p.when,
      title: p.title
    };
  } catch (err) {
    Logger.log('Calendar handler error: ' + (err && err.message) + '\n' + (err && err.stack));
    return { ok: false, error: 'internal error' };
  }
}

function getEventDuration(isStatus) {
  return isStatus ? STATUS_EVENT_MINUTES : DEFAULT_EVENT_MINUTES;
}

// ---- enhanced natural-language date/time parsing ----
function parseWhen(raw) {
  var s = ' ' + raw.toLowerCase() + ' ';
  var now = new Date();

  // Detect "status" prefix (case-insensitive, optional whitespace, optional punctuation)
  var statusMatch = raw.match(/^\s*status\s*[\p{P}\p{S}]*\s*/iu);
  var isStatus = !!statusMatch;

  var textWithoutStatus = isStatus
    ? raw.substring(statusMatch[0].length).trim()
    : raw;

  var sWithoutStatus = ' ' + textWithoutStatus.toLowerCase() + ' ';

  // "status" → use current timestamp minus 5 minutes
  if (isStatus) {
    var statusTime = new Date(now.getTime() - 5 * 60000);
    return {
      date: statusTime,
      allDay: false,
      isStatus: true,
      title: makeStatusTitle(textWithoutStatus),
      when: fmt(statusTime, false)
    };
  }

  // "in N hours/minutes" → relative to now
  var rel = sWithoutStatus.match(/\bin (\d+)\s*(hours?|hrs?|minutes?|mins?)\b/);

  if (rel) {
    var n = parseInt(rel[1], 10);
    var d = new Date(now.getTime());

    if (/hour|hr/.test(rel[2])) {
      d.setHours(d.getHours() + n);
    } else {
      d.setMinutes(d.getMinutes() + n);
    }

    return {
      date: d,
      allDay: false,
      isStatus: isStatus,
      title: cleanTitle(textWithoutStatus),
      when: fmt(d, false)
    };
  }

  // All other cases: parse day + time separately
  var dateObj = parseDay(sWithoutStatus, now);
  var timeObj = parseTime(sWithoutStatus);

  // Apply time to the parsed day
  if (timeObj.haveTime) {
    dateObj.date.setHours(timeObj.hour, timeObj.min, 0, 0);

    // If time is in the past and no explicit day was given, bump to tomorrow
    if (!dateObj.haveDayKeyword && dateObj.date.getTime() < now.getTime()) {
      dateObj.date.setDate(dateObj.date.getDate() + 1);
    }
  }

  return {
    date: dateObj.date,
    allDay: !timeObj.haveTime,
    isStatus: isStatus,
    title: cleanTitle(textWithoutStatus),
    when: fmt(dateObj.date, !timeObj.haveTime)
  };
}

function parseDay(s, now) {
  var date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var haveDayKeyword = false;

  if (/\btoday\b/.test(s)) {
    haveDayKeyword = true;
  } else if (/\bday after tomorrow\b/.test(s)) {
    date.setDate(date.getDate() + 2);
    haveDayKeyword = true;
  } else if (/\btomorrow\b/.test(s)) {
    date.setDate(date.getDate() + 1);
    haveDayKeyword = true;
  } else {
    var days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (var i = 0; i < 7; i++) {
      if (new RegExp('\\b' + days[i] + '\\b').test(s)) {
        var delta = (i - date.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        date.setDate(date.getDate() + delta);
        haveDayKeyword = true;
        break;
      }
    }
  }

  return { date: date, haveDayKeyword: haveDayKeyword };
}

function parseTime(s) {
  var haveTime = false;
  var hour = 9;
  var min = 0;

  if (/\bnoon\b/.test(s)) {
    hour = 12;
    haveTime = true;
  } else if (/\bmidnight\b/.test(s)) {
    hour = 0;
    haveTime = true;
  } else if (/\bmorning\b/.test(s)) {
    hour = 9;
    haveTime = true;
  } else if (/\bafternoon\b/.test(s)) {
    hour = 14;
    haveTime = true;
  } else if (/\bevening\b/.test(s)) {
    hour = 18;
    haveTime = true;
  } else if (/\btonight\b/.test(s)) {
    hour = 20;
    haveTime = true;
  }

  var t = s.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);

  if (t && (t[3] || t[2] || /\bat\s*\d/.test(s))) {
    var h = parseInt(t[1], 10);
    var m = t[2] ? parseInt(t[2], 10) : 0;

    if (t[3] === 'pm' && h < 12) h += 12;
    if (t[3] === 'am' && h === 12) h = 0;

    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      hour = h;
      min = m;
      haveTime = true;
    }
  }

  return { haveTime: haveTime, hour: hour, min: min };
}

function cleanTitle(raw) {
  return raw
    .replace(
      /^\s*(remind me to|reminder to|remember to|note to self to|note to|now|right now|status)\s*[\p{P}\p{S}]?\s*/iu,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function makeStatusTitle(raw) {
  var title = cleanTitle(raw);
  return STATUS_EVENT_PREFIX == null ? title : STATUS_EVENT_PREFIX + title;
}

function fmt(d, allDay) {
  var tz = Session.getScriptTimeZone();
  return allDay
    ? Utilities.formatDate(d, tz, 'EEE d MMM') + ' (all day)'
    : Utilities.formatDate(d, tz, 'EEE d MMM HH:mm');
}
