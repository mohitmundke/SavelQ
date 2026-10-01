# Build self-contained index.html and Index.html

$root = "e:\Skill"
$htmlPath = Join-Path $root "Index.html"
$cssPath = Join-Path $root "styles.css"
$jsPath = Join-Path $root "script.js"

$html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)
$css = [System.IO.File]::ReadAllText($cssPath, [System.Text.Encoding]::UTF8)
$js = [System.IO.File]::ReadAllText($jsPath, [System.Text.Encoding]::UTF8)

# Replace the style placeholder
$html = $html.Replace("<?!= include('styles'); ?>", $css)

# Replace the script placeholder
$html = $html.Replace("<?!= include('script'); ?>", $js)

# Write to root
[System.IO.File]::WriteAllText((Join-Path $root "index.html"), $html, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText((Join-Path $root "Index.html"), $html, [System.Text.Encoding]::UTF8)

# Write to SaveIQ subfolder
$saveIqDir = Join-Path $root "SaveIQ"
if (Test-Path $saveIqDir) {
    [System.IO.File]::WriteAllText((Join-Path $saveIqDir "index.html"), $html, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText((Join-Path $saveIqDir "Index.html"), $html, [System.Text.Encoding]::UTF8)
}

Write-Host "Self-contained index.html and Index.html generated successfully."
