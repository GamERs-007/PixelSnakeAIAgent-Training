$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Install rl/requirements.txt in .venv first.' }
Write-Host 'Open http://127.0.0.1:8765 in your browser. Keep this terminal running.'
& $python -m rl.web_server
