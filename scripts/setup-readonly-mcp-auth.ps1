param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ApprovedScopeSha256,
    [string]$DataDir=(Join-Path $env:USERPROFILE '.pi\agent\pi-console'))
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'ReadOnlyMcpSecret.psm1') -Force
$key=$null
try {
    Write-Host 'Run only after approving live key/config setup. This script does not restart any process.'
    Write-Host 'Use a NEW random 256-bit key from your password manager: 64 lowercase hex characters. Never paste it into chat.'
    Write-Host 'Storage: readonly-mcp.key in the Console data directory, plaintext with access limited to this Windows user and SYSTEM, until you rotate/delete it.'
    $key=Read-Host 'Dedicated MCP key (hidden)' -AsSecureString
    $result=Install-ProtectedReadOnlyMcpKey -DataDir $DataDir -Key $key -ApprovedScopeSha256 $ApprovedScopeSha256
    Write-Host ('Protected key file: '+$result.keyFile)
    Write-Host 'Added only PI_CONSOLE_READONLY_MCP_AUTH=shared_secret. Scope unchanged; restart remains a separate step.'
}catch{Write-Host 'Setup did not complete. No raw error or secret was printed; inspect the private key/config state before retrying.';exit 1}
finally{if($null -ne $key){$key.Dispose()}}
