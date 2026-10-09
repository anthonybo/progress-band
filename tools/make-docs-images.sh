#!/bin/sh
# Regenerate the README images from the band's real render code. Run from the repo root:
#
#     sh tools/make-docs-images.sh
#
# tests/render.test.ts draws the band from made-up sample data (no real projects or agents) and prints the
# drawn trees; tools/tree-to-svg.py turns each into an SVG in docs/.
set -eu
cd "$(dirname "$0")/.."
mkdir -p docs
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
claude plugin test . >"$out" 2>&1 || { cat "$out" >&2; exit 1; }
for name in still change; do
  grep -o "@@$name .*" "$out" | head -1 | cut -d' ' -f2- | python3 tools/tree-to-svg.py >"docs/band-$name.svg"
  echo "wrote docs/band-$name.svg"
done
