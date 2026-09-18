param([int]$Port = 8765, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'run_local.py'
$candidates = @(
    @{ Exe = (Join-Path $PSScriptRoot '.venv\Scripts\python.exe'); Prefix = @() },
    @{ Exe = 'py'; Prefix = @('-3.12') },
    @{ Exe = 'py'; Prefix = @('-3') },
    @{ Exe = 'python'; Prefix = @() }
)
foreach ($candidate in $candidates) {
    $exe = $candidate.Exe
    $prefix = $candidate.Prefix
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    try {
        & $exe @prefix -c 'import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)' 2>$null
        if ($LASTEXITCODE -ne 0) { continue }
    } catch { continue }
    $launchArgs = @($launcher, '--port', "$Port")
    if ($NoBrowser) { $launchArgs += '--no-browser' }
    & $exe @prefix @launchArgs
    exit $LASTEXITCODE
}
Write-Host 'Python 3.12 or newer was not found. Install Python (with PATH enabled), then run Start-PixelSnake.cmd again.' -ForegroundColor Red
exit 1
