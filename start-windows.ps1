$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$voiceBrowserPort = 8789

try {
    $existing = Invoke-WebRequest -Uri "http://127.0.0.1:$voiceBrowserPort/api/state" -UseBasicParsing -TimeoutSec 2
    if ($existing.StatusCode -eq 200) {
        Write-Host "Voice browser is already running at http://127.0.0.1:$voiceBrowserPort."
        exit 0
    }
} catch {
    # The service is not running yet.
}

$envFile = Join-Path $PSScriptRoot '.env'
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*(TYPESAFE_BASE_URL|TYPESAFE_MODEL|TYPESAFE_DEFAULT_MODEL|TYPESAFE_TIMEOUT_MS)\s*=\s*(.*?)\s*$') {
            $value = $Matches[2].Trim('"', "'")
            [Environment]::SetEnvironmentVariable($Matches[1], $value, 'Process')
        }
    }
}

if ($env:TYPESAFE_BASE_URL -eq 'http://127.0.0.1:8000' -and $env:TYPESAFE_MODEL -eq 'multilingual') {
    function Test-LocalLaya {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2
            return $health.status -eq 'ok' -and $health.loaded -contains 'multilingual'
        } catch {
            return $false
        }
    }
    if (-not (Test-LocalLaya)) {
        $layaExe = Join-Path $PSScriptRoot '..\.venv312\Scripts\laya-serve.exe'
        if (-not (Test-Path -LiteralPath $layaExe)) {
            throw 'Local Laya is offline and its executable was not found.'
        }
        $env:LAYA_HOST = '127.0.0.1'
        $env:LAYA_PORT = '8000'
        $env:LAYA_DEVICE = 'cpu'
        $env:LAYA_MODELS = 'multilingual'
        $env:LAYA_PRELOAD = '1'
        $layaRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
        Start-Process -FilePath $layaExe -WorkingDirectory $layaRoot -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $layaRoot 'laya-output.log') `
            -RedirectStandardError (Join-Path $layaRoot 'laya-error.log') | Out-Null
        for ($attempt = 0; $attempt -lt 90 -and -not (Test-LocalLaya); $attempt++) {
            Start-Sleep -Seconds 1
        }
        if (-not (Test-LocalLaya)) { throw 'Local Laya did not start. Check laya-error.log.' }
    }
}

Write-Host "Starting voice-browser at http://127.0.0.1:$voiceBrowserPort (local only)."
node src/server.js --port $voiceBrowserPort --host 127.0.0.1
exit $LASTEXITCODE
