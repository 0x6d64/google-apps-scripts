/**
 * Config.gs
 *
 * Loads configuration from Script Properties and applies documented
 * fallbacks. See requirements section 3.
 */

/**
 * Reads configuration from Script Properties, applying fallbacks
 * per requirements section 3.
 *
 * @return {{
 *   webhookToken: (string|null),
 *   spreadsheetName: string,
 *   sheetName: string,
 *   timezone: string
 * }}
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  return {
    // No fallback: if missing, the script will not function (by design).
    webhookToken: props.getProperty('WEBHOOK_TOKEN'),
    spreadsheetName: props.getProperty('SPREADSHEET_NAME') || 'Notes',
    sheetName: props.getProperty('SHEET_NAME') || 'Notes',
    timezone: props.getProperty('TIMEZONE') || 'UTC'
  };
}

/**
 * One-time interactive setup. Run this manually from the Apps Script
 * editor (select "setup" in the function dropdown, then "Run") after
 * first deploying the project.
 *
 * Generates a WEBHOOK_TOKEN if one isn't already configured, and fills
 * in default values for the remaining properties. Existing values are
 * never overwritten.
 *
 * The generated token is written to the execution log ONLY — copy it
 * from there into your client's SHEETPOST_TOKEN environment variable.
 * It is never stored anywhere else and cannot be recovered later; if
 * you lose it, delete the WEBHOOK_TOKEN property and re-run setup().
 */
function setup() {
  const props = PropertiesService.getScriptProperties();

  if (!props.getProperty('WEBHOOK_TOKEN')) {
    const token = generateRandomToken();
    props.setProperty('WEBHOOK_TOKEN', token);
    Logger.log('Generated WEBHOOK_TOKEN (copy this now, it will not be shown again):');
    Logger.log(token);
  } else {
    Logger.log('WEBHOOK_TOKEN already set — leaving unchanged.');
  }

  if (!props.getProperty('SPREADSHEET_NAME')) {
    props.setProperty('SPREADSHEET_NAME', 'Notes');
    Logger.log('SPREADSHEET_NAME defaulted to "Notes"');
  }

  if (!props.getProperty('SHEET_NAME')) {
    props.setProperty('SHEET_NAME', 'Notes');
    Logger.log('SHEET_NAME defaulted to "Notes"');
  }

  if (!props.getProperty('TIMEZONE')) {
    props.setProperty('TIMEZONE', 'UTC');
    Logger.log('TIMEZONE defaulted to "UTC"');
  }

  Logger.log('Setup complete. Review values under Project Settings > Script Properties.');
}
