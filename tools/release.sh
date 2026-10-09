#!/bin/sh
# Cut a release: bump the version, run the checks, commit and tag. Run from the repo root:
#
#     sh tools/release.sh 1.1.0
#
# `claude plugin update` (and install.sh's update path) only fetches a change when this version goes up,
# so every change meant for other machines needs one. Pushing is left to you: git push --follow-tags
set -eu
cd "$(dirname "$0")/.."
v="${1:-}"
echo "$v" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "usage: sh tools/release.sh X.Y.Z" >&2; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "commit or stash your changes first" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$v" >/dev/null && { echo "v$v already exists" >&2; exit 1; }

claude plugin validate . >/dev/null 2>&1
claude plugin test . >/dev/null 2>&1 || { echo "tests failed: claude plugin test ." >&2; exit 1; }

tmp="$(mktemp)"
sed -E "s/(\"version\": *\")[^\"]+(\")/\1$v\2/" .claude-plugin/plugin.json >"$tmp" && mv "$tmp" .claude-plugin/plugin.json
grep -q "\"version\": \"$v\"" .claude-plugin/plugin.json || { echo "could not set the version" >&2; exit 1; }
git add .claude-plugin/plugin.json
git commit -q -m "Release $v"
git tag "v$v"
echo "v$v committed and tagged. Publish it with: git push --follow-tags"
