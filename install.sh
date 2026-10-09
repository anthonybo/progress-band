#!/bin/sh
# Install or update progress-band for Claude Code (macOS / Linux):
#
#     curl -fsSL https://raw.githubusercontent.com/anthonybo/progress-band/main/install.sh | sh
#
# Adds this repo as a plugin marketplace, installs the plugin for your user (every project, every session),
# and creates the folder Claude writes progress files to. Running it again updates to the latest version.
set -eu

REPO="anthonybo/progress-band"
NAME="progress-band"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || die "the 'claude' command is not on your PATH. Install Claude Code first: https://claude.com/claude-code"

if claude plugin marketplace list --json 2>/dev/null | grep -q "\"name\": *\"$NAME\""; then
  say "updating the $NAME marketplace"
  claude plugin marketplace update "$NAME"
else
  say "adding the $NAME marketplace ($REPO)"
  claude plugin marketplace add "$REPO"
fi

if claude plugin list --json 2>/dev/null | grep -q "\"id\": *\"$NAME@$NAME\""; then
  say "updating the plugin"
  claude plugin update "$NAME@$NAME"
else
  say "installing the plugin"
  claude plugin install "$NAME@$NAME"
fi

dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/progress"
mkdir -p "$dir"

say "done"
cat <<EOF

  progress-band is installed. New Claude Code sessions show the band; in a session that is
  already open, run /reload-plugins (in cmux, once in each pane you keep open).

  Claude now writes progress files to $dir
  on its own when it starts multi-step work. /progress hides or shows the band.
EOF
