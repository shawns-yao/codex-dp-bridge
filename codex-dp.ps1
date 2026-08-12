#!/usr/bin/env pwsh
$entry = Join-Path $PSScriptRoot "dist/src/cli.js"
& node $entry @args
exit $LASTEXITCODE
