import {runWindowsHelper} from '../local-mcp-windows.mjs';
const source=String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$path=[Console]::In.ReadToEnd()
if(-not [IO.Path]::IsPathRooted($path)){throw 'path'}
$me=[Security.Principal.WindowsIdentity]::GetCurrent().User
$item=[IO.DirectoryInfo]::new($path)
if(-not $item.Exists){
 $item.Create()
 $acl=[Security.AccessControl.DirectorySecurity]::new()
 $acl.SetOwner($me);$acl.SetAccessRuleProtection($true,$false)
 $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
 $item.SetAccessControl($acl)
}
$item.Refresh()
if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'reparse'}
$acl=$item.GetAccessControl()
if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $me.Value -or -not $acl.AreAccessRulesProtected){throw 'owner'}
foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -cne $me.Value){throw 'acl'}}
[Console]::Out.Write('OK')`;
export async function ensureRemotePrivateDirectory(path:string){const b=await runWindowsHelper(source,Buffer.from(path));if(b.toString()!=='OK')throw Error('remote_private_storage_required');}
