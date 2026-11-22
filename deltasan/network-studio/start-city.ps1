$ErrorActionPreference = "Stop"
$runtime = Join-Path $env:LOCALAPPDATA "NeuroNetworkStudio"
$tokenPath = Join-Path $runtime "city-token"
if (-not (Test-Path -LiteralPath $tokenPath)) {
    $bytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    [IO.File]::WriteAllText($tokenPath, [Convert]::ToHexString($bytes))
}
if (Get-NetTCPConnection -LocalPort 45187 -State Listen -ErrorAction SilentlyContinue) { return }
$env:DELTA_CITY_TOKEN = [IO.File]::ReadAllText($tokenPath)
try {
    Start-Process -FilePath "$runtime/venv/Scripts/python.exe" -WindowStyle Hidden -WorkingDirectory $PSScriptRoot -ArgumentList @("-m","uvicorn","city_server:app","--host","127.0.0.1","--port","45187") -RedirectStandardError "$PSScriptRoot/logs/city-error.log" -RedirectStandardOutput "$PSScriptRoot/logs/city.log"
} finally {
    Remove-Item Env:DELTA_CITY_TOKEN
}
