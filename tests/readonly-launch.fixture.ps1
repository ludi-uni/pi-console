$ErrorActionPreference='Stop'
$phase='import';$secure=$null
try {
  $module=Import-Module $env:DUMMY_MODULE -Force -PassThru
  & $module {
    $script:repoRoot=$env:DUMMY_REPO;$script:authDataDir=$env:DUMMY_DATA
    $script:approvedScopeHash=(Get-FileHash -LiteralPath (Join-Path $env:DUMMY_DATA 'readonly-mcp-scope.json')).Hash
    $script:keyReads=0
    function script:Get-ProtectedReadOnlyMcpKey {param([string]$DataDir);$script:keyReads++;return $env:DUMMY_KEY}
  }
  $secure=ConvertTo-SecureString 'offline_dummy' -AsPlainText -Force
  $phase='preview'
  $tunnel=New-ReadOnlyProcessStartInfo -TestRoot $env:DUMMY_LAUNCH
  $guard=New-ReadOnlyGuardStartInfo -TestRoot $env:DUMMY_LAUNCH
  if((& $module {$script:keyReads}) -ne 0){throw 'Preview read a credential'}
  $null=Assert-ReadOnlyChildConfiguration $env:DUMMY_LAUNCH $tunnel Tunnel
  $null=Assert-ReadOnlyChildConfiguration $env:DUMMY_LAUNCH $guard Guard
  foreach($fault in @('url','channel','argv','env')) {
    $phase='child_'+$fault
    $info=New-ReadOnlyProcessStartInfo -TestRoot $env:DUMMY_LAUNCH
    switch($fault) {
      'url'{$info.Arguments=$info.Arguments.Replace('127.0.0.1:31718/mcp/readonly','127.0.0.1:9/capture')}
      'channel'{$info.Arguments=$info.Arguments.Replace('channel=main','channel=other')}
      'argv'{$info.Arguments+=' --mcp.server-url channel=other,url=http://127.0.0.1:9/capture'}
      'env'{$info.EnvironmentVariables['MCP_SERVER_URL']='http://127.0.0.1:9/capture'}
    }
    $rejected=$false;try{$null=Assert-ReadOnlyChildConfiguration $env:DUMMY_LAUNCH $info Tunnel}catch{$rejected=$true}
    if(-not $rejected -or (& $module {$script:keyReads}) -ne 0){throw 'Changed child target accepted'}
  }
  $phase='profile'
  $profile=Join-Path $env:DUMMY_LAUNCH 'readonly-guarded.yaml';$before=[IO.File]::ReadAllBytes($profile)
  foreach($fault in @('url','channel','whitespace')) {
    $text=[Text.Encoding]::UTF8.GetString($before)
    switch($fault){'url'{$text=$text.Replace('127.0.0.1:31718','127.0.0.1:9')};'channel'{$text=$text.Replace('[main]','[main, other]')};'whitespace'{$text+=[Environment]::NewLine}}
    [IO.File]::WriteAllText($profile,$text)
    foreach($role in @('Tunnel','Guard')) {
      $rejected=$false
      try{if($role -eq 'Tunnel'){$null=New-ReadOnlyProcessStartInfo -TestRoot $env:DUMMY_LAUNCH -RuntimeKey $secure}else{$null=New-ReadOnlyGuardStartInfo -TestRoot $env:DUMMY_LAUNCH -WithAuthentication}}catch{$rejected=$true}
      if(-not $rejected -or (& $module {$script:keyReads}) -ne 0){throw 'Changed profile reached key reader'}
    }
    [IO.File]::WriteAllBytes($profile,$before)
  }
  $phase='source_scope'
  foreach($path in @((Join-Path $env:DUMMY_REPO 'server/readonly-mcp-guard.ts'),(Join-Path $env:DUMMY_DATA 'readonly-mcp-scope.json'))) {
    $beforeFile=[IO.File]::ReadAllBytes($path);[IO.File]::AppendAllText($path,'changed')
    $rejected=$false;try{$null=New-ReadOnlyGuardStartInfo -TestRoot $env:DUMMY_LAUNCH -WithAuthentication}catch{$rejected=$true}
    if(-not $rejected -or (& $module {$script:keyReads}) -ne 0){throw 'Changed source/scope reached key reader'}
    [IO.File]::WriteAllBytes($path,$beforeFile)
  }
  $phase='dummy_auth'
  $guard=New-ReadOnlyGuardStartInfo -TestRoot $env:DUMMY_LAUNCH -WithAuthentication
  $tunnel=New-ReadOnlyProcessStartInfo -TestRoot $env:DUMMY_LAUNCH -RuntimeKey $secure
  if((& $module {$script:keyReads}) -ne 2 -or $guard.EnvironmentVariables['PI_CONSOLE_READONLY_MCP_KEY'] -cne $env:DUMMY_KEY -or $tunnel.EnvironmentVariables['PI_CONSOLE_READONLY_MCP_LOCAL_KEY'] -cne $env:DUMMY_KEY){throw 'Dummy auth setup failed'}
  $phase='last_moment_profile'
  [IO.File]::AppendAllText($profile,'changed')
  $rejected=$false;try{$null=Assert-ReadOnlyChildConfiguration $env:DUMMY_LAUNCH $guard Guard -RequireCredentials}catch{$rejected=$true}
  if(-not $rejected){throw 'Late profile change accepted'};[IO.File]::WriteAllBytes($profile,$before)
  $phase='last_moment_start'
  $guard.Arguments='--invalid-dummy-flag'
  $rejected=$false;try{$null=Start-ReadOnlyValidatedProcess $env:DUMMY_LAUNCH $guard Guard}catch{$rejected=$true}
  if(-not $rejected -or $guard.EnvironmentVariables.ContainsKey('PI_CONSOLE_READONLY_MCP_KEY')){throw 'Invalid final process options accepted or key retained'}
  Clear-ReadOnlyChildKey $tunnel
  if($tunnel.EnvironmentVariables.ContainsKey('CONTROL_PLANE_API_KEY') -or $tunnel.EnvironmentVariables.ContainsKey('PI_CONSOLE_READONLY_MCP_LOCAL_KEY')){throw 'Parent key cleanup failed'}
  Write-Output '{"ok":true,"processStarted":false,"keysAreDummy":true,"tamperedProfileRejectedBeforeKeyRead":true}'
}catch{Write-Output ('{"ok":false,"phase":"'+$phase+'","errorType":"'+$_.Exception.GetType().Name+'"}');exit 1}
finally{if($null -ne $secure){$secure.Dispose()}}

