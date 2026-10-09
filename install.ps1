# Install or update progress-band for Claude Code (Windows PowerShell):
#
#     irm https://raw.githubusercontent.com/anthonybo/progress-band/main/install.ps1 | iex
#
# Adds this repo as a plugin marketplace, installs the plugin for your user (every project, every session),
# and creates the folder Claude writes progress files to. Running it again updates to the latest version.
$ErrorActionPreference = 'Stop'

$Repo = 'anthonybo/progress-band'
$Name = 'progress-band'

function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Host "error: the 'claude' command is not on your PATH. Install Claude Code first: https://claude.com/claude-code" -ForegroundColor Red
    return
}

function Invoke-Claude([string[]]$ClaudeArgs) {
    & claude @ClaudeArgs
    if ($LASTEXITCODE -ne 0) { throw "claude $($ClaudeArgs -join ' ') failed (exit $LASTEXITCODE)" }
}

$markets = (& claude plugin marketplace list --json 2>$null) -join "`n"
if ($markets -match "`"name`":\s*`"$Name`"") {
    Say "updating the $Name marketplace"
    Invoke-Claude @('plugin', 'marketplace', 'update', $Name)
} else {
    Say "adding the $Name marketplace ($Repo)"
    Invoke-Claude @('plugin', 'marketplace', 'add', $Repo)
}

$plugins = (& claude plugin list --json 2>$null) -join "`n"
if ($plugins -match "`"id`":\s*`"$Name@$Name`"") {
    Say 'updating the plugin'
    Invoke-Claude @('plugin', 'update', "$Name@$Name")
} else {
    Say 'installing the plugin'
    Invoke-Claude @('plugin', 'install', "$Name@$Name")
}

$config = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$dir = Join-Path $config 'progress'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Say 'done'
Write-Host ""
Write-Host "  progress-band is installed. New Claude Code sessions show the band; in a session that is"
Write-Host "  already open, run /reload-plugins."
Write-Host ""
Write-Host "  Claude now writes progress files to $dir"
Write-Host "  on its own when it starts multi-step work. /progress hides or shows the band."
