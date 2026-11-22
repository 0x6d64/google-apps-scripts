/**
 * Build stamp. The committed value is a placeholder; deploy.sh overwrites it
 * with the git commit hash for the push and restores it afterwards.
 */
const BUILD_COMMIT = 'dev';
const BUILD_TIME = '';

/**
 * Returns build info so the deployed version can be inspected.
 * @return {{commit: string, time: string}}
 */
function getBuildInfo() {
  return { commit: BUILD_COMMIT, time: BUILD_TIME };
}
