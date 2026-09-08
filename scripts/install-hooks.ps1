# Enable repo-local git hooks (strips Cursor Co-authored-by trailers; blocks dirty push).
$ErrorActionPreference = "Stop"
$git = "C:\Program Files\Git\mingw64\bin\git.exe"
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repoRoot ".githooks\prepare-commit-msg"))) {
	throw "Missing .githooks\prepare-commit-msg"
}
if (-not (Test-Path $git)) { throw "Git not found at $git" }
Set-Location $repoRoot
& $git config core.hooksPath .githooks
Write-Host "core.hooksPath set to .githooks"
