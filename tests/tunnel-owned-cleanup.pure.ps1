param([Parameter(Mandatory=$true)][string]$EvidenceRoot)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null;$source=Join-Path $PSScriptRoot '..\package\tunnel-key-dialog.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'SOURCE_PARSE_ERROR'}
$f=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Stop-VerifiedTunnelTree'},$true));if($f.Count -ne 1){throw 'FIXED_PURE_FUNCTION_MISSING'}
. ([ScriptBlock]::Create($f[0].Extent.Text))
function Record([int]$Id,[int]$Parent,[string]$Name,[string]$Image,[int]$Seconds,[int]$Session=1){[pscustomobject]@{ProcessId=$Id;ParentProcessId=$Parent;Name=$Name;ExecutablePath=$Image;CreationDate=$script:base.AddSeconds($Seconds);SessionId=$Session}}
function CopyRecord($r){[pscustomobject]@{ProcessId=$r.ProcessId;ParentProcessId=$r.ParentProcessId;Name=$r.Name;ExecutablePath=$r.ExecutablePath;CreationDate=$r.CreationDate;SessionId=$r.SessionId}}
function FakeHandle($r){[pscustomobject]@{Id=$r.ProcessId;Token=('DUMMY-HANDLE-'+$r.ProcessId);Birth=$r.CreationDate;Image=$r.ExecutablePath;Session=$r.SessionId;Exited=$false;ExitAt=$script:base.AddSeconds(10);ImageSafe=$true;Held=$false}}
function AddRecord($r){$script:ctx.Cim[[int]$r.ProcessId]=$r;$script:ctx.Handles[[int]$r.ProcessId]=FakeHandle $r}
$cases=@(
 @{Name='known-direct-conhost-and-node';Expected=$true;Signals=@(1000,2000,3000,3001)},
 @{Name='observed-root-node-one-conhost-shape';Expected=$true;Signals=@(1000,2000,3000);Configure={$ctx.Cim.Remove(3001);$ctx.Handles.Remove(3001)}},
 @{Name='conhosts-exit-automatically-with-producers';Expected=$true;Signals=@(1000,2000);Flag='AutoConsoleExit'},
 @{Name='windows-image-case-insensitive';Expected=$true;Signals=@(1000,2000,3000,3001);Configure={$ctx.Cim[3000].Name='ConHost.EXE';$ctx.Cim[3000].ExecutablePath='c:\WINDOWS\SYSTEM32\ConHost.EXE';$ctx.Handles[3000].Image=$ctx.Cim[3000].ExecutablePath}},
 @{Name='microsecond-cim-dotnet-normalization';Expected=$true;Signals=@(1000,2000,3000,3001);Configure={$ctx.RootExpected.CreationDate=$base.AddTicks(5);$ctx.Handles[1000].Birth=$base.AddTicks(5)}},
 @{Name='same-name-conhost-different-directory';Expected=$false;Signals=@();Configure={$ctx.Cim[3000].ExecutablePath='C:\Dummy\conhost.exe';$ctx.Handles[3000].Image=$ctx.Cim[3000].ExecutablePath}},
 @{Name='node-different-image';Expected=$false;Signals=@();Configure={$ctx.Cim[2000].ExecutablePath='C:\Dummy\node.exe';$ctx.Handles[2000].Image=$ctx.Cim[2000].ExecutablePath}},
 @{Name='unc-conhost-path';Expected=$false;Signals=@();Configure={$ctx.Cim[3000].ExecutablePath='\\localhost\C$\Windows\System32\conhost.exe';$ctx.Handles[3000].Image=$ctx.Cim[3000].ExecutablePath}},
 @{Name='device-conhost-path';Expected=$false;Signals=@();Configure={$ctx.Cim[3000].ExecutablePath='\\?\C:\Windows\System32\conhost.exe';$ctx.Handles[3000].Image=$ctx.Cim[3000].ExecutablePath}},
 @{Name='trailing-dot-conhost-path';Expected=$false;Signals=@();Configure={$ctx.Cim[3000].ExecutablePath='C:\Windows\System32\conhost.exe.';$ctx.Handles[3000].Image=$ctx.Cim[3000].ExecutablePath}},
 @{Name='image-ancestor-reparse';Expected=$false;Signals=@();Configure={$ctx.Handles[3000].ImageSafe=$false}},
 @{Name='child-predates-parent';Expected=$false;Signals=@();Configure={$ctx.Cim[3000].CreationDate=$base.AddSeconds(-1);$ctx.Handles[3000].Birth=$ctx.Cim[3000].CreationDate}},
 @{Name='grandchild-predates-parent';Expected=$false;Signals=@();Configure={$ctx.Cim[3001].CreationDate=$base;$ctx.Handles[3001].Birth=$base}},
 @{Name='child-other-session';Expected=$false;Signals=@();Configure={$ctx.Cim[3000].SessionId=2;$ctx.Handles[3000].Session=2}},
 @{Name='held-process-wrong-id';Expected=$false;Signals=@();Configure={$ctx.Handles[2000].Id=7777}},
 @{Name='held-process-wrong-birth';Expected=$false;Signals=@();Configure={$ctx.Handles[2000].Birth=$ctx.Handles[2000].Birth.AddTicks(10)}},
 @{Name='held-process-wrong-image';Expected=$false;Signals=@();Configure={$ctx.Handles[2000].Image='C:\Dummy\other.exe'}},
 @{Name='unknown-direct-child';Expected=$false;Signals=@();Configure={AddRecord (Record 4000 1000 'cmd.exe' 'C:\Windows\System32\cmd.exe' 3)}},
 @{Name='unknown-grandchild';Expected=$false;Signals=@();Configure={AddRecord (Record 4000 2000 'other.exe' 'C:\Dummy\other.exe' 3)}},
 @{Name='conhost-is-leaf';Expected=$false;Signals=@();Configure={AddRecord (Record 4000 3000 'node.exe' 'C:\Program Files\nodejs\node.exe' 3)}},
 @{Name='bounded-tree-depth';Expected=$false;Signals=@();Configure={AddRecord (Record 4000 2000 'node.exe' 'C:\Program Files\nodejs\node.exe' 3);AddRecord (Record 4001 4000 'node.exe' 'C:\Program Files\nodejs\node.exe' 4);AddRecord (Record 4002 4001 'node.exe' 'C:\Program Files\nodejs\node.exe' 5);AddRecord (Record 4003 4002 'node.exe' 'C:\Program Files\nodejs\node.exe' 6)}},
 @{Name='bounded-tree-size';Expected=$false;Signals=@();Configure={foreach($i in 1..65){AddRecord (Record (5000+$i) 1000 'node.exe' 'C:\Program Files\nodejs\node.exe' 3)}}},
 @{Name='pid-reuse-during-hold';Expected=$false;Signals=@();Flag='ReuseOnHold'},
 @{Name='identity-reparent-before-first-stop';Expected=$false;Signals=@();Flag='ReparentOnRead'},
 @{Name='root-identity-changes-before-first-stop';Expected=$false;Signals=@();Flag='RootChangedOnRead'},
 @{Name='hold-access-failure';Expected=$false;Signals=@();Flag='HoldFailure'},
 @{Name='late-valid-node-during-root-stop';Expected=$true;Signals=@(1000,2000,3000,3001,5000);Flag='LateValidRootChild'},
 @{Name='late-unknown-during-root-stop';Expected=$false;Signals=@(1000);Flag='LateUnknownRootChild'},
 @{Name='late-valid-grandchild-during-node-stop';Expected=$true;Signals=@(1000,2000,3000,3001,5000);Flag='LateValidGrandchild'},
 @{Name='late-unknown-grandchild-during-node-stop';Expected=$false;Signals=@(1000,2000);Flag='LateUnknownGrandchild'},
 @{Name='child-pid-reused-after-root-stop';Expected=$false;Signals=@(1000);Flag='ChildReusedAfterRoot'},
 @{Name='pid-reused-between-check-and-held-termination';Expected=$false;Signals=@(1000);Flag='ReuseAtTerminate'},
 @{Name='root-pid-reused-after-stop';Expected=$false;Signals=@(1000);Flag='RootReusedAfterStop'},
 @{Name='wait-exit-unconfirmed';Expected=$false;Signals=@(1000);Flag='WaitFailure'},
 @{Name='already-exited-held-root';Expected=$true;Signals=@(2000,3000,3001);Configure={$ctx.Handles[1000].Exited=$true;$ctx.Cim.Remove(1000)}},
 @{Name='already-exited-root-pid-reused';Expected=$false;Signals=@();Configure={$ctx.Handles[1000].Exited=$true;$ctx.Cim[1000].CreationDate=$base.AddMinutes(1);$ctx.Cim[1000].ParentProcessId=888}},
 @{Name='wrong-root-parent';Expected=$false;Signals=@();Configure={$ctx.Cim[1000].ParentProcessId=888}},
 @{Name='child-created-after-held-parent-exit';Expected=$false;Signals=@();Configure={$ctx.Handles[1000].Exited=$true;$ctx.Cim.Remove(1000);$ctx.Cim[3000].CreationDate=$base.AddSeconds(11);$ctx.Handles[3000].Birth=$ctx.Cim[3000].CreationDate}}
)
$results=@()
foreach($case in $cases){
 $script:base=[DateTime]::SpecifyKind([DateTime]::Parse('2026-10-12T00:00:00'),[DateTimeKind]::Utc)
 $script:ctx=@{Cim=@{};Handles=@{};Signals=[Collections.Generic.List[int]]::new();HeldIds=[Collections.Generic.List[string]]::new();Released=[Collections.Generic.List[string]]::new();QueriedIds=[Collections.Generic.List[int]]::new();ReadCounts=@{};Flag=$case.Flag}
 AddRecord (Record 1000 777 'tunnel-client.exe' 'C:\Dummy\tunnel-client.exe' 0);$ctx.RootExpected=CopyRecord $ctx.Cim[1000]
 AddRecord (Record 2000 1000 'node.exe' 'C:\Program Files\nodejs\node.exe' 1)
 AddRecord (Record 3000 1000 'conhost.exe' 'C:\Windows\System32\conhost.exe' 2)
 AddRecord (Record 3001 2000 'conhost.exe' 'C:\Windows\System32\conhost.exe' 2)
 # Another Tunnel with the same binary, node image, owner/session and timestamps is never visited.
 AddRecord (Record 9000 999 'tunnel-client.exe' 'C:\Dummy\tunnel-client.exe' 0);AddRecord (Record 9001 9000 'node.exe' 'C:\Program Files\nodejs\node.exe' 1)
 $ctx.Handles[1000].Held=$true
 if($case.Configure){& $case.Configure}
 $api=@{
  Identity={param($id)$ctx.QueriedIds.Add($id);if(-not $ctx.ReadCounts.ContainsKey($id)){$ctx.ReadCounts[$id]=0};$ctx.ReadCounts[$id]++
    if($ctx.Flag -eq 'ReparentOnRead' -and $id -eq 2000 -and $ctx.ReadCounts[$id] -eq 2){$ctx.Cim[$id].ParentProcessId=9000}
    if($ctx.Flag -eq 'RootChangedOnRead' -and $id -eq 1000 -and $ctx.ReadCounts[$id] -eq 3){$ctx.Cim[$id].CreationDate=$base.AddMinutes(1)}
    if($ctx.Cim.ContainsKey($id)){CopyRecord $ctx.Cim[$id]}
  }
  Children={param($id)$ctx.QueriedIds.Add($id);@($ctx.Cim.Values|Where-Object {$_.ParentProcessId -eq $id}|Sort-Object ProcessId|ForEach-Object {CopyRecord $_})}
  Hold={param($entry)$id=[int]$entry.ProcessId;if($ctx.Flag -eq 'HoldFailure' -and $id -eq 2000){throw 'DUMMY_ACCESS_DENIED'}
    if($ctx.Flag -eq 'ReuseOnHold' -and $id -eq 2000){$ctx.Cim[$id].CreationDate=$base.AddMinutes(1);$ctx.Handles[$id].Birth=$ctx.Cim[$id].CreationDate}
    $ctx.Handles[$id].Held=$true;$ctx.HeldIds.Add($ctx.Handles[$id].Token);$ctx.Handles[$id]
  }
  Birth={param($p)$p.Birth};Id={param($p)$p.Id};Session={param($p)$p.Session};Image={param($p)$p.Image};ImageSafe={param($p)$p.ImageSafe};Exited={param($p)$p.Exited};ExitAt={param($p)$p.ExitAt}
  Terminate={param($p)
    if(-not $p.Held -or $p.Id -in @(9000,9001)){throw 'DUMMY_UNOWNED_SIGNAL'}
    if($ctx.Flag -eq 'ReuseAtTerminate' -and $p.Id -eq 2000){$p.Exited=$true;$ctx.Cim[2000].CreationDate=$base.AddMinutes(1);$ctx.Cim[2000].ParentProcessId=9000}
    if($p.Exited){throw 'DUMMY_ORIGINAL_HANDLE_ALREADY_EXITED'}
    $ctx.Signals.Add($p.Id)
    if($ctx.Flag -eq 'WaitFailure' -and $p.Id -eq 1000){return $false}
    $p.Exited=$true;$ctx.Cim.Remove([int]$p.Id)
    if($ctx.Flag -eq 'AutoConsoleExit'){$consoleId=if($p.Id -eq 1000){3000}elseif($p.Id -eq 2000){3001}else{0};if($consoleId){$ctx.Handles[$consoleId].Exited=$true;$ctx.Cim.Remove($consoleId)}}
    if($p.Id -eq 1000){
      if($ctx.Flag -eq 'LateValidRootChild'){AddRecord (Record 5000 1000 'node.exe' 'C:\Program Files\nodejs\node.exe' 3)}
      if($ctx.Flag -eq 'LateUnknownRootChild'){AddRecord (Record 5000 1000 'cmd.exe' 'C:\Windows\System32\cmd.exe' 3)}
      if($ctx.Flag -eq 'ChildReusedAfterRoot'){$ctx.Handles[2000].Exited=$true;$ctx.Cim[2000].CreationDate=$base.AddMinutes(1);$ctx.Cim[2000].ParentProcessId=9000}
      if($ctx.Flag -eq 'RootReusedAfterStop'){$ctx.Cim[1000]=Record 1000 888 'tunnel-client.exe' 'C:\Dummy\other.exe' 60}
    }
    if($p.Id -eq 2000){
      if($ctx.Flag -eq 'LateValidGrandchild'){AddRecord (Record 5000 2000 'node.exe' 'C:\Program Files\nodejs\node.exe' 3)}
      if($ctx.Flag -eq 'LateUnknownGrandchild'){AddRecord (Record 5000 2000 'cmd.exe' 'C:\Windows\System32\cmd.exe' 3)}
    }
    return $true
  }
  Release={param($p)$ctx.Released.Add($p.Token)}
 }
 $actual=Stop-VerifiedTunnelTree $ctx.Handles[1000] $ctx.RootExpected $api
 $expectedSignals=@($case.Signals|Sort-Object);$actualSignals=@($ctx.Signals.ToArray()|Sort-Object)
 $sameSignals=($expectedSignals.Count -eq $actualSignals.Count -and ($expectedSignals -join ',') -eq ($actualSignals -join ','))
 $foreignVisited=@($ctx.QueriedIds|Where-Object {$_ -in @(9000,9001)}).Count
 $releasedAll=(@($ctx.HeldIds|Where-Object {$_ -notin $ctx.Released}).Count -eq 0)
 $pass=$actual -eq $case.Expected -and $sameSignals -and $foreignVisited -eq 0 -and $releasedAll
 $results+=[ordered]@{name=$case.Name;pass=$pass;expected=$case.Expected;actual=$actual;fakeSignals=$actualSignals;otherTunnelVisited=$foreignVisited;heldChildrenReleased=$releasedAll}
 if(-not $pass){[Console]::Out.WriteLine(($results[-1]|ConvertTo-Json -Depth 5));break}
}
$notStarted=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Stop-OwnedTree'},$true));if($notStarted.Count -ne 1){throw 'FIXED_WRAPPER_MISSING'}
. ([ScriptBlock]::Create($notStarted[0].Extent.Text));$script:started=$false
$beforeSignals=$ctx.Signals.Count;$unstarted=Stop-OwnedTree
$results+=[ordered]@{name='unstarted-launch-never-enters-os-provider';pass=($unstarted -eq $true -and $ctx.Signals.Count -eq $beforeSignals);expected=$true;actual=$unstarted;fakeSignals=@();otherTunnelVisited=0;heldChildrenReleased=$true}
$report=[ordered]@{tests=$cases.Count+1;executed=$results.Count;passed=@($results|Where-Object {$_.pass}).Count;failed=@($results|Where-Object {-not $_.pass}).Count;parseErrors=$errors.Count;runnerPid=$PID;finishedUtc=[DateTime]::UtcNow.ToString('o');fakeProviderOnly=$true;actualOsReads=0;actualProcessSignals=0;nativeEntryExecuted=$false;cases=$results}
[IO.File]::WriteAllText((Join-Path $EvidenceRoot 'cleanup-dummy.json'),($report|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
if($report.failed -or $report.executed -ne $report.tests){exit 1}
[Console]::Out.WriteLine(('cleanup dummy: '+$report.passed+'/'+$report.tests+'; real process signals 0'))
