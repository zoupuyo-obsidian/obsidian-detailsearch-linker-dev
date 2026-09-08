# Fail if HEAD (or --all) contains Cursor Co-authored-by. Run before every push.
param(
	[string]$Repo = (Split-Path -Parent $PSScriptRoot),
	[switch]$All
)
$ErrorActionPreference = "Stop"
$git = "C:\Program Files\Git\mingw64\bin\git.exe"
if (-not (Test-Path $git)) { throw "Git not found at $git" }

$sha = & $git -C $Repo rev-parse HEAD
$sha = ($sha | Out-String).Trim()
if ($sha -notmatch '^[0-9a-f]{40}$') { throw "invalid HEAD: $sha" }

$range = if ($All) { "--all" } else { "-1" }
$bad = & $git -C $Repo log $range --format="%B" | Select-String "Co-authored-by: Cursor|cursoragent"
if ($bad) { throw "STOP: Co-authored-by: Cursor / cursoragent found. Recreate the commit with scripts/commit-clean.ps1" }

Write-Host "push-gate ok HEAD=$sha"
