#!/usr/bin/env bash
# Stamps the current git commit into webhook/Version.js, pushes with clasp,
# then restores the placeholder so the working tree stays clean.
set -euo pipefail
cd "$(dirname "$0")"

commit=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain -- webhook)" ]; then
  commit="${commit}-dirty"
fi
stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

trap 'git checkout -- webhook/Version.js' EXIT

cat > webhook/Version.js <<JS
const BUILD_COMMIT = '${commit}';
const BUILD_TIME = '${stamp}';

/**
 * Returns build info so the deployed version can be inspected.
 * @return {{commit: string, time: string}}
 */
function getBuildInfo() {
  return { commit: BUILD_COMMIT, time: BUILD_TIME };
}
JS

(cd webhook && clasp push -f)
echo "Deployed ${commit} at ${stamp}"
