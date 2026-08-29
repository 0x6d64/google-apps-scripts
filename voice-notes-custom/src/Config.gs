/**
 * Config.gs
 *
 * Unified configuration for calendar and sheet endpoints.
 * Loads from Script Properties with documented fallbacks.
 */

/**
 * Reads configuration from Script Properties, applying fallbacks.
 *
 * @return {{
 *   sharedSecret: (string|null),
 *   spreadsheetName: string,
 *   sheetName: string,
 *   timezone: string
 * }}
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  return {
    sharedSecret: props.getProperty('SHARED_SECRET'),
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
 * Generates a SHARED_SECRET if one isn't already configured, and fills
 * in default values for the remaining properties. Existing values are
 * never overwritten.
 *
 * The generated token is written to the execution log ONLY — copy it
 * into your client's environment variable (PEBBLE_SECRET for watch,
 * SHEETPOST_TOKEN for CLI). It is never stored anywhere else and cannot
 * be recovered later; if you lose it, delete the SHARED_SECRET property
 * and re-run setup().
 *
 * @return {string|null} The newly generated secret if setup was executed, or null.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let generatedSecret = null;

  if (!props.getProperty('SHARED_SECRET')) {
    const secret = generateRandomToken();
    props.setProperty('SHARED_SECRET', secret);
    Logger.log('Generated SHARED_SECRET (copy this now, it will not be shown again):');
    Logger.log(secret);
    generatedSecret = secret;
  } else {
    Logger.log('SHARED_SECRET already set — leaving unchanged.');
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
  return generatedSecret;
}
