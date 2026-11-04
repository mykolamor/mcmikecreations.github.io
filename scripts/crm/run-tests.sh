#!/usr/bin/env bash
# Runs every *.test.ts under src/lib and scripts/crm with jiti and the $lib alias.
set -u
cd "$(dirname "$0")/../.."
export JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}'
status=0
while IFS= read -r f; do
	echo "# $f"
	node_modules/.bin/jiti "$f" || status=1
done < <(find src/lib scripts/crm -name '*.test.ts' | sort)
exit $status
