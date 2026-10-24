export const HELPER_SOURCE=String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
$data = $null
$entropy = $null
$result = $null
try {
 Add-Type -AssemblyName System.Security
 $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
 $names = @($request.PSObject.Properties.Name | Sort-Object)
 if (($names -join ',') -ne 'data,entropy,operation') { throw 'invalid_request' }
 if ($request.operation -notin @('protect','unprotect')) { throw 'invalid_operation' }
 $data = [Convert]::FromBase64String($request.data)
 $entropy = [Convert]::FromBase64String($request.entropy)
 if ($data.Length -eq 0 -or $data.Length -gt 2097152 -or $entropy.Length -gt 4096) { throw 'invalid_size' }
 if ($request.operation -eq 'protect') {
  $result = [System.Security.Cryptography.ProtectedData]::Protect($data,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
 } else {
  $result = [System.Security.Cryptography.ProtectedData]::Unprotect($data,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
 }
 [Console]::Out.Write([Convert]::ToBase64String($result))
} catch {
 [Console]::Error.Write('dpapi_operation_failed')
 exit 1
} finally {
 if ($null -ne $data) { [Array]::Clear($data,0,$data.Length) }
 if ($null -ne $entropy) { [Array]::Clear($entropy,0,$entropy.Length) }
 if ($null -ne $result) { [Array]::Clear($result,0,$result.Length) }
}`;
