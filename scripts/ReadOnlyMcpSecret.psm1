Set-StrictMode -Version 2

function Get-ReadOnlyMcpSecretPath {
    param([Parameter(Mandatory=$true)][string]$DataDir)
    $root=[IO.Path]::GetFullPath($DataDir)
    if($root -notmatch '^[A-Za-z]:\\' -or $root.StartsWith('\\')){throw 'A local Console data directory is required.'}
    return Join-Path $root 'readonly-mcp.key'
}

function Get-ProtectedReadOnlyMcpKey {
    param([Parameter(Mandatory=$true)][string]$DataDir)
    try {
        $path=Get-ReadOnlyMcpSecretPath -DataDir $DataDir
        $item=Get-Item -LiteralPath $path -Force
        if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -lt 64 -or $item.Length -gt 66){throw 'Invalid key file.'}
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl=Get-Acl -LiteralPath $path
        $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier])
        if(-not $acl.AreAccessRulesProtected -or $owner.Value -ne $sid.Value){throw 'Key file access is not protected.'}
        foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
            if($rule.IsInherited -or ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid.Value,'S-1-5-18'))){throw 'Key file access is too broad.'}
        }
        $value=[IO.File]::ReadAllText($path).TrimEnd([char[]]"`r`n")
        if($value -cnotmatch '^[0-9a-f]{64}$'){throw 'Invalid key file.'}
        return $value
    } catch {throw 'Dedicated MCP key is missing or its format/access is invalid. No secret value was printed.'}
}

function Install-ProtectedReadOnlyMcpKey {
    param([Parameter(Mandatory=$true)][string]$DataDir,[Parameter(Mandatory=$true)][Security.SecureString]$Key,
        [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ApprovedScopeSha256)
    $buffer=[IntPtr]::Zero;$plain=$null;$bytes=$null
    try {
        $root=[IO.Path]::GetFullPath($DataDir);$path=Get-ReadOnlyMcpSecretPath -DataDir $root
        if(-not (Test-Path -LiteralPath $root -PathType Container) -or (Test-Path -LiteralPath $path)){throw 'Existing key will not be overwritten.'}
        $scopePath=Join-Path $root 'readonly-mcp-scope.json'
        if((Get-FileHash -LiteralPath $scopePath -Algorithm SHA256).Hash -ne $ApprovedScopeSha256){throw 'Approved scope changed.'}
        $scope=Get-Content -LiteralPath $scopePath -Raw|ConvertFrom-Json
        if($scope.version -ne 1 -or @($scope.workspaces).Count -ne 1 -or @($scope.workspaces[0].sessionIds).Count -ne 1){throw 'Existing approved scope required.'}
        $envPath=Join-Path $root '.env';$before=[IO.File]::ReadAllBytes($envPath)
        $text=[Text.Encoding]::UTF8.GetString($before)
        if($text -notmatch '(?m)^PI_CONSOLE_READONLY_MCP=1\r?$' -or $text -match '(?m)^\s*(?:export\s+)?PI_CONSOLE_READONLY_MCP_(AUTH|KEY)\s*='){throw 'Existing opt-in required; auth setting will not be overwritten.'}
        $buffer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Key)
        $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer)
        if($plain -cnotmatch '^[0-9a-f]{64}$'){throw 'Use a new independent 256-bit lowercase hex key.'}
        # Create an empty file, restrict its ACL, then write the secret. The
        # inherited ACL never protects a file containing plaintext credentials.
        $empty=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$empty.Dispose()
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl=New-Object Security.AccessControl.FileSecurity
        $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')))
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(([Security.Principal.SecurityIdentifier]'S-1-5-18'),'FullControl','Allow')))
        Set-Acl -LiteralPath $path -AclObject $acl
        $bytes=[Text.Encoding]::UTF8.GetBytes($plain)
        [IO.File]::WriteAllBytes($path,$bytes)
        $verified=Get-ProtectedReadOnlyMcpKey -DataDir $root
        if($verified -cne $plain){throw 'Key file verification failed.'};$verified=$null
        $eol=if($text.Contains("`r`n")){"`r`n"}else{"`n"}
        $suffix=if($before.Length -gt 0 -and $before[$before.Length-1] -ne 10){$eol}else{''}
        $suffix+='PI_CONSOLE_READONLY_MCP_AUTH=shared_secret'+$eol
        $addition=[Text.Encoding]::UTF8.GetBytes($suffix)
        $append=[IO.File]::Open($envPath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        try{
            if($append.Length -ne $before.Length){throw 'Concurrent config change.'}
            for($i=0;$i -lt $before.Length;$i++){if($append.ReadByte() -ne $before[$i]){throw 'Concurrent config change.'}}
            $append.Write($addition,0,$addition.Length);$append.Flush($true)
        }finally{$append.Dispose()}
        $after=[IO.File]::ReadAllBytes($envPath)
        if($after.Length -ne ($before.Length+$addition.Length)){throw 'Config verification failed.'}
        for($i=0;$i -lt $before.Length;$i++){if($before[$i] -ne $after[$i]){throw 'Other config changed.'}}
        return [pscustomobject]@{keyFile=$path;configFile=$envPath;scopeChanged=$false;restarted=$false}
    } catch {throw 'Manual MCP key setup did not complete. No secret was printed or existing key overwritten; inspect the private file/config state before retrying.'}
    finally {
        if($null -ne $bytes){[Array]::Clear($bytes,0,$bytes.Length)}
        if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer)}
        $plain=$null
    }
}
Export-ModuleMember -Function Get-ProtectedReadOnlyMcpKey,Install-ProtectedReadOnlyMcpKey
