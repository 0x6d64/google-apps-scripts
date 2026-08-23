/**
 * Google Tasks Dashboard - Backend Code
 */

const SPREADSHEET_PROP_KEY = 'SPREADSHEET_ID';
const LAST_SYNC_PROP_KEY = 'LAST_SYNC_TIME';
const SYNC_LOCK_COOLDOWN_MS = 10000; // 10 seconds debounce lock
const PAGE_FETCH_LIMIT = 50; // Safety batch size within Apps Script limits
const SHEET_HEADERS = ['timestamp', 'open', 'completed', 'overdue', 'overdue_severity'];

/**
 * Serves the web dashboard HTML interface.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Google Tasks Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Helper to include HTML fragments (Styles, JavaScript).
 * @param {string} filename
 * @return {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Retrieves existing spreadsheet or automatically creates and initializes a new one.
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSheet() {
  const scriptProps = PropertiesService.getScriptProperties();
  let spreadsheetId = scriptProps.getProperty(SPREADSHEET_PROP_KEY);
  let spreadsheet = null;

  if (spreadsheetId) {
    try {
      spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    } catch (e) {
      Logger.log('Configured spreadsheet ID invalid or inaccessible: ' + e);
      spreadsheet = null;
    }
  }

  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create('Google Tasks Metrics Storage');
    spreadsheetId = spreadsheet.getId();
    scriptProps.setProperty(SPREADSHEET_PROP_KEY, spreadsheetId);

    const sheet = spreadsheet.getActiveSheet();
    sheet.setName('Metrics');
    sheet.appendRow(SHEET_HEADERS);
    sheet.setFrozenRows(1);
    return sheet;
  }

  let sheet = spreadsheet.getSheetByName('Metrics');
  if (!sheet) {
    sheet = spreadsheet.getActiveSheet();
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEET_HEADERS);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Returns the spreadsheet URL for direct viewing in Google Drive.
 * @return {string}
 */
function getSpreadsheetUrl() {
  const sheet = getOrCreateSheet();
  return sheet.getParent().getUrl();
}

/**
 * Ingests current task counts across all lists and appends an aggregate row.
 * Handles rate limits, null checks on response items, and locks.
 * @return {Object} The freshly calculated snapshot metrics
 */
function ingestTaskMetrics() {
  const now = new Date();
  let taskListsResult;
  try {
    taskListsResult = Tasks.Tasklists.list();
  } catch (err) {
    throw new Error('Failed to fetch task lists from Tasks API: ' + (err.message || err));
  }

  const taskLists = (taskListsResult && taskListsResult.items) ? taskListsResult.items : [];

  let totalOpen = 0;
  let totalCompleted = 0;
  let totalOverdue = 0;
  let totalOverdueSeverity = 0.0;

  for (let i = 0; i < taskLists.length; i++) {
    const listId = taskLists[i].id;
    let pageToken = null;

    do {
      let response;
      try {
        response = Tasks.Tasks.list(listId, {
          showCompleted: true,
          showHidden: true,
          maxResults: PAGE_FETCH_LIMIT,
          pageToken: pageToken
        });
      } catch (err) {
        Logger.log('Error fetching tasks for list ' + listId + ': ' + err);
        break;
      }

      if (!response || !response.items || !Array.isArray(response.items)) {
        break;
      }

      const tasks = response.items;
      for (let j = 0; j < tasks.length; j++) {
        const task = tasks[j];
        if (!task) continue;

        if (task.status === 'completed') {
          totalCompleted++;
        } else if (task.status === 'needsAction') {
          totalOpen++;

          if (task.due) {
            const dueDate = new Date(task.due);
            if (!isNaN(dueDate.getTime()) && dueDate < now) {
              totalOverdue++;
              const diffMs = now.getTime() - dueDate.getTime();
              const daysOverdue = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
              totalOverdueSeverity += Math.sqrt(daysOverdue);
            }
          }
        }
      }

      pageToken = response.nextPageToken;
    } while (pageToken);
  }

  const snapshot = {
    timestamp: now.toISOString(),
    open: totalOpen,
    completed: totalCompleted,
    overdue: totalOverdue,
    overdue_severity: Number(totalOverdueSeverity.toFixed(2))
  };

  const sheet = getOrCreateSheet();
  sheet.appendRow([
    snapshot.timestamp,
    snapshot.open,
    snapshot.completed,
    snapshot.overdue,
    snapshot.overdue_severity
  ]);

  return snapshot;
}

/**
 * Fetches all historical time series metrics from the spreadsheet.
 * Includes data validation and type coercion.
 * @return {Object} { headers: string[], rows: Array<Array<any>>, sheetUrl: string, triggerActive: boolean }
 */
function getDashboardData() {
  const sheet = getOrCreateSheet();
  const sheetUrl = sheet.getParent().getUrl();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow <= 1) {
    ingestTaskMetrics();
    return getDashboardData();
  }

  const rawValues = sheet.getRange(1, 1, lastRow, Math.max(5, lastCol)).getValues();
  const headers = rawValues[0];
  const validRows = [];

  for (let i = 1; i < rawValues.length; i++) {
    const row = rawValues[i];
    if (!row || !row[0]) continue;

    let isoTimestamp;
    if (row[0] instanceof Date && !isNaN(row[0].getTime())) {
      isoTimestamp = row[0].toISOString();
    } else {
      const parsed = new Date(row[0]);
      isoTimestamp = !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
    }

    const open = isNaN(Number(row[1])) ? 0 : Math.max(0, Number(row[1]));
    const completed = isNaN(Number(row[2])) ? 0 : Math.max(0, Number(row[2]));
    const overdue = isNaN(Number(row[3])) ? 0 : Math.max(0, Number(row[3]));
    const severity = isNaN(Number(row[4])) ? 0 : Math.max(0, Number(Number(row[4]).toFixed(2)));

    validRows.push([isoTimestamp, open, completed, overdue, severity]);
  }

  return {
    headers: headers,
    rows: validRows,
    sheetUrl: sheetUrl,
    triggerActive: isTriggerActive()
  };
}

/**
 * Concurrency-safe manual sync.
 * @return {Object} Refreshed dashboard data.
 */
function syncNow() {
  acquireSyncLock();
  try {
    ingestTaskMetrics();
    return getDashboardData();
  } finally {
    releaseSyncLock();
  }
}

/**
 * Concurrency-safe Sync and Clear completed tasks across all lists.
 * @return {Object} Refreshed dashboard data.
 */
function syncAndClearTasks() {
  acquireSyncLock();
  try {
    // 1. Ingest metrics first for safe persistence
    ingestTaskMetrics();

    // 2. Clear completed tasks in each task list
    const taskListsResult = Tasks.Tasklists.list();
    const taskLists = (taskListsResult && taskListsResult.items) ? taskListsResult.items : [];

    for (let i = 0; i < taskLists.length; i++) {
      try {
        Tasks.Tasks.clear(taskLists[i].id);
      } catch (e) {
        Logger.log('Failed to clear list ' + taskLists[i].id + ': ' + e);
      }
    }

    return getDashboardData();
  } finally {
    releaseSyncLock();
  }
}

/**
 * Lock acquisition to prevent concurrent sync operations (10s cooldown).
 */
function acquireSyncLock() {
  const scriptProps = PropertiesService.getScriptProperties();
  const lastSync = Number(scriptProps.getProperty(LAST_SYNC_PROP_KEY) || 0);
  const now = Date.now();

  if (lastSync && (now - lastSync) < SYNC_LOCK_COOLDOWN_MS) {
    const waitSec = Math.ceil((SYNC_LOCK_COOLDOWN_MS - (now - lastSync)) / 1000);
    throw new Error('A sync is already in progress or completed recently. Please wait ' + waitSec + 's.');
  }

  scriptProps.setProperty(LAST_SYNC_PROP_KEY, String(now));
}

/**
 * Releases or refreshes the sync lock timestamp.
 */
function releaseSyncLock() {
  const scriptProps = PropertiesService.getScriptProperties();
  scriptProps.setProperty(LAST_SYNC_PROP_KEY, String(Date.now()));
}

/**
 * Checks if the automated background trigger is installed.
 * @return {boolean}
 */
function isTriggerActive() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestTaskMetrics') {
      return true;
    }
  }
  return false;
}

/**
 * Toggles the automated 3-hour background trigger.
 * @param {boolean} enable
 * @return {boolean} New active state
 */
function setTriggerEnabled(enable) {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestTaskMetrics') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  if (enable) {
    ScriptApp.newTrigger('ingestTaskMetrics')
      .timeBased()
      .everyHours(3)
      .create();
    return true;
  }
  return false;
}
