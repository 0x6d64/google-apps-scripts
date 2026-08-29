// Voice Notes -> Google Calendar bridge (Google Apps Script web app).
//
// Runs as YOU, so there is no OAuth client / consent-screen setup and no token
// juggling — it just calls CalendarApp. See bridge/README.md for deploy steps.
//
// Accepts GET (?secret=...&text=...) or POST (JSON { secret, text }), parses a
// date/time out of the spoken text, and creates a Calendar event (timed, or
// all-day if no time is found). The watch uses GET: Apps Script 302-redirects
// its response, and the phone's XMLHttpRequest follows a GET redirect correctly
// but not a POST one (that showed up on the watch as "Bad response").
//
// Parsing logic:
// - "status" prefix (with optional trailing punctuation) creates a status event.
// - Status events start 5 minutes before the current time.
// - Status events are 1 minute long and are marked as "free".
// - "now" or "right now" creates a timed event at the current time.
// - "in N hours/minutes" creates a timed event relative to the current time.
// - "today", "tomorrow", "day after tomorrow", and weekdays select the day.
// - Named times such as "noon", "morning", "afternoon", "evening", and
//   "tonight" are supported.
// - Explicit times such as "at 3", "3:30pm", "15:00", and "3pm" are supported.
// - If a time is supplied without an explicit day and that time has already
//   passed today, the event is moved to tomorrow.
// - If no time is found, the event is created as an all-day event.
//
// Configuration:
//
// SHARED_SECRET:
//   Shared authentication secret used by the watch app and this web app.
//   Must match SHARED_SECRET in src/pkjs/config.js.
//
// DEFAULT_EVENT_MINUTES:
//   Duration, in minutes, of normal timed calendar events.
//   Example: 30 creates a 30-minute event.
//
// STATUS_EVENT_MINUTES:
//   Duration, in minutes, of status events.
//   Status events are created 5 minutes before the current time.
//   Example: 1 creates a 1-minute status event.
//
// STATUS_EVENT_COLOR:
//   Calendar color applied to status events.
//   Set to null to keep the calendar's default event color.
//
//   Valid CalendarApp.EventColor values:
//     PALE_BLUE
//     PALE_GREEN
//     MAUVE
//     PALE_RED
//     YELLOW
//     ORANGE
//     CYAN
//     GRAY
//     BLUE
//     GREEN
//     RED
//
// STATUS_EVENT_PREFIX:
//   Text prepended to the title of every status event.
//   Set to null to disable the prefix.
//   Example: '📍 ' turns "Fixed the bug" into "📍 Fixed the bug".

var SHARED_SECRET = 'PASTE_A_RANDOM_SECRET_HERE';
var DEFAULT_EVENT_MINUTES = 30;
var STATUS_EVENT_MINUTES = 1;
var STATUS_EVENT_COLOR = CalendarApp.EventColor.RED;
var STATUS_EVENT_PREFIX = '📍 ';

// Run this ONCE from the editor (Run > authorize) to grant Calendar access.
function authorize() {
  Logger.log(CalendarApp.getDefaultCalendar().getName());
}

// The watch app calls this via GET: /exec?secret=...&text=...
function doGet(e) {
  return handle(e.parameter.secret, e.parameter.text);
}

// POST (JSON { secret, text }) also works, e.g. for curl testing.
function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {}
  return handle(body.secret, body.text);
}

function handle(secret, text) {
  try {
    if (secret !== SHARED_SECRET) {
      return json({ ok: false, error: 'bad secret' });
    }

    text = (text || '').trim();
    if (!text) {
      return json({ ok: false, error: 'empty' });
    }

    var p = parseWhen(text);
    var cal = CalendarApp.getDefaultCalendar();

    if (p.allDay) {
      var event = cal.createAllDayEvent(p.title, p.date);

      if (p.isStatus && STATUS_EVENT_COLOR != null) {
        event.setColor(STATUS_EVENT_COLOR);
      }
    } else {
      var durationMinutes = getEventDuration(p.isStatus);
      var start = p.date;
      var end = new Date(
        start.getTime() + durationMinutes * 60000
      );

      var event = cal.createEvent(
        p.title,
        start,
        end
      );

      if (p.isStatus) {
        if (STATUS_EVENT_COLOR != null) {
          event.setColor(STATUS_EVENT_COLOR);
        }

        event.setTransparency(
          CalendarApp.EventTransparency.TRANSPARENT
        );
      }
    }

    return json({
      ok: true,
      when: p.when,
      title: p.title
    });
  } catch (err) {
    return json({
      ok: false,
      error: String(err)
    });
  }
}

function json(obj) {
  return ContentService.createTextOutput(
    JSON.stringify(obj)
  ).setMimeType(ContentService.MimeType.JSON);
}

function getEventDuration(isStatus) {
  return isStatus
    ? STATUS_EVENT_MINUTES
    : DEFAULT_EVENT_MINUTES;
}

// ---- enhanced natural-language date/time parsing ----
function parseWhen(raw) {
  var s = ' ' + raw.toLowerCase() + ' ';
  var now = new Date();

  // Detect "status" prefix
  // (case-insensitive, optional whitespace, optional punctuation).
  var statusMatch = raw.match(
    /^\s*status\s*[\p{P}\p{S}]*\s*/iu
  );
  var isStatus = !!statusMatch;

  var textWithoutStatus = isStatus
    ? raw.substring(statusMatch[0].length).trim()
    : raw;

  var sWithoutStatus =
    ' ' + textWithoutStatus.toLowerCase() + ' ';

  // "status" -> use current timestamp minus 5 minutes
  if (isStatus) {
    var statusTime = new Date(
      now.getTime() - 5 * 60000
    );

    return {
      date: statusTime,
      allDay: false,
      isStatus: true,
      title: makeStatusTitle(textWithoutStatus),
      when: fmt(statusTime, false)
    };
  }

  // "in N hours/minutes" -> relative to now
  var rel = sWithoutStatus.match(
    /\bin (\d+)\s*(hours?|hrs?|minutes?|mins?)\b/
  );

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
  var dateObj = parseDay(
    sWithoutStatus,
    now
  );
  var timeObj = parseTime(sWithoutStatus);

  // Apply time to the parsed day
  if (timeObj.haveTime) {
    dateObj.date.setHours(
      timeObj.hour,
      timeObj.min,
      0,
      0
    );

    // If time is in the past and no explicit day was given,
    // bump to tomorrow.
    if (
      !dateObj.haveDayKeyword &&
      dateObj.date.getTime() < now.getTime()
    ) {
      dateObj.date.setDate(
        dateObj.date.getDate() + 1
      );
    }
  }

  return {
    date: dateObj.date,
    allDay: !timeObj.haveTime,
    isStatus: isStatus,
    title: cleanTitle(textWithoutStatus),
    when: fmt(
      dateObj.date,
      !timeObj.haveTime
    )
  };
}

function parseDay(s, now) {
  var date = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ); // midnight today

  var haveDayKeyword = false;

  if (/\btoday\b/.test(s)) {
    haveDayKeyword = true;
  } else if (
    /\bday after tomorrow\b/.test(s)
  ) {
    date.setDate(date.getDate() + 2);
    haveDayKeyword = true;
  } else if (/\btomorrow\b/.test(s)) {
    date.setDate(date.getDate() + 1);
    haveDayKeyword = true;
  } else {
    var days = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday'
    ];

    for (var i = 0; i < 7; i++) {
      if (
        new RegExp(
          '\\b' + days[i] + '\\b'
        ).test(s)
      ) {
        var delta =
          (i - date.getDay() + 7) % 7;

        if (delta === 0) {
          delta = 7; // "monday" => next monday
        }

        date.setDate(
          date.getDate() + delta
        );
        haveDayKeyword = true;
        break;
      }
    }
  }

  return {
    date: date,
    haveDayKeyword: haveDayKeyword
  };
}

function parseTime(s) {
  var haveTime = false;
  var hour = 9;
  var min = 0;

  // Named times
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

  // Explicit clock time: "at 3", "at 3:30pm", "15:00", "3pm"
  var t = s.match(
    /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/
  );

  if (
    t &&
    (t[3] ||
      t[2] ||
      /\bat\s*\d/.test(s))
  ) {
    var h = parseInt(t[1], 10);
    var m = t[2]
      ? parseInt(t[2], 10)
      : 0;

    if (t[3] === 'pm' && h < 12) {
      h += 12;
    }

    if (t[3] === 'am' && h === 12) {
      h = 0;
    }

    if (
      h >= 0 &&
      h <= 23 &&
      m >= 0 &&
      m <= 59
    ) {
      hour = h;
      min = m;
      haveTime = true;
    }
  }

  return {
    haveTime: haveTime,
    hour: hour,
    min: min
  };
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

  return STATUS_EVENT_PREFIX == null
    ? title
    : STATUS_EVENT_PREFIX + title;
}

function fmt(d, allDay) {
  var tz = Session.getScriptTimeZone();

  return allDay
    ? Utilities.formatDate(
        d,
        tz,
        'EEE d MMM'
      ) + ' (all day)'
    : Utilities.formatDate(
        d,
        tz,
        'EEE d MMM HH:mm'
      );
}
