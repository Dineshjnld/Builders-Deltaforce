param(
    [ValidateSet("ollama","openai","anthropic","gemini","compatible")]
    [string] $Provider = "ollama",
    [string] $Model,
    [uri] $BaseUrl
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$defaults = @{ollama="qwen2.5:1.5b";openai="gpt-4.1-mini";anthropic="claude-sonnet-4-5";gemini="gemini-2.5-flash"}
if (!$Model) { $Model = $defaults[$Provider] }
if (!$Model) { throw "Supply -Model with the endpoint's model ID." }
foreach ($port in 45173,45184) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is in use. Stop the running studio before switching providers."
    }
}
$settings = @{ class=$Provider; model_name=$Model }
$keyNames = @{openai="OPENAI_API_KEY";anthropic="ANTHROPIC_API_KEY";gemini="GOOGLE_API_KEY";compatible="COMPATIBLE_API_KEY"}
if ($Provider -eq "compatible") {
    if (!$BaseUrl -or !$BaseUrl.IsAbsoluteUri -or $BaseUrl.Scheme -notin "https","http") { throw "Supply -BaseUrl for the compatible endpoint." }
    $settings.class = "openai"
    $settings.openai_api_base = $BaseUrl.AbsoluteUri.TrimEnd("/")
    $settings.use_responses_api = $false
}
if ($Provider -ne "ollama") {
    $variable = $keyNames[$Provider]
    $key = [Environment]::GetEnvironmentVariable($variable)
    if (!$key) { $key = Read-Host "Enter $variable for this session" -MaskInput }
    if (!$key) { throw "A key is required. For a keyless compatible server use a placeholder." }
    if ($Provider -eq "compatible") { $variable = "OPENAI_API_KEY" }
    [Environment]::SetEnvironmentVariable($variable,$key)
}
@{llm_config=$settings} | ConvertTo-Json | Set-Content config/llm_config.hocon -Encoding utf8NoBOM
$env:NSFLOW_HOST="127.0.0.1"
$env:NSFLOW_PORT="45173"
$env:NEURO_SAN_SERVER_HOST="127.0.0.1"
$env:NEURO_SAN_SERVER_HTTP_PORT="45184"
$env:PYTHONUTF8="1"
$bin = "$env:LOCALAPPDATA/NeuroNetworkStudio/venv/Scripts"
$env:Path = "$bin;$env:Path"
& "$PSScriptRoot/start-city.ps1"
& "$bin/ns.exe" run
exit $LASTEXITCODE
