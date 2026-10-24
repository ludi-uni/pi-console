param([Parameter(Mandatory=$true)][string]$ExpectedStartup, [Parameter(Mandatory=$true)][int]$DiagnosticPid)
# Read-only inventory. Command lines / task arguments / service paths remain only in memory.
# Do not print raw metadata or exception text: it can contain credentials.
$ErrorActionPreference = 'Stop'
try {
  $processes = @(Get-CimInstance Win32_Process)
  $running = @(); $unreadable = 0; $unclassifiedNode = 0
  foreach ($p in $processes) {
    if ($p.ProcessId -eq $PID -or $p.ProcessId -eq $DiagnosticPid) { continue }
    if ([string]::IsNullOrEmpty($p.CommandLine)) { $unreadable++; continue }
    if ($p.CommandLine -match '(?i)pi-console|sdk-worker\.mjs|control-server\.mjs|readonly-mcp-guard|tunnel-client') {
      $running += @{ pid = [int]$p.ProcessId; parentPid = [int]$p.ParentProcessId; kind = 'console-or-related-candidate' }
    } elseif ($p.Name -match '^(?i)node(\.exe)?$') { $unclassifiedNode++ }
  }
  $startup = @(); $shell = New-Object -ComObject WScript.Shell
  $folders = @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup')) | Select-Object -Unique
  foreach ($folder in $folders) {
    foreach ($item in @(Get-ChildItem -LiteralPath $folder -File)) {
      $kind = 'unclassified-startup-entry'; $owned = $false
      if ($item.Extension -eq '.lnk') {
        $s = $shell.CreateShortcut($item.FullName) # Never call Save().
        $expectedArgs = '--import tsx "' + $ExpectedStartup + '"'
        $owned = $s.Description -eq 'Pi Console managed startup v1' -and $s.Arguments -eq $expectedArgs -and [IO.Path]::GetFileName($s.TargetPath) -eq 'node.exe' -and $s.WorkingDirectory.TrimEnd('\','/') -eq (Split-Path (Split-Path $ExpectedStartup -Parent) -Parent).TrimEnd('\','/')
        if ($owned) { $kind = 'reviewed-managed-startup' }
        elseif (($s.Arguments + $s.TargetPath + $s.WorkingDirectory) -match '(?i)pi-console') { $kind = 'other-console-startup' }
      }
      $startup += @{ kind = $kind; ownedMarkerAndTarget = $owned }
    }
  }
  $tasks = @(Get-ScheduledTask); $taskMatches = 0
  foreach ($task in $tasks) {
    foreach ($action in $task.Actions) {
      if (($action.Execute + ' ' + $action.Arguments + ' ' + $action.WorkingDirectory) -match '(?i)pi-console') { $taskMatches++; break }
    }
  }
  $services = @(Get-CimInstance Win32_Service); $serviceMatches = 0
  foreach ($s in $services) { if ($s.PathName -match '(?i)pi-console') { $serviceMatches++ } }
  @{
    observed = $true; processCount = $processes.Count; unreadableProcessMetadata = $unreadable
    unclassifiedNodeProcesses = $unclassifiedNode; running = @($running); startup = @($startup)
    taskCount = $tasks.Count; directConsoleTasks = $taskMatches
    serviceCount = $services.Count; directConsoleServices = $serviceMatches
    complete = $false; externalStartExclusion = $false
  } | ConvertTo-Json -Depth 6 -Compress
} catch {
  # No fallback, elevation or alternate query after refusal/failure.
  Write-Output '{"observed":false,"complete":false,"code":"OS_INVENTORY_DENIED_OR_FAILED"}'
  exit 2
}
