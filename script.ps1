$AcLocal = "D:\Steam\steamapps\common\assettocorsa"
$Key = "C:\Users\franc\.ssh\motassetto.key"
$Vps = "ubuntu@motassetto.dedyn.io"
$RemoteAssetto = "/home/ubuntu/assetto"

$TracksLocal = Join-Path $AcLocal "content\tracks"

if (!(Test-Path $TracksLocal)) {
    Write-Host "No existe la ruta local: $TracksLocal" -ForegroundColor Red
    exit 1
}

if (!(Test-Path $Key)) {
    Write-Host "No existe la key SSH: $Key" -ForegroundColor Red
    exit 1
}

$Tmp = Join-Path $env:TEMP ("ac_track_meta_" + [guid]::NewGuid().ToString())
$DstTracks = Join-Path $Tmp "content\tracks"
New-Item -ItemType Directory -Force $DstTracks | Out-Null

Write-Host "Preparando metadata desde: $TracksLocal" -ForegroundColor Cyan

Get-ChildItem $TracksLocal -Directory | ForEach-Object {
    $trackName = $_.Name
    $dstTrack = Join-Path $DstTracks $trackName
    New-Item -ItemType Directory -Force $dstTrack | Out-Null

    foreach ($folder in @("ui", "data")) {
        $src = Join-Path $_.FullName $folder

        if (Test-Path $src) {
            Write-Host "Copiando $trackName\$folder"
            Copy-Item $src $dstTrack -Recurse -Force
        }
    }
}

$Archive = Join-Path $env:TEMP "ac_track_metadata.tar.gz"

if (Test-Path $Archive) {
    Remove-Item $Archive -Force
}

Push-Location $Tmp
tar -czf $Archive content
Pop-Location

Write-Host "Subiendo metadata al VPS..." -ForegroundColor Cyan
scp -i $Key $Archive "${Vps}:/tmp/ac_track_metadata.tar.gz"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Falló el scp" -ForegroundColor Red
    exit 1
}

Write-Host "Extrayendo en el VPS..." -ForegroundColor Cyan
ssh -i $Key $Vps "tar -xzf /tmp/ac_track_metadata.tar.gz -C '$RemoteAssetto' && sudo chown -R ubuntu:ubuntu '$RemoteAssetto/content/tracks' && rm /tmp/ac_track_metadata.tar.gz"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Falló la extracción remota" -ForegroundColor Red
    exit 1
}

Remove-Item $Tmp -Recurse -Force
Remove-Item $Archive -Force

Write-Host "Listo. Metadata de tracks subida al VPS." -ForegroundColor Green