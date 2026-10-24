import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const fields=['requestId','subject','issuer','audience','expiresAt','pid','startedAt','port','generation'];
export function ownerGuiBinding(view) {
  if(!view||Object.keys(view).some(k=>!fields.includes(k)&&k!=='bindingDigest')||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(view.requestId)||typeof view.subject!=='string'||!view.subject||view.subject.length>200||typeof view.issuer!=='string'||!view.issuer||view.issuer.length>512||typeof view.audience!=='string'||!view.audience||view.audience.length>512||!Number.isSafeInteger(view.expiresAt)||!Number.isSafeInteger(view.pid)||view.pid<=0||!Number.isSafeInteger(view.port)||view.port<1||view.port>65535||typeof view.startedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(view.startedAt)||!/^[0-9a-f]{32}$/.test(view.generation))throw Error('owner_gui_view_unavailable');
  return createHash('sha256').update(JSON.stringify(fields.map(k=>view[k]))).digest('hex');
}
const quote = value => JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export function ownerGuiDisplay(view) {
  if(view.bindingDigest!==ownerGuiBinding(view))throw Error('owner_gui_view_unavailable');
  return [
    'Pi Console 管理者登録の確認',
    '• 目的：この申請の本人を Console の管理者として登録します。',
    '• 設定画面で自分が申請した内容と一致する場合だけ登録してください。',
    '• 登録だけでは MCP キー・接続・親フォルダの許可は発行されません。',
    '• 初期状態の Enter・Escape・取消・閉じるでは登録しません。',
    '',
    '【本人の識別情報】',
    '• 認証済み subject', '  '+quote(view.subject), '',
    '• Issuer', '  '+quote(view.issuer), '',
    '• AUD', '  '+quote(view.audience), '',
    '【申請内容】',
    '• 申請 ID', '  '+view.requestId, '',
    '• 有効期限 (UTC)', '  '+new Date(view.expiresAt).toISOString(), '',
    '【Console の確認情報】',
    '• Console 世代', '  '+view.generation, '',
    '• PID / port', '  '+view.pid+' / '+view.port, '',
    '• 起動 (UTC)', '  '+view.startedAt, '',
    'これはローカルの意思確認です。OS の強固な本人認証ではありません。',
  ].join('\n');
}

// FIXED script only. Display data enters through stdin JSON, never interpolation,
// argv, URL, a file, Invoke-Expression, a browser callback or a protocol handler.
export const ownerGuiScript = String.raw`$ErrorActionPreference = 'Stop'
try {
  if (-not [Environment]::UserInteractive) { [Console]::Out.Write('noninteractive'); exit 0 }
  [Console]::InputEncoding = [Text.Encoding]::UTF8
  $raw = [Console]::In.ReadToEnd()
  if ($raw.Length -gt 8192) { throw 'input' }
  $data = ConvertFrom-Json -InputObject $raw
  if ($data.DisplayText -isnot [string] -or $data.DisplayText.Length -gt 4096) { throw 'input' }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $form = New-Object Windows.Forms.Form
  $form.SuspendLayout()
  $form.Text = 'Pi Console — 初回本人登録'
  $form.StartPosition = 'Manual'
  $form.MinimizeBox = $false
  $form.MaximizeBox = $false
  $form.FormBorderStyle = 'Sizable'
  $form.AutoScaleDimensions = [Drawing.SizeF]::new(96, 96)
  $form.AutoScaleMode = 'Dpi'
  $uiFont = [Drawing.Font]::new([Drawing.SystemFonts]::MessageBoxFont.FontFamily, [single]14, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Point)
  $form.Font = $uiFont
  $layout = New-Object Windows.Forms.TableLayoutPanel
  $layout.Dock = 'Fill'
  $layout.AutoSize = $false
  $layout.ColumnCount = 1
  $layout.RowCount = 3
  $layout.Padding = [Windows.Forms.Padding]::new(12)
  [void]$layout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]::Percent, 100))
  [void]$layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::Percent, 100))
  [void]$layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::AutoSize))
  [void]$layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::AutoSize))
  $text = New-Object Windows.Forms.TextBox
  $text.Multiline = $true
  $text.ReadOnly = $true
  $text.ScrollBars = 'Vertical'
  $text.WordWrap = $true
  $text.Text = $data.DisplayText.Replace([string][char]10, [Environment]::NewLine)
  $text.Dock = 'Fill'
  $text.Margin = [Windows.Forms.Padding]::new(0, 0, 0, 8)
  $text.TabIndex = 2
  $cancel = New-Object Windows.Forms.Button
  $cancel.Text = '取消'
  $cancel.AutoSize = $true
  $cancel.AutoSizeMode = 'GrowAndShrink'
  $cancel.Dock = 'Fill'
  $cancel.Padding = [Windows.Forms.Padding]::new(8, 4, 8, 4)
  $cancel.Margin = [Windows.Forms.Padding]::new(0, 6, 0, 0)
  $cancel.TabIndex = 0
  $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
  $approve = New-Object Windows.Forms.Button
  $approve.Text = 'この本人を登録'
  $approve.AutoSize = $true
  $approve.AutoSizeMode = 'GrowAndShrink'
  $approve.Dock = 'Fill'
  $approve.Padding = [Windows.Forms.Padding]::new(8, 4, 8, 4)
  $approve.Margin = [Windows.Forms.Padding]::new(0, 6, 0, 0)
  $approve.TabIndex = 1
  $approve.DialogResult = [Windows.Forms.DialogResult]::Yes
  $layout.Controls.Add($text, 0, 0)
  $layout.Controls.Add($approve, 0, 1)
  $layout.Controls.Add($cancel, 0, 2)
  $form.Controls.Add($layout)
  $form.ResumeLayout($false)
  $form.PerformAutoScale()
  $area = [Windows.Forms.Screen]::FromHandle($form.Handle).WorkingArea
  $scale = [Math]::Max(1.0, $form.CurrentAutoScaleDimensions.Width / 96.0)
  $edge = [Math]::Ceiling(16 * $scale)
  $maxWidth = $area.Width - 2 * $edge
  $maxHeight = $area.Height - 2 * $edge
  if ($maxWidth -le 0 -or $maxHeight -le 0) { throw 'layout' }
  $frameWidth = $form.Width - $form.ClientSize.Width
  $frameHeight = $form.Height - $form.ClientSize.Height
  $approveSize = $approve.GetPreferredSize([Drawing.Size]::Empty)
  $cancelSize = $cancel.GetPreferredSize([Drawing.Size]::Empty)
  $minWidth = [Math]::Ceiling($layout.Padding.Horizontal + [Math]::Max($approveSize.Width, $cancelSize.Width) + $frameWidth)
  $minHeight = [Math]::Ceiling($layout.Padding.Vertical + $approveSize.Height + $cancelSize.Height + $approve.Margin.Vertical + $cancel.Margin.Vertical + $text.Margin.Vertical + $text.PreferredHeight + 2 * $text.Font.Height + $frameHeight)
  if ($minWidth -gt $maxWidth -or $minHeight -gt $maxHeight) { throw 'layout' }
  $form.MaximumSize = [Drawing.Size]::new($maxWidth, $maxHeight)
  $form.MinimumSize = [Drawing.Size]::new($minWidth, $minHeight)
  $form.Size = [Drawing.Size]::new([Math]::Min($maxWidth, [Math]::Max($minWidth, [Math]::Ceiling(920 * $scale))), [Math]::Min($maxHeight, [Math]::Max($minHeight, [Math]::Ceiling(720 * $scale))))
  $form.Location = [Drawing.Point]::new($area.Left + [Math]::Floor(($area.Width - $form.Width) / 2), $area.Top + [Math]::Floor(($area.Height - $form.Height) / 2))
  $form.PerformLayout()
  $form.ActiveControl = $cancel
  $form.add_Disposed({ $uiFont.Dispose() })
  $form.AcceptButton = $cancel
  $form.CancelButton = $cancel
  try { $result = $form.ShowDialog() } finally { $form.Dispose() }
  if ($result -eq [Windows.Forms.DialogResult]::Yes) { [Console]::Out.Write('approved') } else { [Console]::Out.Write('cancelled') }
} catch { [Console]::Out.Write('unavailable') }`;

export function windowsDialogTransport({file,args,input,env,signal}) {
  return new Promise(resolve=>{
    let child,finished=false,raw='',forced;
    const finish=value=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);resolve(value)};
    const abort=()=>{forced='cancelled';child?.kill()};
    if(signal.aborted)return finish('cancelled');
    try {
      child=spawn(file,args,{windowsHide:false,env,stdio:['pipe','pipe','pipe']});
      signal.addEventListener('abort',abort,{once:true});
      child.stdout.on('data',chunk=>{raw+=chunk.toString();if(raw.length>32){forced='unavailable';child.kill()}});
      child.stderr.on('data',()=>{}); // Raw PowerShell errors must never become logs.
      child.stdin.on('error',()=>{forced='unavailable';child.kill()});
      child.once('error',()=>{forced='unavailable';if(!child.pid)finish('unavailable')});
      child.once('close',code=>finish(forced??(code===0&&['approved','cancelled','noninteractive','unavailable'].includes(raw)?raw:'unavailable')));
      child.stdin.end(input,'utf8');
    } catch { forced='unavailable';if(child?.pid){try{child.kill()}catch{ /* Keep the slot until close, never overlap an uncertain live dialog. */ }}else finish('unavailable') }
  });
}
/** Trusted composition/test transport only; no HTTP/env chooses a fake response. */
export function createWindowsOwnerDialog({transport=windowsDialogTransport,platform=process.platform,env=process.env}={}) {
  return async (view,{signal})=>{
    const digest=ownerGuiBinding(view);
    if(digest!==view.bindingDigest)throw Error('owner_gui_view_unavailable');
    if(signal.aborted)return{decision:'cancelled',bindingDigest:digest};
    if(platform!=='win32')return{decision:'unavailable',bindingDigest:digest};
    const childEnv={};for(const key of ['SystemRoot','WINDIR','PATH','PATHEXT','ComSpec','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])if(env[key])childEnv[key]=env[key];
    const file=join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const args=['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(ownerGuiScript,'utf16le').toString('base64')];
    let decision;try{decision=await transport({file,args,input:JSON.stringify({DisplayText:ownerGuiDisplay(view)}),env:childEnv,signal})}catch{decision='unavailable'};
    if(signal.aborted)decision='cancelled';
    if(!['approved','cancelled','noninteractive','unavailable'].includes(decision))decision='unavailable';
    return{decision,bindingDigest:digest};
  };
}
