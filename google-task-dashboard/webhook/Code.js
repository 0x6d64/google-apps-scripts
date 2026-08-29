/**
 * Google Tasks Dashboard - Backend Code
 */

const SPREADSHEET_PROP_KEY = 'SPREADSHEET_ID';
const LAST_SYNC_PROP_KEY = 'LAST_SYNC_TIME';
const AUTO_SYNC_PROP_KEY = 'AUTO_SYNC_ENABLED';
const SYNC_LOCK_COOLDOWN_MS = 10000; // 10 seconds debounce lock
const PAGE_FETCH_LIMIT = 50; // Safety batch size within Apps Script limits
const SHEET_HEADERS = ['timestamp', 'open', 'completed', 'overdue', 'overdue_severity'];

/**
 * Serves the web dashboard HTML interface.
 */
function doGet() {
  // Ensure default auto-sync setting & trigger exist
  ensureAutoSyncDefault();

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
/**
 * Extracts task weight from title prefix.
 * Prefix rules: no prefix = 1, "!" = 2, "!!" = 3, "!!!" = 4, "!!!!" = 5.
 * Prefix must be at the beginning of the title only.
 * @param {string} title - Task title
 * @return {number} - Weight (1-5)
 */
function getTaskWeight(title) {
  if (!title || typeof title !== 'string') return 1;
  
  const match = title.match(/^!{1,4}/);
  if (!match) return 1;
  
  const prefixLen = match[0].length;
  return prefixLen + 1; // 1 "!" → 2, 2 "!" → 3, etc.
}

function ingestTaskMetrics() {
  const now = new Date();
  const sixMonthsCutoff = new Date(now);
  sixMonthsCutoff.setMonth(sixMonthsCutoff.getMonth() + 6);

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

        const weight = getTaskWeight(task.title);

        if (task.status === 'completed') {
          totalCompleted += weight;
        } else if (task.status === 'needsAction') {
          // Include open tasks without due date, or with due date within 6-month window
          if (!task.due) {
            // No due date: always count as open
            totalOpen += weight;
          } else {
            const dueDate = new Date(task.due);
            if (!isNaN(dueDate.getTime())) {
              // Exclude tasks due more than 6 months in the future
              if (dueDate <= sixMonthsCutoff) {
                totalOpen += weight;
                // Calculate overdue only for tasks with due dates in the past
                if (dueDate < now) {
                  totalOverdue += weight;
                  const diffMs = now.getTime() - dueDate.getTime();
                  const daysOverdue = Math.max(
                    0,
                    diffMs / (1000 * 60 * 60 * 24)
                  );
                  totalOverdueSeverity += weight * Math.sqrt(daysOverdue);
                }
              }
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
 * Concurrency-safe Sync and Clear ALL completed tasks across all lists.
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
 * Concurrency-safe deletion of completed tasks older than a specific threshold (default: 8 weeks / 56 days).
 * Preserves recent completed tasks (< 8 weeks) in Google Tasks so throughput metrics remain visible.
 * @param {number} [cutoffWeeks=8]
 * @return {Object} { success: boolean, tasksDeleted: number, durationMs: number, data: Object, error?: string }
 */
function deleteOldCompletedTasks(cutoffWeeks) {
  const startTime = Date.now();
  const weeks = (typeof cutoffWeeks === 'number' && cutoffWeeks > 0) ? cutoffWeeks : 8;
  const cutoffMs = weeks * 7 * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(startTime - cutoffMs);

  acquireSyncLock();
  try {
    let totalDeleted = 0;
    const taskListsResult = Tasks.Tasklists.list();
    const taskLists = (taskListsResult && taskListsResult.items) ? taskListsResult.items : [];

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
          Logger.log('Error fetching tasks for deletion in list ' + listId + ': ' + err);
          break;
        }

        if (!response || !response.items || !Array.isArray(response.items)) {
          break;
        }

        const tasks = response.items;
        for (let j = 0; j < tasks.length; j++) {
          const task = tasks[j];
          if (!task || task.status !== 'completed') continue;

          // Check completion timestamp
          let isOld = false;
          if (task.completed) {
            const completedDate = new Date(task.completed);
            if (!isNaN(completedDate.getTime()) && completedDate < cutoffDate) {
              isOld = true;
            }
          } else if (task.updated) {
            // Fallback to updated timestamp if completed date is missing
            const updatedDate = new Date(task.updated);
            if (!isNaN(updatedDate.getTime()) && updatedDate < cutoffDate) {
              isOld = true;
            }
          }

          if (isOld) {
            try {
              Tasks.Tasks.remove(listId, task.id);
              totalDeleted++;
            } catch (delErr) {
              Logger.log('Failed to delete task ' + task.id + ': ' + delErr);
            }
          }
        }

        pageToken = response.nextPageToken;
      } while (pageToken);
    }

    // Append fresh metrics snapshot after cleanup
    ingestTaskMetrics();
    const dashboardData = getDashboardData();
    const durationMs = Date.now() - startTime;

    Logger.log('[DELETE_OLD] Deleted ' + totalDeleted + ' tasks older than ' + weeks + ' weeks in ' + durationMs + 'ms');

    return {
      success: true,
      tasksDeleted: totalDeleted,
      durationMs: durationMs,
      data: dashboardData
    };
  } catch (err) {
    Logger.log('[DELETE_OLD] Error: ' + err);
    return {
      success: false,
      tasksDeleted: 0,
      durationMs: Date.now() - startTime,
      error: (err && (err.message || err.toString())) || 'Failed to delete old completed tasks'
    };
  } finally {
    releaseSyncLock();
  }
}

/**
 * Extracts UTC calendar date in 'YYYY-MM-DD' format.
 * @param {string|Date} timestamp
 * @return {string|null}
 */
function extractCalendarDate(timestamp) {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Reduces all rows older than 1 year (365 days) to 1 snapshot per calendar day.
 * @return {Object} { success: boolean, totalBefore: number, totalAfter: number, totalPruned: number, percentageRemoved: number, durationMs: number, message?: string, error?: string }
 */
function pruneDataOlderThan1Year() {
  const startTime = Date.now();
  acquireSyncLock();

  try {
    const sheet = getOrCreateSheet();
    const lastRow = sheet.getLastRow();
    const totalDataRowsBefore = Math.max(0, lastRow - 1);

    if (totalDataRowsBefore < 10) {
      return {
        success: false,
        error: 'Insufficient rows to prune (only ' + totalDataRowsBefore + ' total). No action taken.',
        totalBefore: totalDataRowsBefore,
        totalAfter: totalDataRowsBefore,
        totalPruned: 0,
        percentageRemoved: 0,
        durationMs: Date.now() - startTime
      };
    }

    const cutoffTimestamp = Date.now() - (365 * 24 * 60 * 60 * 1000);
    const rangeValues = sheet.getRange(2, 1, totalDataRowsBefore, 1).getValues();

    const seenDateKeys = {};
    const rowsToDelete = [];

    for (let i = 0; i < rangeValues.length; i++) {
      const rawDate = rangeValues[i][0];
      if (!rawDate) continue;

      const dateObj = new Date(rawDate);
      if (isNaN(dateObj.getTime())) continue;

      const rowNumber = i + 2; // 1-based indexing + header offset

      if (dateObj.getTime() >= cutoffTimestamp) {
        // Recent data (< 1 year old); keep all intervals
        continue;
      }

      // Old data (> 1 year old); keep only 1 snapshot per calendar day
      const dateKey = extractCalendarDate(dateObj);
      if (!dateKey) continue;

      if (seenDateKeys[dateKey]) {
        // Duplicate row for this old date; mark for deletion
        rowsToDelete.push(rowNumber);
      } else {
        seenDateKeys[dateKey] = rowNumber;
      }
    }

    Logger.log('[PRUNE] Total rows before: ' + totalDataRowsBefore + ', Marked for deletion: ' + rowsToDelete.length);

    if (rowsToDelete.length === 0) {
      return {
        success: true,
        totalBefore: totalDataRowsBefore,
        totalAfter: totalDataRowsBefore,
        totalPruned: 0,
        percentageRemoved: 0,
        durationMs: Date.now() - startTime,
        message: 'All data is either less than 1 year old or already daily deduplicated. No pruning needed.'
      };
    }

    // Safety threshold: abort if more than 80% of total rows would be pruned
    if ((rowsToDelete.length / totalDataRowsBefore) > 0.80) {
      return {
        success: false,
        error: 'Pruning would remove ' + ((rowsToDelete.length / totalDataRowsBefore) * 100).toFixed(1) + '% of data. Aborting as safety measure. Check data integrity.',
        totalBefore: totalDataRowsBefore,
        totalAfter: totalDataRowsBefore,
        totalPruned: 0,
        percentageRemoved: 0,
        durationMs: Date.now() - startTime
      };
    }

    // Batch delete rows in reverse order from bottom to top to avoid index shifting
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToDelete[i]);
    }

    const totalDataRowsAfter = Math.max(0, sheet.getLastRow() - 1);
    const totalPruned = totalDataRowsBefore - totalDataRowsAfter;
    const percentageRemoved = totalDataRowsBefore > 0 ? Number(((totalPruned / totalDataRowsBefore) * 100).toFixed(1)) : 0;
    const durationMs = Date.now() - startTime;

    Logger.log('[PRUNE] Finished in ' + durationMs + 'ms. Rows remaining: ' + totalDataRowsAfter);

    return {
      success: true,
      totalBefore: totalDataRowsBefore,
      totalAfter: totalDataRowsAfter,
      totalPruned: totalPruned,
      percentageRemoved: percentageRemoved,
      durationMs: durationMs,
      message: 'Pruned ' + totalPruned + ' rows. Kept ' + totalDataRowsAfter + '.'
    };
  } catch (err) {
    Logger.log('[PRUNE] Error: ' + err);
    return {
      success: false,
      error: (err && (err.message || err.toString())) || 'Unknown pruning error',
      totalBefore: 0,
      totalAfter: 0,
      totalPruned: 0,
      percentageRemoved: 0,
      durationMs: Date.now() - startTime
    };
  } finally {
    releaseSyncLock();
  }
}

/**
 * Returns the script project ID for admin access link.
 */
function getScriptProjectId() {
  return ScriptApp.getScriptId();
}

/**
 * Downsamples the last 365 days of snapshot rows to at most 1 entry per
 * rolling 60-minute window, keeping only the latest snapshot in each window.
 * Rows older than 365 days are left untouched (handled separately by
 * pruneDataOlderThan1Year).
 */
function downsampleLastYearToHourly() {
  const startTime = Date.now();
  acquireSyncLock();

  try {
    const sheet = getOrCreateSheet();
    const lastRow = sheet.getLastRow();
    const totalDataRowsBefore = Math.max(0, lastRow - 1);

    if (totalDataRowsBefore < 10) {
      return {
        success: false,
        error: 'Insufficient rows to downsample (only ' + totalDataRowsBefore + ' total). No action taken.',
        totalBefore: totalDataRowsBefore,
        totalAfter: totalDataRowsBefore,
        totalRemoved: 0,
        percentageRemoved: 0,
        durationMs: Date.now() - startTime
      };
    }

    const cutoffTimestamp = Date.now() - (365 * 24 * 60 * 60 * 1000);
    const rangeValues = sheet.getRange(2, 1, totalDataRowsBefore, 1).getValues();

    // Build list of {rowNumber, timestampMs} for rows within the last 365 days
    const candidateRows = [];
    for (let i = 0; i < rangeValues.length; i++) {
      const rawDate = rangeValues[i][0];
      if (!rawDate) continue;

      const dateObj = new Date(rawDate);
      if (isNaN(dateObj.getTime())) continue;

      const rowNumber = i + 2; // 1-based indexing + header offset
      const timestampMs = dateObj.getTime();

      if (timestampMs < cutoffTimestamp) {
        // Older than 1 year; not in scope for this action
        continue;
      }

      candidateRows.push({ rowNumber: rowNumber, timestampMs: timestampMs });
    }

    if (candidateRows.length === 0) {
      return {
        success: true,
        totalBefore: totalDataRowsBefore,
        totalAfter: totalDataRowsBefore,
        totalRemoved: 0,
        percentageRemoved: 0,
        durationMs: Date.now() - startTime,
        message: 'No snapshots found within the last 365 days. No action taken.'
      };
    }

    // Sort ascending by timestamp (sheet rows should already be in order, but be defensive)
    candidateRows.sort((a, b) => a.timestampMs - b.timestampMs);

    const ONE_HOUR_MS = 60 * 60 * 1000;
    const rowsToDelete = [];
    let windowAnchorMs = null; // end-timestamp of the currently open 60-minute window
    let lastKeptRowNumber = null;

    for (let i = 0; i < candidateRows.length; i++) {
      const current = candidateRows[i];

      if (windowAnchorMs === null) {
        // First row in scope: starts a new window
        windowAnchorMs = current.timestampMs;
        lastKeptRowNumber = current.rowNumber;
        continue;
      }

      if (current.timestampMs - windowAnchorMs < ONE_HOUR_MS) {
        // Falls within the rolling 60-minute window of the last kept snapshot;
        // this snapshot is newer, so it replaces the previously kept one.
        rowsToDelete.push(lastKeptRowNumber);
        lastKeptRowNumber = current.rowNumber;
        windowAnchorMs = current.timestampMs;
      } else {
        // Outside the window; keep this row and start a new window from it.
        lastKeptRowNumber = current.rowNumber;
        windowAnchorMs = current.timestampMs;
      }
    }

    Logger.log('[DOWNSAMPLE] Candidate rows: ' + candidateRows.length + ', Marked for deletion: ' + rowsToDelete.length);

    if (rowsToDelete.length === 0) {
      return {
        success: true,
        totalBefore: totalDataRowsBefore,
        totalAfter: totalDataRowsBefore,
        totalRemoved: 0,
        percentageRemoved: 0,
        durationMs: Date.now() - startTime,
        message: 'Last year of data is already at or below 1 entry per hour. No action taken.'
      };
    }

    // Safety threshold: abort if more than 80% of total rows would be removed
    if ((rowsToDelete.length / totalDataRowsBefore) > 0.80) {
      return {
        success: false,
        error: 'Downsampling would remove ' + ((rowsToDelete.length / totalDataRowsBefore) * 100).toFixed(1) + '% of data. Aborting as safety measure. Check data integrity.',
        totalBefore: totalDataRowsBefore,
        totalAfter: totalDataRowsBefore,
        totalRemoved: 0,
        percentageRemoved: 0,
        durationMs: Date.now() - startTime
      };
    }

    // Batch delete rows in reverse order from bottom to top to avoid index shifting
    rowsToDelete.sort((a, b) => b - a);
    for (let i = 0; i < rowsToDelete.length; i++) {
      sheet.deleteRow(rowsToDelete[i]);
    }

    const totalDataRowsAfter = Math.max(0, sheet.getLastRow() - 1);
    const totalRemoved = totalDataRowsBefore - totalDataRowsAfter;
    const percentageRemoved = totalDataRowsBefore > 0 ? Number(((totalRemoved / totalDataRowsBefore) * 100).toFixed(1)) : 0;
    const durationMs = Date.now() - startTime;

    Logger.log('[DOWNSAMPLE] Finished in ' + durationMs + 'ms. Rows remaining: ' + totalDataRowsAfter);

    return {
      success: true,
      totalBefore: totalDataRowsBefore,
      totalAfter: totalDataRowsAfter,
      totalRemoved: totalRemoved,
      percentageRemoved: percentageRemoved,
      durationMs: durationMs,
      message: 'Downsampled ' + totalRemoved + ' rows. Kept ' + totalDataRowsAfter + '.'
    };
  } catch (err) {
    Logger.log('[DOWNSAMPLE] Error: ' + err);
    return {
      success: false,
      error: (err && (err.message || err.toString())) || 'Unknown downsampling error',
      totalBefore: 0,
      totalAfter: 0,
      totalRemoved: 0,
      percentageRemoved: 0,
      durationMs: Date.now() - startTime
    };
  } finally {
    releaseSyncLock();
  }
}

/**
 * Returns the script project ID for admin access link.
 */
function getScriptProjectId() {
  return ScriptApp.getScriptId();
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
    throw new Error('A sync or maintenance task is already in progress. Please wait ' + waitSec + 's.');
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
 * Checks if the automated background trigger is installed and property enabled.
 * @return {boolean}
 */
function isTriggerActive() {
  const scriptProps = PropertiesService.getScriptProperties();
  const propVal = scriptProps.getProperty(AUTO_SYNC_PROP_KEY);
  if (propVal !== null) {
    return propVal === 'true';
  }

  // Fallback to checking project triggers directly
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestTaskMetrics') {
      return true;
    }
  }
  return true; // Default is true if unset
}

/**
 * Ensures AUTO_SYNC_ENABLED property and background trigger are initialized by default.
 */
function ensureAutoSyncDefault() {
  const scriptProps = PropertiesService.getScriptProperties();
  const propVal = scriptProps.getProperty(AUTO_SYNC_PROP_KEY);

  if (propVal === null) {
    // First time setup: set property to 'true' and install trigger
    scriptProps.setProperty(AUTO_SYNC_PROP_KEY, 'true');
    setTriggerEnabled(true);
  } else if (propVal === 'true') {
    // Ensure trigger actually exists if property is true
    const triggers = ScriptApp.getProjectTriggers();
    let triggerExists = false;
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'ingestTaskMetrics') {
        triggerExists = true;
        break;
      }
    }
    if (!triggerExists) {
      ScriptApp.newTrigger('ingestTaskMetrics')
        .timeBased()
        .everyHours(3)
        .create();
    }
  }
}

/**
 * Sets the auto-sync property and updates the project trigger.
 * @param {boolean} enable
 * @return {boolean} New active state
 */
function setTriggerEnabled(enable) {
  const scriptProps = PropertiesService.getScriptProperties();
  scriptProps.setProperty(AUTO_SYNC_PROP_KEY, enable ? 'true' : 'false');

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
