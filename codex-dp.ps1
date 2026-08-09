#!/usr/bin/env pwsh
& node "$PSScriptRoot\dist\src\cli.js" @args
exit $LASTEXITCODE
