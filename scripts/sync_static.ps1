$src='d:\Users\angel\Documents\GitHub\EAFtoGCAL_AH\frontend\dist'
$static='d:\Users\angel\Documents\GitHub\EAFtoGCAL_AH\static'
$backup='d:\Users\angel\Documents\GitHub\EAFtoGCAL_AH\static.bak'

if(Test-Path $backup){ Remove-Item -Path $backup -Recurse -Force }
Copy-Item -Path $static -Destination $backup -Recurse -Force

# Remove everything inside static
Get-ChildItem -Path $static -Force | ForEach-Object {
    if($_.Name -ne '.' -and $_.Name -ne '..'){
        Remove-Item -LiteralPath $_.FullName -Recurse -Force
    }
}

# Ensure assets directory exists
New-Item -ItemType Directory -Path (Join-Path $static 'assets') -Force | Out-Null

# Copy all dist assets
Copy-Item -Path (Join-Path $src 'assets\*') -Destination (Join-Path $static 'assets') -Recurse -Force

# Map hashed CSS/JS to filenames expected by Flask templates
$css=Get-ChildItem -Path (Join-Path $src 'assets') -Filter 'index-*.css' | Select-Object -First 1
if($css){ Copy-Item -Path $css.FullName -Destination (Join-Path $static 'assets\index.css') -Force }

$js=Get-ChildItem -Path (Join-Path $src 'assets') -Filter 'index-*.js' | Select-Object -First 1
if($js){ Copy-Item -Path $js.FullName -Destination (Join-Path $static 'app.js') -Force }

Write-Output 'SYNC_DONE'