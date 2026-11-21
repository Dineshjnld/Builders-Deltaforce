param([ValidateSet('Start','Pair','Status','Reconnect')][string]$Action = 'Start')

$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    New-Item -ItemType Directory -Force var | Out-Null
    if (!(Test-Path var/evolution.env)) {
        @('EVOLUTION_API_KEY','EVOLUTION_WEBHOOK_KEY','EVOLUTION_APPROVAL_KEY','EVOLUTION_DB_PASSWORD') |
            ForEach-Object {
                "$_=" + [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
            } | Set-Content var/evolution.env
    }
    $settings = Get-Content var/evolution.env -Raw | ConvertFrom-StringData
    $headers = @{ apikey = $settings.EVOLUTION_API_KEY }
    $api = 'http://127.0.0.1:8080'
    $name = 'deltaforce-demo'
    $webhook = @{
        enabled = $true; url = 'http://whatsapp:8788/webhooks/evolution'
        byEvents = $false; base64 = $true
        headers = @{ 'X-Evolution-Webhook-Key' = $settings.EVOLUTION_WEBHOOK_KEY }
        events = @('MESSAGES_UPSERT','CONNECTION_UPDATE')
    }

    if ($Action -eq 'Start') {
        docker compose --env-file var/evolution.env -p deltaforce-wa -f compose.yaml -f compose.evolution.yaml up -d --build --wait
        if ($LASTEXITCODE) { throw 'Compose startup failed.' }
        $existing = @(Invoke-RestMethod "$api/instance/fetchInstances" -Headers $headers) |
            Where-Object { $_.name -eq $name }
        if (!$existing) {
            $instance = @{
                instanceName = $name; integration = 'WHATSAPP-BAILEYS'; qrcode = $false
                groupsIgnore = $true; syncFullHistory = $false
            }
            $null = Invoke-RestMethod "$api/instance/create" -Method Post -Headers $headers -ContentType application/json -Body ($instance | ConvertTo-Json)
        } elseif ($existing.integration -ne 'WHATSAPP-BAILEYS') {
            throw 'The existing demo instance uses a different integration.'
        }
        $null = Invoke-RestMethod "$api/webhook/set/$name" -Method Post -Headers $headers -ContentType application/json -Body (@{ webhook = $webhook } | ConvertTo-Json -Depth 5)
        $saved = Invoke-RestMethod "$api/webhook/find/$name" -Headers $headers
        if ($saved.url -ne $webhook.url -or !$saved.enabled -or !$saved.webhookBase64 -or
            $saved.headers.'X-Evolution-Webhook-Key' -ne $settings.EVOLUTION_WEBHOOK_KEY -or
            'MESSAGES_UPSERT' -notin $saved.events -or 'CONNECTION_UPDATE' -notin $saved.events) {
            throw 'Evolution did not return the expected webhook configuration.'
        }
        Write-Output 'Registered deltaforce-demo webhook for messages and connection updates.'
    }

    if ($Action -eq 'Reconnect') {
        $null = Invoke-RestMethod "$api/instance/restart/$name" -Method Post -Headers $headers
    }

    $state = (Invoke-RestMethod "$api/instance/connectionState/$name" -Headers $headers).instance.state
    Write-Output "deltaforce-demo connection state: $state"
    if ($Action -eq 'Status') {
        docker compose --env-file var/evolution.env -p deltaforce-wa -f compose.yaml -f compose.evolution.yaml ps
        docker exec deltaforce-wa-whatsapp-1 python -m services.whatsapp.evolution_audit
        if ($LASTEXITCODE) { throw 'Could not read the connector audit.' }
    }
    if ($Action -eq 'Pair' -and $state -ne 'open') {
        $qr = $null
        for ($attempt = 0; $attempt -lt 8 -and !$qr.base64; $attempt++) {
            $qr = Invoke-RestMethod "$api/instance/connect/$name" -Headers $headers
            if (!$qr.base64) { Start-Sleep -Seconds 2 }
        }
        if ($qr.base64 -notmatch '^data:image/png;base64,([A-Za-z0-9+/=]+)$') {
            throw 'Evolution did not return a pairing QR. Check its connection status and logs.'
        }
        $path = Join-Path $PWD ("var/deltaforce-demo-qr-" + [Guid]::NewGuid().ToString("N") + ".png")
        [IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($Matches[1]))
        Start-Process -FilePath $path
        Write-Output 'Opened the pairing QR locally. Scan it using Linked devices on the dedicated test account.'
    }
} finally {
    Pop-Location
}

