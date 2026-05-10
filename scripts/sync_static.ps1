$src='d:\Users\angel\Documents\GitHub\EAFtoGCAL_AH\frontend\dist'
$public='d:\Users\angel\Documents\GitHub\EAFtoGCAL_AH\public'
$backup='d:\Users\angel\Documents\GitHub\EAFtoGCAL_AH\public.bak'

if(Test-Path $backup){ Remove-Item -Path $backup -Recurse -Force }
Copy-Item -Path $public -Destination $backup -Recurse -Force

# Remove everything inside public
Get-ChildItem -Path $public -Force | ForEach-Object {
    if($_.Name -ne '.' -and $_.Name -ne '..'){  
        Remove-Item -LiteralPath $_.FullName -Recurse -Force
    }
}

# Ensure assets directory exists
New-Item -ItemType Directory -Path (Join-Path $public 'assets') -Force | Out-Null

# Copy all dist assets
Copy-Item -Path (Join-Path $src 'assets\*') -Destination (Join-Path $public 'assets') -Recurse -Force

# Copy index.html from dist to public
if(Test-Path (Join-Path $src 'index.html')){
    Copy-Item -Path (Join-Path $src 'index.html') -Destination (Join-Path $public 'index.html') -Force
}

# Map hashed CSS/JS to filenames expected by Flask templates
$css=Get-ChildItem -Path (Join-Path $src 'assets') -Filter 'index-*.css' | Select-Object -First 1
if($css){ Copy-Item -Path $css.FullName -Destination (Join-Path $public 'assets\index.css') -Force }

$js=Get-ChildItem -Path (Join-Path $src 'assets') -Filter 'index-*.js' | Select-Object -First 1
if($js){ Copy-Item -Path $js.FullName -Destination (Join-Path $public 'app.js') -Force }

Write-Output 'SYNC_DONE'