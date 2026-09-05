/**
 * Google Tasks Dashboard - Backend Code
 */

const SPREADSHEET_PROP_KEY = 'SPREADSHEET_ID';
const AUTO_SYNC_PROP_KEY = 'AUTO_SYNC_ENABLED';
const PAGE_FETCH_LIMIT = 50; // Safety batch size within Apps Script limits
const SHEET_HEADERS = ['timestamp', 'open', 'completed', 'overdue', 'overdue_severity'];
const TOP_OVERDUE_ITEMS = 5;
const TOP_OVERDUE_HEADERS = ['taskId', 'taskListId', 'taskListName', 'title', 'dueDate', 'overdueDuration', 'severity'];
const OVERDUE_HOUR = 21;
const DEFAULT_TIMEZONE = 'Europe/Bucharest';
const TIMEOUT_INTERACTIVE_MS = 5000; // 5s for user-clicked operations
const TIMEOUT_TRIGGER_MS = 10000; // 10s for automated triggers

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
 * Executes a callback while holding a script-level mutex lock.
 * Uses LockService for true mutual exclusion across all executions.
 * Automatically flushes spreadsheet before releasing the lock.
 * @param {number} timeoutMs - Timeout in milliseconds for lock acquisition
 * @param {Function} callback - Function to execute while holding the lock
 * @return {Object} - {success: true, result: callback_result} or {success: false, error: string}
 */
function withScriptLock(timeoutMs, callback) {
  const lock = LockService.getScriptLock();
  
  if (!lock.tryLock(timeoutMs)) {
    return {
      success: false,
      error: 'Another sync or maintenance operation is already running. Try again shortly.'
    };
  }

  try {
    const result = callback();
    // Flush any pending Spreadsheet operations before releasing the lock
    SpreadsheetApp.flush();
    return {
      success: true,
      result: result
    };
  } catch (err) {
    Logger.log('Error during locked operation: ' + err);
    return {
      success: false,
      error: (err && (err.message || err.toString())) || 'Unknown error during operation'
    };
  } finally {
    lock.releaseLock();
  }
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
 * Retrieves or creates the Top Overdue sheet for storing top 10 overdue tasks.
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateTopOverdueSheet() {
  const metricsSheet = getOrCreateSheet();
  const spreadsheet = metricsSheet.getParent();
  let topOverdueSheet = spreadsheet.getSheetByName('Top Overdue');

  if (!topOverdueSheet) {
    topOverdueSheet = spreadsheet.insertSheet('Top Overdue');
    topOverdueSheet.appendRow(TOP_OVERDUE_HEADERS);
    topOverdueSheet.setFrozenRows(1);
  } else if (topOverdueSheet.getLastRow() === 0) {
    topOverdueSheet.appendRow(TOP_OVERDUE_HEADERS);
    topOverdueSheet.setFrozenRows(1);
  }

  return topOverdueSheet;
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

/**
 * Retrieves timezone from account settings with fallback to default.
 * @return {string} - IANA timezone string
 */
function getTimezone() {
  try {
    return Session.getScriptTimeZone();
  } catch (e) {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Iterates over all tasks across all lists with pagination support.
 * Calls callback(task, listId, listTitle) for each task.
 * Handles rate limits and malformed responses gracefully.
 * @param {Function} callback - Called with (task, listId, listTitle) for each task
 * @return {boolean} - true if completed successfully, false if encountered errors
 */
function forEachTaskInAllLists(callback) {
  let taskListsResult;
  try {
    taskListsResult = Tasks.Tasklists.list();
  } catch (err) {
    Logger.log('Failed to fetch task lists: ' + err);
    return false;
  }

  const taskLists = (taskListsResult && taskListsResult.items) ? taskListsResult.items : [];
  let hadErrors = false;

  for (let i = 0; i < taskLists.length; i++) {
    const listId = taskLists[i].id;
    const listTitle = taskLists[i].title || 'Untitled';
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
        hadErrors = true;
        break;
      }

      if (!response || !response.items || !Array.isArray(response.items)) {
        break;
      }

      const tasks = response.items;
      for (let j = 0; j < tasks.length; j++) {
        const task = tasks[j];
        if (!task) continue;
        callback(task, listId, listTitle);
      }

      pageToken = response.nextPageToken;
    } while (pageToken);
  }

  return !hadErrors;
}

/**
 * Calculates the UTC time corresponding to overdueHour:00:00 on a given calendar date
 * in the specified timezone.
 * @param {string} dueDateStr - Calendar date in YYYY-MM-DD format (from Tasks API)
 * @param {string} timezone - IANA timezone string (e.g., 'Europe/Bucharest')
 * @param {number} overdueHour - Hour of day (0-23) when task becomes overdue in target timezone
 * @return {Date} - UTC time representing that deadline
 */
function getOverdueDeadline(dueDateStr, timezone, overdueHour) {
  const parts = dueDateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  // Find which UTC hour on this date corresponds to overdueHour in the target timezone
  for (let utcHour = 0; utcHour < 24; utcHour++) {
    const candidateUTC = new Date(Date.UTC(year, month, day, utcHour, 0, 0));
    const formattedInTZ = Utilities.formatDate(candidateUTC, timezone, 'HH:mm');
    const [tzHour] = formattedInTZ.split(':').map(Number);

    if (tzHour === overdueHour) {
      return candidateUTC;
    }
  }

  // Fallback (should not reach here for valid inputs)
  return new Date(Date.UTC(year, month, day, overdueHour, 0, 0));
}

/**
 * Internal metrics ingestion logic (assumes caller holds the lock).
 * Fetches all tasks, calculates metrics, persists snapshot and top overdue.
 * @return {Object} - snapshot object {timestamp, open, completed, overdue, overdue_severity}
 */
function ingestTaskMetricsInternal() {
  const now = new Date();
  const sixMonthsCutoff = new Date(now);
  sixMonthsCutoff.setMonth(sixMonthsCutoff.getMonth() + 6);
  
  // Cache timezone and deadline lookups to avoid redundant calls
  const timezone = getTimezone();
  const deadlineCache = {}; // Map of dueDateStr -> overdueDeadline

  let totalOpen = 0;
  let totalCompleted = 0;
  let totalOverdue = 0;
  let totalOverdueSeverity = 0.0;
  const overdueTasksList = [];

  forEachTaskInAllLists((task, listId, listTitle) => {
    const weight = getTaskWeight(task.title);

    if (task.status === 'completed') {
      totalCompleted += weight;
    } else if (task.status === 'needsAction') {
      if (!task.due) {
        totalOpen += weight;
      } else {
        const dueDateStr = task.due;
        const dueDateObj = new Date(dueDateStr);

        if (!isNaN(dueDateObj.getTime()) && dueDateObj <= sixMonthsCutoff) {
          totalOpen += weight;

          // Memoize deadline calculation by due date
          if (!deadlineCache[dueDateStr]) {
            deadlineCache[dueDateStr] = getOverdueDeadline(dueDateStr, timezone, OVERDUE_HOUR);
          }
          const overdueDeadline = deadlineCache[dueDateStr];

          if (now >= overdueDeadline) {
            totalOverdue += weight;
            const diffMs = now.getTime() - overdueDeadline.getTime();
            const daysOverdue = diffMs / (1000 * 60 * 60 * 24);
            const severity = weight * Math.sqrt(daysOverdue);
            totalOverdueSeverity += severity;

            overdueTasksList.push({
              taskId: task.id,
              taskListId: listId,
              taskListName: listTitle,
              title: task.title || '',
              dueDate: dueDateStr,
              overdueDuration: daysOverdue,
              severity: Number(severity.toFixed(2))
            });
          }
        }
      }
    }
  });

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

  overdueTasksList.sort((a, b) => b.severity - a.severity);
  const topTen = overdueTasksList.slice(0, 10);
  updateTopOverdueSheet(topTen);

  return snapshot;
}

/**
 * Public entry point for metrics ingestion (locking wrapper).
 * Acquires script lock before delegating to ingestTaskMetricsInternal.
 * Used by manual sync trigger and automated background sync.
 * @return {Object} - {success: true, result: snapshot} or {success: false, error: string}
 */
function ingestTaskMetrics() {
  return withScriptLock(TIMEOUT_TRIGGER_MS, ingestTaskMetricsInternal);
}

/**
 * Updates the Top Overdue sheet with the top 10 overdue tasks.
 * Clears existing data and writes new top 10 rows.
 * @param {Array<Object>} topTenTasks - Array of top 10 overdue task objects
 */
function updateTopOverdueSheet(topTenTasks) {
  const sheet = getOrCreateTopOverdueSheet();
  const lastRow = sheet.getLastRow();

  // Delete all data rows (keep header at row 1)
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }

  // Append new top 10 rows
  for (let i = 0; i < topTenTasks.length; i++) {
    const task = topTenTasks[i];
    sheet.appendRow([
      task.taskId,
      task.taskListId,
      task.taskListName,
      task.title,
      task.dueDate,
      Number(task.overdueDuration.toFixed(2)),
      task.severity
    ]);
  }
}

/**
 * Fetches all historical time series metrics from the spreadsheet.
 * Includes data validation and type coercion. Also fetches top 10 overdue tasks.
 * @return {Object} { headers: string[], rows: Array<Array<any>>, sheetUrl: string, triggerActive: boolean, topOverdueTasksTop3: Array<Object> }
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

  // Fetch top 3 overdue tasks from the Top Overdue sheet
  const topOverdueTasksTopX = getTopOverdueTasksTopX();

  return {
    headers: headers,
    rows: validRows,
    sheetUrl: sheetUrl,
    triggerActive: isTriggerActive(),
    topOverdueTasksTopX: topOverdueTasksTopX
  };
}

/**
 * Fetches the top 3 overdue tasks from the Top Overdue sheet.
 * @return {Array<Object>} Top 3 overdue tasks or empty array if none exist
 */
function getTopOverdueTasksTopX() {
  try {
    const sheet = getOrCreateTopOverdueSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return [];
    }

    const rawValues = sheet.getRange(2, 1, Math.min(TOP_OVERDUE_ITEMS, lastRow - 1), 7).getValues();
    const tasks = [];

    for (let i = 0; i < rawValues.length; i++) {
      const row = rawValues[i];
      if (!row || !row[0]) continue;

      tasks.push({
        taskId: row[0] || '',
        taskListId: row[1] || '',
        taskListName: row[2] || '',
        title: row[3] || '',
        dueDate: row[4] || '',
        overdueDuration: isNaN(Number(row[5])) ? 0 : Number(row[5]),
        severity: isNaN(Number(row[6])) ? 0 : Number(row[6])
      });
    }

    return tasks;
  } catch (e) {
    Logger.log('Error fetching top overdue tasks: ' + e);
    return [];
  }
}

/**
 * Concurrency-safe manual sync (interactive entry point).
 * @return {Object} Refreshed dashboard data or error.
 */
function syncNow() {
  return withScriptLock(TIMEOUT_INTERACTIVE_MS, () => {
    ingestTaskMetricsInternal();
    return getDashboardData();
  });
}

/**
 * Concurrency-safe Sync and Clear ALL completed tasks across all lists (interactive entry point).
 * @return {Object} Refreshed dashboard data or error.
 */
function syncAndClearTasks() {
  return withScriptLock(TIMEOUT_INTERACTIVE_MS, () => {
    // 1. Ingest metrics first for safe persistence
    ingestTaskMetricsInternal();

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
  });
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
  
  const result = withScriptLock(TIMEOUT_INTERACTIVE_MS, () => {
    const cutoffMs = weeks * 7 * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(startTime - cutoffMs);
    let totalDeleted = 0;

    forEachTaskInAllLists((task, listId, listTitle) => {
      if (task.status !== 'completed') return;

      let isOld = false;
      if (task.completed) {
        const completedDate = new Date(task.completed);
        if (!isNaN(completedDate.getTime()) && completedDate < cutoffDate) {
          isOld = true;
        }
      } else if (task.updated) {
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
    });

    ingestTaskMetricsInternal();
    const dashboardData = getDashboardData();
    const durationMs = Date.now() - startTime;

    Logger.log('[DELETE_OLD] Deleted ' + totalDeleted + ' tasks older than ' + weeks + ' weeks in ' + durationMs + 'ms');

    return {
      success: true,
      tasksDeleted: totalDeleted,
      durationMs: durationMs,
      data: dashboardData
    };
  });

  // Unwrap the withScriptLock result
  if (!result.success) {
    return {
      success: false,
      tasksDeleted: 0,
      durationMs: Date.now() - startTime,
      error: result.error
    };
  }

  return result.result;
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
 * Unified compression function for sheet data cleanup.
 * Mode "daily": Reduces old data (>1 year) to 1 snapshot per calendar day.
 * Mode "hourly": Reduces recent data (<1 year) to 1 snapshot per 60-minute window.
 * @param {string} mode - Either "daily" or "hourly"
 * @return {Object} { success: boolean, totalBefore: number, totalAfter: number, totalRemoved: number, percentageRemoved: number, durationMs: number, message?: string, error?: string }
 */
function compressSheetData(mode) {
  const startTime = Date.now();
  
  const result = withScriptLock(TIMEOUT_INTERACTIVE_MS, () => {
    const isDaily = mode === 'daily';
    const logPrefix = isDaily ? '[PRUNE]' : '[DOWNSAMPLE]';

    const sheet = getOrCreateSheet();
    const lastRow = sheet.getLastRow();
    const totalDataRowsBefore = Math.max(0, lastRow - 1);

    if (totalDataRowsBefore < 10) {
      return {
        success: false,
        error: 'Insufficient rows (' + totalDataRowsBefore + ' total). No action taken.',
        totalBefore: totalDataRowsBefore,
        totalAfter: totalDataRowsBefore,
        totalRemoved: 0,
        percentageRemoved: 0,
        durationMs: Date.now() - startTime
      };
    }

    const now = Date.now();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    const cutoffTimestamp = now - oneYearMs;
    const rangeValues = sheet.getRange(2, 1, totalDataRowsBefore, 1).getValues();

    const rowsToDelete = [];
    const seenBuckets = {}; // Map of bucketKey -> rowNumber (last seen in bucket)

    // For hourly: collect rows with their timestamps
    let candidateRows = null;
    if (!isDaily) {
      candidateRows = [];
      for (let i = 0; i < rangeValues.length; i++) {
        const rawDate = rangeValues[i][0];
        if (!rawDate) continue;
        const dateObj = new Date(rawDate);
        if (isNaN(dateObj.getTime())) continue;
        const rowNumber = i + 2;
        const timestampMs = dateObj.getTime();
        if (timestampMs >= cutoffTimestamp) {
          candidateRows.push({ rowNumber: rowNumber, timestampMs: timestampMs });
        }
      }
      if (candidateRows.length > 0) {
        candidateRows.sort((a, b) => a.timestampMs - b.timestampMs);
      }
    }

    // Identify rows to delete
    if (isDaily) {
      // Daily mode: old data (>1 year), keep 1 per calendar day
      for (let i = 0; i < rangeValues.length; i++) {
        const rawDate = rangeValues[i][0];
        if (!rawDate) continue;
        const dateObj = new Date(rawDate);
        if (isNaN(dateObj.getTime())) continue;
        const rowNumber = i + 2;
        if (dateObj.getTime() >= cutoffTimestamp) continue; // Skip recent data
        const dateKey = extractCalendarDate(dateObj);
        if (!dateKey) continue;
        if (seenBuckets[dateKey]) {
          rowsToDelete.push(rowNumber);
        } else {
          seenBuckets[dateKey] = rowNumber;
        }
      }
    } else {
      // Hourly mode: recent data (<1 year), keep 1 per fixed 60-minute bucket (latest wins)
      if (candidateRows && candidateRows.length > 0) {
        const ONE_HOUR_MS = 60 * 60 * 1000;
        const seenBuckets = {}; // bucket -> currently kept rowNumber (latest so far)

        for (let i = 0; i < candidateRows.length; i++) {
          const current = candidateRows[i];
          const bucket = Math.floor(current.timestampMs / ONE_HOUR_MS);

          if (Object.prototype.hasOwnProperty.call(seenBuckets, bucket)) {
            // A row is already kept for this bucket; since candidateRows is sorted
            // ascending, the current row is newer — replace the kept row and mark
            // the stale one for deletion.
            rowsToDelete.push(seenBuckets[bucket]);
            seenBuckets[bucket] = current.rowNumber;
          } else {
            seenBuckets[bucket] = current.rowNumber;
          }
        }
      }
    }

    Logger.log(logPrefix + ' Total rows before: ' + totalDataRowsBefore + ', Marked for deletion: ' + rowsToDelete.length);

    if (rowsToDelete.length === 0) {
      return {
        success: true,
        totalBefore: totalDataRowsBefore,
        totalAfter: totalDataRowsBefore,
        totalRemoved: 0,
        percentageRemoved: 0,
        durationMs: Date.now() - startTime,
        message: 'No cleanup needed.'
      };
    }

    // Safety threshold: abort if >80% would be removed
    if ((rowsToDelete.length / totalDataRowsBefore) > 0.80) {
      return {
        success: false,
        error: 'Would remove ' + ((rowsToDelete.length / totalDataRowsBefore) * 100).toFixed(1) + '% of data. Aborting.',
        totalBefore: totalDataRowsBefore,
        totalAfter: totalDataRowsBefore,
        totalRemoved: 0,
        percentageRemoved: 0,
        durationMs: Date.now() - startTime
      };
    }

    // Batch delete rows in reverse order to avoid index shifting
    rowsToDelete.sort((a, b) => b - a);
    for (let i = 0; i < rowsToDelete.length; i++) {
      sheet.deleteRow(rowsToDelete[i]);
    }

    const totalDataRowsAfter = Math.max(0, sheet.getLastRow() - 1);
    const totalRemoved = totalDataRowsBefore - totalDataRowsAfter;
    const percentageRemoved = totalDataRowsBefore > 0 ? Number(((totalRemoved / totalDataRowsBefore) * 100).toFixed(1)) : 0;
    const durationMs = Date.now() - startTime;

    Logger.log(logPrefix + ' Finished in ' + durationMs + 'ms. Rows remaining: ' + totalDataRowsAfter);

    return {
      success: true,
      totalBefore: totalDataRowsBefore,
      totalAfter: totalDataRowsAfter,
      totalRemoved: totalRemoved,
      percentageRemoved: percentageRemoved,
      durationMs: durationMs,
      message: 'Removed ' + totalRemoved + ' rows. Kept ' + totalDataRowsAfter + '.'
    };
  });

  // Unwrap the withScriptLock result
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      totalBefore: 0,
      totalAfter: 0,
      totalRemoved: 0,
      percentageRemoved: 0,
      durationMs: Date.now() - startTime
    };
  }

  return result.result;
}

/**
 * Reduces all rows older than 1 year (365 days) to 1 snapshot per calendar day.
 * Public wrapper for compressSheetData('daily').
 * @return {Object}
 */
function pruneDataOlderThan1Year() {
  return compressSheetData('daily');
}

/**
 * Downsamples the last 365 days of snapshot rows to at most 1 entry per 60-minute window.
 * Public wrapper for compressSheetData('hourly').
 * @return {Object}
 */
function downsampleLastYearToHourly() {
  return compressSheetData('hourly');
}

/**
 * Returns the script project ID for admin access link.
 */
function getScriptProjectId() {
  return ScriptApp.getScriptId();
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

  // Fallback to checking project triggers directly (property uninitialized)
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestTaskMetrics') {
      return true;
    }
  }
  return false; // No property and no trigger found
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
