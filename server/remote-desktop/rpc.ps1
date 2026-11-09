$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
 $r=[Console]::In.ReadToEnd()|ConvertFrom-Json
 if($r.role -ceq 'gui'){
  if($r.operation -notin @('observe','screenshot','click','input','drag')){throw 'operation'}
  Add-Type -Path (Join-Path $PSScriptRoot 'vendor\ClientCore.cs')
  $id=[guid]::NewGuid().ToString('D')
  $request=@{version=1;id=$id;token=$r.token;operation=$r.operation}|ConvertTo-Json -Compress
  $reply=[PocClientCore]::Send($r.address,$r.port,$r.pin,$request)|ConvertFrom-Json
  if($reply.id -cne $id -or $reply.version -ne 1 -or $reply.ok -isnot [bool]){throw 'response'}
  $reply|ConvertTo-Json -Depth 60 -Compress
 }elseif($r.role -ceq 'transfer' -and $r.operation -ceq 'put'){
  Add-Type -Path (Join-Path $PSScriptRoot 'vendor\TransferCore.cs')
  $hold=[IO.File]::Open($r.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try{
   $sha=[Security.Cryptography.SHA256]::Create()
   try{$hash=[BitConverter]::ToString($sha.ComputeHash($hold)).Replace('-','')}finally{$sha.Dispose()}
   if($hold.Length -ne $r.expectedSize -or $hash -ine $r.expectedHash){throw 'artifact_changed'}
   [RemoteFileTransferCore]::Send($r.address,$r.port,$r.pin,$r.token,$r.path,$r.name)
  }finally{$hold.Dispose()}
 }else{throw 'role'}
}catch{[Console]::Error.Write('remote_rpc_unconfirmed');exit 1}
finally{$r=$null;$request=$null}
