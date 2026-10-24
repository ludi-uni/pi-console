# Fixed existing echo Tunnel only. Never reads a profile, .env, global environment or old helper.
$script:Binary='C:\Users\leade\Documents\Codex\2026-10-05\task\secure-mcp-echo-test\client\tunnel-client.exe'
$script:Tunnel='tunnel_6ac2eee6ba208191ae0a8d1873390b4d'
$script:Companion='D:/Develop/pi-console/package/local-folder-mcp.mjs'
function Quote-ProcessArgument([string]$Value) {
    '"' + [regex]::Replace([regex]::Replace($Value,'(\\*)"','$1$1\"'),'(\\+)$','$1$1') + '"'
}
function Get-CompanionBindingMetadata {
    [pscustomobject]@{App='pi-console-echo-test';TunnelId=$script:Tunnel;Binary=$script:Binary;Companion=$script:Companion;ConsoleOrigin='http://127.0.0.1:31717';Protocol='legacy handshake and modern 2026-07-28';ProfileRead=$false;CredentialSaved=$false}
}
function Assert-CompanionBindingFiles {
    if ((Get-FileHash -LiteralPath $script:Binary -Algorithm SHA256).Hash.ToLowerInvariant() -ne '1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42') { throw 'PIN_IDENTITY_MISMATCH' }
    if ((Get-FileHash -LiteralPath $script:Companion -Algorithm SHA256).Hash.ToLowerInvariant() -ne '46d30a25b337efa5b06bad561e7d4575e5f82b1c7919332cc45ff8806b4e6c82') { throw 'COMPANION_IDENTITY_MISMATCH' }
    if ((Get-FileHash -LiteralPath 'D:/Develop/pi-console/package/pi-control-mcp.mjs' -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'f2b2fb74c021bed5b1e037962ae6f6e36b1abfdad94378a21bcf54d020a257c8') { throw 'CONTROL_COMPANION_IDENTITY_MISMATCH' }
    if (-not (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe' -PathType Leaf)) { throw 'NODE_UNAVAILABLE' }
}
function New-CompanionTunnelStartInfo([string]$RuntimeRoot,[Security.SecureString]$RuntimeKey) {
    $command='"C:/Program Files/nodejs/node.exe" "D:/Develop/pi-console/package/local-folder-mcp.mjs" http://127.0.0.1:31717 --discover'
    $commandArgs=@('run','--control-plane.base-url','https://api.openai.com','--control-plane.tunnel-id',$script:Tunnel,'--control-plane.api-key','env:CONTROL_PLANE_API_KEY','--control-plane.poll-channel=main','--mcp.command',$command,'--mcp.max-concurrent-requests=1','--health.listen-addr','127.0.0.1:0','--health.url-file',(Join-Path $RuntimeRoot 'health.url'),'--harpoon.hosts-include-loopback=false','--harpoon.hosts-include-private=false','--harpoon.allow-plaintext-http=false','--harpoon.capture-payloads=false','--cloudflared.managed=false','--allow-remote-ui=false','--open-web-ui=false','--log.http-raw-unsafe=false','--log.file','stdout','--log.format=json','--log.level=error')
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$script:Binary;$info.Arguments=($commandArgs|ForEach-Object{Quote-ProcessArgument $_}) -join ' '
    $info.WorkingDirectory=$RuntimeRoot;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $info.EnvironmentVariables.Clear()
    $info.EnvironmentVariables['SystemRoot']='C:\Windows';$info.EnvironmentVariables['WINDIR']='C:\Windows'
    foreach($name in @('HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','TUNNEL_CLIENT_PROFILE_DIR')){$info.EnvironmentVariables[$name]=$RuntimeRoot}
    if($null -ne $RuntimeKey){
        $pointer=[IntPtr]::Zero
        try{$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($RuntimeKey);$info.EnvironmentVariables['CONTROL_PLANE_API_KEY']=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}
        finally{if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}}
    }
    $info
}
function Clear-CompanionParentKey($StartInfo){if($null -ne $StartInfo){$StartInfo.EnvironmentVariables.Remove('CONTROL_PLANE_API_KEY')}}
Export-ModuleMember -Function Get-CompanionBindingMetadata,Assert-CompanionBindingFiles,New-CompanionTunnelStartInfo,Clear-CompanionParentKey
