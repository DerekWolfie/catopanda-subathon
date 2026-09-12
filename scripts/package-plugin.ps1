$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    & npm.cmd run package
    if ($LASTEXITCODE -ne 0) { throw "Falha ao validar ou empacotar o plugin." }
}
finally {
    Pop-Location
}
