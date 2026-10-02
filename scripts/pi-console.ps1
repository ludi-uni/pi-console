#!/usr/bin/env pwsh
# pi-console.ps1 — manage the detached pi-console server from any working directory.
# Thin wrapper over the packaged Node manager (package/pi-console.mjs); all lifecycle
# rules, state and logs live in the stable Console data directory.
#
#   scripts\pi-console.ps1                # start (default)
#   scripts\pi-console.ps1 start 31718    # start on a specific port
#   scripts\pi-console.ps1 status|stop|restart|port
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CommandArgs)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot            # package root (the folder containing scripts/)
$entry = Join-Path (Join-Path $root 'package') 'pi-console.mjs'
if (-not (Test-Path $entry)) { Write-Error "pi-console entry point not found: $entry"; exit 1 }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error 'node was not found on PATH; install Node.js 24 or later'; exit 1 }

& $node.Source $entry @CommandArgs
exit $LASTEXITCODE
