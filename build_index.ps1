# Build self-contained index.html and Index.html

$root = "e:\Skill"
$htmlPath = Join-Path $root "Index.html"
$cssPath = Join-Path $root "styles.css"
$jsPath = Join-Path $root "script.js"

$html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)
$css = [System.IO.File]::ReadAllText($cssPath, [System.Text.Encoding]::UTF8)
$js = [System.IO.File]::ReadAllText($jsPath, [System.Text.Encoding]::UTF8)

# Replace <style>...</style> block
$styleRegex = New-Object System.Text.RegularExpressions.Regex("(?s)<style>.*?</style>")
$html = $styleRegex.Replace($html, "<style>`n$css`n  </style>", 1)

# Replace <script>...</script> inline block
$scriptRegex = New-Object System.Text.RegularExpressions.Regex("(?s)<script>\s*/\* Inline Fallback.*?</script>")
$replacementScript = "<script>`n    /* Inline Fallback & Apps Script compatibility */`n$js`n  </script>"
$html = $scriptRegex.Replace($html, $replacementScript, 1)

# Write to root
[System.IO.File]::WriteAllText((Join-Path $root "index.html"), $html, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText((Join-Path $root "Index.html"), $html, [System.Text.Encoding]::UTF8)

# Sync to SaveIQ subfolder
$saveIqDir = Join-Path $root "SaveIQ"
if (Test-Path $saveIqDir) {
    [System.IO.File]::WriteAllText((Join-Path $saveIqDir "index.html"), $html, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText((Join-Path $saveIqDir "Index.html"), $html, [System.Text.Encoding]::UTF8)
    Copy-Item -Path (Join-Path $root "app.py") -Destination (Join-Path $saveIqDir "app.py") -Force
    Copy-Item -Path (Join-Path $root "script.js") -Destination (Join-Path $saveIqDir "script.js") -Force
    Copy-Item -Path (Join-Path $root "styles.css") -Destination (Join-Path $saveIqDir "styles.css") -Force
    Copy-Item -Path (Join-Path $root "requirements.txt") -Destination (Join-Path $saveIqDir "requirements.txt") -Force
    Copy-Item -Path (Join-Path $root ".env.example") -Destination (Join-Path $saveIqDir ".env.example") -Force
}

Write-Host "Self-contained index.html and Index.html updated and synced successfully."
