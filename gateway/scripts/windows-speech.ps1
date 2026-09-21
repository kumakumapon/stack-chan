$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Speech
$stackchanText = [Console]::In.ReadToEnd()
$stackchanSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$stackchanStream = New-Object System.IO.MemoryStream
try {
    $stackchanVoice = $stackchanSynth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ja-JP' } | Select-Object -First 1
    if (-not $stackchanVoice) { throw 'No Japanese Windows speech voice is installed' }
    $stackchanSynth.SelectVoice($stackchanVoice.VoiceInfo.Name)
    $stackchanFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $stackchanSynth.SetOutputToAudioStream($stackchanStream, $stackchanFormat)
    $stackchanSynth.Speak($stackchanText)
    [Console]::Out.Write([Convert]::ToBase64String($stackchanStream.ToArray()))
} finally {
    $stackchanSynth.Dispose()
    $stackchanStream.Dispose()
}
