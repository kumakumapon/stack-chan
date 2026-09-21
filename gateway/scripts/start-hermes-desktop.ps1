param(
    [string]$ListenHost = '127.0.0.1',
    [int]$Port = 8766,
    [string]$HermesUrl = '',
    [ValidateSet('windows', 'device', 'hermes')]
    [string]$Tts = 'windows'
)
$ErrorActionPreference = 'Stop'
$stackchanRoot = Split-Path $PSScriptRoot -Parent
if (-not $HermesUrl) {
    $stackchanPids = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python' -and $_.CommandLine -match 'hermes' -and $_.CommandLine -match 'serve' } | Select-Object -ExpandProperty ProcessId)
    $stackchanListeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -in $stackchanPids })
    if ($stackchanListeners.Count -ne 1) { throw 'Cannot uniquely locate Hermes Desktop. Supply -HermesUrl http://127.0.0.1:PORT/' }
    $HermesUrl = "http://127.0.0.1:$($stackchanListeners[0].LocalPort)/"
}
$env:HERMES_DESKTOP_URL = $HermesUrl
$env:STACKCHAN_LISTEN_HOST = $ListenHost
$env:STACKCHAN_PORT = [string]$Port
$env:STACKCHAN_TTS = $Tts
& node (Join-Path $stackchanRoot 'dist/hermes-desktop-main.js')
exit $LASTEXITCODE
