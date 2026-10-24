$ErrorActionPreference='Stop'
$child=$null;$started=$false;$form=$null;$key=$null;$info=$null;$reason='unavailable';$phase='pending'
$owned=@{}
$mutex=$null;$mutexOwned=$false
$daemonStart=$null;$readyUntil=$null
function Send-State([string]$State){
    $script:phase=$State
    [Console]::Out.WriteLine((@{requestId=$data.requestId;state=$State}|ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}
function Stop-VerifiedTunnelTree($Root,$RootIdentity,$Operations) {
    # Operations is fixed in Stop-OwnedTree; the pure test extracts only this function.
    # No caller-supplied PID/command/operation enters the HTTP or native input protocol.
    $records=@{};$handles=@{};$processed=@{};$depths=@{}
    function Birth($Date){$ticks=$Date.ToUniversalTime().Ticks;return [long]($ticks-($ticks%10))}
    function SameRecord($A,$B){
        return $null -ne $A -and $null -ne $B -and $A.ProcessId -eq $B.ProcessId -and $A.ParentProcessId -eq $B.ParentProcessId -and
            [string]::Equals($A.Name,$B.Name,[StringComparison]::OrdinalIgnoreCase) -and
            [string]::Equals($A.ExecutablePath,$B.ExecutablePath,[StringComparison]::OrdinalIgnoreCase) -and $A.SessionId -eq $B.SessionId -and (Birth $A.CreationDate) -eq (Birth $B.CreationDate)
    }
    function CheckHeld($Entry,$Handle){
        if((& ($Operations.Id) $Handle) -ne $Entry.ProcessId -or (& ($Operations.Session) $Handle) -ne $Entry.SessionId){throw 'held_identity'}
        if((Birth (& ($Operations.Birth) $Handle)) -ne (Birth $Entry.CreationDate)){throw 'held_birth'}
        if(-not (& ($Operations.Exited) $Handle)){
            if(-not [string]::Equals((& ($Operations.Image) $Handle),$Entry.ExecutablePath,[StringComparison]::OrdinalIgnoreCase) -or -not (& ($Operations.ImageSafe) $Handle)){throw 'held_image'}
        }
        $current=& ($Operations.Identity) ([int]$Entry.ProcessId)
        if($null -eq $current){if(-not (& ($Operations.Exited) $Handle)){throw 'identity_missing'}}
        elseif(-not (SameRecord $Entry $current)){throw 'identity_changed'}
    }
    function ReadBranch($Parent,$Depth){
        $parentHandle=$handles[[int]$Parent.ProcessId];CheckHeld $Parent $parentHandle
        $children=@(& ($Operations.Children) ([int]$Parent.ProcessId))
        if(($Depth -ge 4 -or [string]::Equals($Parent.Name,'conhost.exe',[StringComparison]::OrdinalIgnoreCase)) -and $children.Count){throw 'tree_shape'}
        foreach($entry in $children){
            if($entry.ProcessId -eq $RootIdentity.ProcessId -or $entry.ParentProcessId -ne $Parent.ProcessId -or $entry.SessionId -ne $Parent.SessionId -or (Birth $entry.CreationDate) -lt (Birth $Parent.CreationDate)){throw 'parent_birth'}
            if((& ($Operations.Exited) $parentHandle) -and (Birth $entry.CreationDate) -gt (Birth (& ($Operations.ExitAt) $parentHandle))){throw 'parent_reused'}
            $node=[string]::Equals($entry.Name,'node.exe',[StringComparison]::OrdinalIgnoreCase) -and [string]::Equals($entry.ExecutablePath,'C:\Program Files\nodejs\node.exe',[StringComparison]::OrdinalIgnoreCase)
            $console=[string]::Equals($entry.Name,'conhost.exe',[StringComparison]::OrdinalIgnoreCase) -and [string]::Equals($entry.ExecutablePath,'C:\Windows\System32\conhost.exe',[StringComparison]::OrdinalIgnoreCase)
            if(-not ($node -or $console)){throw 'unknown_descendant'}
            $key=[int]$entry.ProcessId
            if($records.ContainsKey($key)){if(-not (SameRecord $records[$key] $entry)){throw 'tree_identity_changed'}}
            else{
                if($records.Count -ge 64){throw 'tree_capacity'}
                $held=$null
                $held=& ($Operations.Hold) $entry
                if($null -eq $held){throw 'hold_failed'}
                $records[$key]=$entry;$handles[$key]=$held;$depths[$key]=$Depth+1
            }
            ReadBranch $records[$key] ($Depth+1)
        }
    }
    try{
        if($null -eq $Root -or $null -eq $RootIdentity -or $RootIdentity.Name -ne 'tunnel-client.exe'){return $false}
        $key=[int]$RootIdentity.ProcessId;$records[$key]=$RootIdentity;$handles[$key]=$Root;$depths[$key]=0
        # Acquire all known descendants and validate the complete initial tree before any signal.
        ReadBranch $RootIdentity 0
        foreach($entry in @($records.Values)){CheckHeld $entry $handles[[int]$entry.ProcessId]}
        if(-not (& ($Operations.Exited) $Root)){
            CheckHeld $RootIdentity $Root
            if(-not (& ($Operations.Terminate) $Root)){return $false}
        }
        $processed[$key]=$true
        # Freeze each producer before its conhost; a late child is checked under its held parent's lifetime.
        while($true){
            foreach($parent in @($records.Values)){ReadBranch $parent $depths[[int]$parent.ProcessId]}
            $pending=@($records.Values|Where-Object {-not $processed.ContainsKey([int]$_.ProcessId)})
            if(-not $pending.Count){break}
            $entry=@($pending|Sort-Object @{Expression={if($_.Name -ieq 'node.exe'){0}else{1}}},CreationDate,ProcessId)[0]
            $handle=$handles[[int]$entry.ProcessId]
            CheckHeld $entry $handle
            if(-not (& ($Operations.Exited) $handle)){
                if(-not (& ($Operations.Terminate) $handle)){return $false}
            }
            $processed[[int]$entry.ProcessId]=$true
        }
        foreach($handle in @($handles.Values)){if(-not (& ($Operations.Exited) $handle)){return $false}}
        return $true
    }catch{return $false}
    finally{
        foreach($key in @($handles.Keys)){if($key -ne [int]$RootIdentity.ProcessId){try{& ($Operations.Release) $handles[$key]}catch{}}}
    }
}
function Stop-OwnedTree {
    if(-not $started){return $true}
    try{
        if($null -eq $daemonStart -or $null -eq $child){return $false}
        $null=$child.SafeHandle
        $metadata=Get-CompanionBindingMetadata
        $rootIdentity=[pscustomobject]@{ProcessId=$child.Id;ParentProcessId=$PID;Name='tunnel-client.exe';ExecutablePath=$metadata.Binary;CreationDate=$daemonStart;SessionId=$child.SessionId}
        $operations=@{
            Identity={param($id)Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = '+$id) -Property ProcessId,ParentProcessId,Name,CreationDate,ExecutablePath,SessionId}
            Children={param($id)Get-CimInstance -ClassName Win32_Process -Filter ('ParentProcessId = '+$id) -Property ProcessId,ParentProcessId,Name,CreationDate,ExecutablePath,SessionId}
            Hold={param($entry)$process=[Diagnostics.Process]::GetProcessById([int]$entry.ProcessId);try{$null=$process.SafeHandle;return $process}catch{$process.Dispose();throw}}
            Birth={param($process)$process.StartTime}
            Id={param($process)$process.Id}
            Session={param($process)$process.SessionId}
            Image={param($process)$process.MainModule.FileName}
            ImageSafe={param($process)
                $path=$process.MainModule.FileName
                while($path){$item=Get-Item -LiteralPath $path -Force;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){return $false};$path=[IO.Path]::GetDirectoryName($path)}
                return $true
            }
            Exited={param($process)$process.HasExited}
            ExitAt={param($process)$process.ExitTime}
            Terminate={param($process)$process.Kill();return $process.WaitForExit(5000) -and $process.HasExited}
            Release={param($process)$process.Dispose()}
        }
        return Stop-VerifiedTunnelTree $child $rootIdentity $operations
    }catch{return $false}
}

try{
    [Console]::InputEncoding=[Text.Encoding]::UTF8
    [Console]::OutputEncoding=[Text.Encoding]::UTF8
    $raw=[Console]::In.ReadLine()
    if($null -eq $raw -or $raw.Length -gt 8192){throw 'input'}
    $data=ConvertFrom-Json -InputObject $raw
    if($data.requestId -notmatch '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' -or $data.DisplayText -isnot [string] -or $data.DisplayText.Length -gt 4096 -or $data.RuntimeRoot -isnot [string] -or $data.RuntimeRoot -notmatch '^C:\\Users\\[^\\]+\\AppData\\Local\\Temp\\pi-console-tunnel-[A-Za-z0-9]+$'){throw 'input'}
    $inputUntil=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$data.expiresAt)
    $leaseUntil=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$data.leaseUntil)
    if($inputUntil -le [DateTimeOffset]::UtcNow -or $leaseUntil -lt $inputUntil){$reason='expired';throw 'expired'}
    if(-not [Environment]::UserInteractive){$reason='noninteractive';throw 'desktop'}
    $mutex=New-Object Threading.Mutex($false,'Local\PiConsoleEchoTunnelInput')
    try{$mutexOwned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$mutexOwned=$true}
    if(-not $mutexOwned){$reason='input-busy';throw 'active_launcher'}
    Import-Module (Join-Path $PSScriptRoot 'tunnel-binding.psm1') -Force
    Assert-CompanionBindingFiles
    # A global ambiguous daemon cannot be attributed safely. Refuse; never stop it.
    if(@(Get-CimInstance -ClassName Win32_Process -Filter "Name LIKE 'tunnel-client%'" -Property ProcessId).Count -ne 0){$reason='daemon-unattributed';throw 'existing'}
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form=New-Object Windows.Forms.Form
    $form.Text='Pi Console — トンネル接続';$form.StartPosition='CenterScreen'
    $form.AutoScaleDimensions=[Drawing.SizeF]::new(96,96);$form.AutoScaleMode='Dpi'
    $uiFont=[Drawing.Font]::new([Drawing.SystemFonts]::MessageBoxFont.FontFamily,[single]14,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Point)
    $form.Font=$uiFont;$form.MinimizeBox=$false;$form.MaximizeBox=$false
    $area=[Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    if($area.Width -lt 480 -or $area.Height -lt 520){throw 'layout'}
    $form.Size=[Drawing.Size]::new([Math]::Min(860,$area.Width-32),[Math]::Min(840,$area.Height-32))
    $form.MinimumSize=[Drawing.Size]::new(448,488)
    $layout=New-Object Windows.Forms.TableLayoutPanel;$layout.Dock='Fill';$layout.ColumnCount=1;$layout.RowCount=5;$layout.Padding=[Windows.Forms.Padding]::new(12)
    [void]$layout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]::Percent,100))
    [void]$layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::Percent,100))
    for($i=1;$i -lt 5;$i++){[void]$layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::AutoSize))}
    $text=New-Object Windows.Forms.TextBox;$text.Multiline=$true;$text.ReadOnly=$true;$text.ScrollBars='Vertical';$text.WordWrap=$true;$text.Dock='Fill';$text.Text=$data.DisplayText.Replace([string][char]10,[Environment]::NewLine);$text.TabIndex=4
    $label=New-Object Windows.Forms.Label;$label.AutoSize=$true;$label.Text='既存の Restricted runtime key（伏せ字・保存なし）'
    $password=New-Object Windows.Forms.TextBox;$password.UseSystemPasswordChar=$true;$password.MaxLength=512;$password.Dock='Fill';$password.TabIndex=1
    $connect=New-Object Windows.Forms.Button;$connect.Text='入力して接続';$connect.AutoSize=$true;$connect.AutoSizeMode='GrowAndShrink';$connect.Enabled=$false;$connect.TabIndex=2
    $cancel=New-Object Windows.Forms.Button;$cancel.Text='取消 / 接続を止める';$cancel.AutoSize=$true;$cancel.AutoSizeMode='GrowAndShrink';$cancel.TabIndex=0
    $layout.Controls.Add($text,0,0);$layout.Controls.Add($label,0,1);$layout.Controls.Add($password,0,2);$layout.Controls.Add($connect,0,3);$layout.Controls.Add($cancel,0,4);$form.Controls.Add($layout)
    $form.add_Resize({$label.MaximumSize=[Drawing.Size]::new([Math]::Max(1,$form.ClientSize.Width-24),0)})
    $form.AcceptButton=$cancel;$form.CancelButton=$cancel
    $password.add_TextChanged({$connect.Enabled= -not $started -and $password.TextLength -ge 10})
    $cancel.add_Click({$script:reason=if($started){'stopped'}else{'cancelled'};$form.Close()})
    $form.add_Shown({
        # Check after DPI scaling; keep 14pt and refuse an unreadable layout.
        $currentArea=[Windows.Forms.Screen]::FromControl($form).WorkingArea
        $form.Width=[Math]::Min($form.Width,$currentArea.Width-32);$form.Height=[Math]::Min($form.Height,$currentArea.Height-32)
        $form.Left=$currentArea.Left+[int](($currentArea.Width-$form.Width)/2);$form.Top=$currentArea.Top+[int](($currentArea.Height-$form.Height)/2)
        $label.MaximumSize=[Drawing.Size]::new([Math]::Max(1,$form.ClientSize.Width-24),0);$layout.PerformLayout()
        $usableWidth=$layout.ClientSize.Width-24
        if($form.Width -gt $currentArea.Width-32 -or $form.Height -gt $currentArea.Height-32 -or $connect.GetPreferredSize([Drawing.Size]::Empty).Width -gt $usableWidth -or $cancel.GetPreferredSize([Drawing.Size]::Empty).Width -gt $usableWidth -or $text.Height -lt 120){
            $script:reason='unavailable';$form.Close();return
        }
        $script:reason='cancelled';$cancel.Focus()|Out-Null;Send-State 'input-open'
    })
    $connect.add_Click({
        try {
            if($started -or [DateTimeOffset]::UtcNow -ge $inputUntil){$script:reason='expired';$form.Close();return}
            $connect.Enabled=$false
            Assert-CompanionBindingFiles
            if(@(Get-CimInstance -ClassName Win32_Process -Filter "Name LIKE 'tunnel-client%'" -Property ProcessId).Count -ne 0){$script:reason='daemon-unattributed';$form.Close();return}
            $script:key=New-Object Security.SecureString
            foreach($character in $password.Text.ToCharArray()){$key.AppendChar($character)}
            $password.Clear();$password.Enabled=$false
            $script:info=New-CompanionTunnelStartInfo -RuntimeRoot $data.RuntimeRoot -RuntimeKey $key
            $script:child=New-Object Diagnostics.Process;$child.StartInfo=$info
            if(-not $child.Start()){throw 'start'};$script:started=$true;$script:reason='stopped';$script:daemonStart=$child.StartTime.ToUniversalTime()
            $script:readyUntil=[DateTimeOffset]::UtcNow.AddSeconds(60)
            Clear-CompanionParentKey $info;$key.Dispose();$script:key=$null
            $child.BeginOutputReadLine();$child.BeginErrorReadLine()
            $label.Text='起動中（準備確認は最大60秒）。キー保存なし / App接続は未確認';Send-State 'starting'
        }catch{$script:reason='unavailable';$form.Close()}
    })
    function Confirm-OwnedConnection {
        try {
            if(-not $started -or $null -eq $child -or $child.HasExited -or $child.StartTime.ToUniversalTime() -ne $daemonStart -or [DateTimeOffset]::UtcNow -ge $leaseUntil){return $false}
            Assert-CompanionBindingFiles
            $runtimeItem=Get-Item -LiteralPath $data.RuntimeRoot -Force
            if(-not $runtimeItem.PSIsContainer -or ($runtimeItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){return $false}
            $healthFile=Join-Path $data.RuntimeRoot 'health.url'
            $item=Get-Item -LiteralPath $healthFile -Force
            if($item.PSIsContainer -or $item.Length -gt 100 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){return $false}
            $health=(Get-Content -LiteralPath $healthFile -Raw).Trim()
            if($health -notmatch '^http://127\.0\.0\.1:([0-9]{1,5})$' -or [int]$Matches[1] -lt 1 -or [int]$Matches[1] -gt 65535){return $false}
            $healthPort=[int]$Matches[1]
            $listener=@(Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $healthPort -ErrorAction Stop)
            if($listener.Count -ne 1 -or $listener[0].OwningProcess -ne $child.Id){return $false}
            $reply=Invoke-WebRequest -UseBasicParsing -Uri ($health+'/readyz') -TimeoutSec 1 -Method Get -MaximumRedirection 0
            $listener=@(Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $healthPort -ErrorAction Stop)
            return $listener.Count -eq 1 -and $listener[0].OwningProcess -eq $child.Id -and $reply.StatusCode -eq 200 -and -not $child.HasExited -and $child.StartTime.ToUniversalTime() -eq $daemonStart -and [DateTimeOffset]::UtcNow -lt $leaseUntil
        }catch{return $false}
    }
    # Console.In is SyncTextReader on .NET Framework: even ReadLineAsync blocks.
    # Fixed managed delegate only; a PowerShell scriptblock on a worker has no runspace.
    # BEGIN CONTROL READER
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
public static class PiConsoleTunnelControl {
    public static Task<string> BeginRead(TextReader input) {
        return Task.Factory.StartNew(
            () => input.ReadLine(),
            CancellationToken.None,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default);
    }
}
'@
    # END CONTROL READER
    $read=[PiConsoleTunnelControl]::BeginRead([Console]::In)
    $timer=New-Object Windows.Forms.Timer;$timer.Interval=200
    $timer.add_Tick({
        try{
            if($read.IsCompleted){
                # The server sends only cancel. EOF also requests cleanup.
                $control=$read.GetAwaiter().GetResult()
                if($null -eq $control){$script:reason='cancelled';$form.Close();return}
                $value=ConvertFrom-Json -InputObject $control
                if($value.requestId -eq $data.requestId -and $value.action -eq 'verify' -and $value.probeId -match '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'){
                    $verified=($phase -eq 'tunnel-ready' -and (Confirm-OwnedConnection))
                    [Console]::Out.WriteLine((@{requestId=$data.requestId;probeId=$value.probeId;state=$(if($verified){'connection-verified'}else{'connection-unverified'})}|ConvertTo-Json -Compress));[Console]::Out.Flush()
                    $script:read=[PiConsoleTunnelControl]::BeginRead([Console]::In)
                    return
                }
                if($value.requestId -ne $data.requestId -or $value.action -ne 'cancel'){throw 'control'}
                $script:reason='cancelled';$form.Close();return
            }
            $utc=[DateTimeOffset]::UtcNow
            if(($started -and $utc -ge $leaseUntil) -or (-not $started -and $utc -ge $inputUntil)){$script:reason='expired';$form.Close();return}
            if($started -and $child.HasExited){$script:reason='stopped';$form.Close();return}
            if($started -and $phase -eq 'starting' -and $utc -ge $readyUntil){$script:reason='unavailable';$form.Close();return}
            $healthFile=Join-Path $data.RuntimeRoot 'health.url'
            if($started -and $phase -eq 'starting' -and (Test-Path -LiteralPath $healthFile)){
                $health=(Get-Content -LiteralPath $healthFile -Raw).Trim()
                if($health -match '^http://127\.0\.0\.1:\d+$'){
                    try{$reply=Invoke-WebRequest -UseBasicParsing -Uri ($health+'/readyz') -TimeoutSec 1 -Method Get
                        if($reply.StatusCode -eq 200){$label.Text='Tunnel ready。実App接続は未確認。閉じると接続を止めます。';Send-State 'tunnel-ready'}}catch{}
                }
            }
        }catch{$script:reason='unavailable';$form.Close()}
    })
    $timer.Start();[void]$form.ShowDialog()
}catch{}
finally{
    if($null -ne $timer){$timer.Stop();$timer.Dispose()}
    if($null -ne $password){$password.Clear();$password.Dispose()}
    if($null -ne $info){Clear-CompanionParentKey $info}
    if($null -ne $key){$key.Dispose()}
    $stopped=Stop-OwnedTree
    if($null -ne $child){$child.Dispose()}
    if($null -ne $form){$form.Dispose()}
    if($null -ne $uiFont){$uiFont.Dispose()}
    if($mutexOwned){$mutex.ReleaseMutex()}
    if($null -ne $mutex){$mutex.Dispose()}
    if($data -and $data.requestId){Send-State $(if($stopped){$reason}else{'stop-unconfirmed'})}
}
