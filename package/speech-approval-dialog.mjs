// speech.cpp onboarding approval — a separate, purpose-scoped native
// confirmation for the speech setup broker. It shares ONLY the generic
// windowsDialogTransport from owner-gui-dialog.mjs: a fixed PowerShell script
// with stdin JSON, bounded/cancelable transport, default Cancel. It never
// reuses the owner-enrollment script, display text, view fields or grants —
// approval here means "speech download/run only", never admin/MCP rights.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { windowsDialogTransport } from './owner-gui-dialog.mjs';

const fields = ['requestId', 'generation', 'expiresAt', 'source', 'modelId', 'modelLabel', 'downloadBytesNote', 'allowDownload', 'hasExistingExecutable', 'hasExistingModelDirectory', 'executablePath', 'modelDirectory'];
const SAFE_PATH = /^[^\u0000-\u001f]{0,260}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MODEL_LABEL = /^[\w. -]{1,64}$/;

/**
 * The immutable payload the host user approves. Paths are bound into the
 * digest and shown in the dialog, but validated for shape/control chars only —
 * the broker independently re-validates them with the service's own rules.
 */
export function speechApprovalBinding(view) {
  if (!view || Object.keys(view).some(k => !fields.includes(k) && k !== 'bindingDigest')
    || !UUID.test(view.requestId) || !HEX32.test(view.generation)
    || !Number.isSafeInteger(view.expiresAt)
    || !['managed', 'existing'].includes(view.source)
    || !/^[a-z0-9.-]{1,64}$/.test(view.modelId) || !MODEL_LABEL.test(view.modelLabel)
    || typeof view.downloadBytesNote !== 'string' || view.downloadBytesNote.length > 128
    || view.allowDownload !== true && view.allowDownload !== false
    || view.hasExistingExecutable !== true && view.hasExistingExecutable !== false
    || view.hasExistingModelDirectory !== true && view.hasExistingModelDirectory !== false
    || !SAFE_PATH.test(view.executablePath ?? '') || !SAFE_PATH.test(view.modelDirectory ?? '')) throw Error('speech_approval_view_unavailable');
  return createHash('sha256').update(JSON.stringify(fields.map(k => view[k]))).digest('hex');
}
const quote = value => JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/** Fixed Japanese dialog copy. Every dynamic value is a bound, whitelisted field. */
export function speechApprovalDisplay(view) {
  if (view.bindingDigest !== speechApprovalBinding(view)) throw Error('speech_approval_view_unavailable');
  return [
    'Pi Console 音声入力の確認',
    '• 目的：このPCで音声入力を使えるよう、必要なファイルのダウンロードと実行を許可します。',
    '• 設定画面の要求内容と一致する場合だけ許可してください。',
    '• 許可するのは今回の音声入力の準備だけです。管理者登録・MCPキー・他の権限は付与しません。',
    '• 初期状態の Enter・Escape・取消・閉じるでは許可しません。',
    '',
    '【申請内容】',
    '• 申請 ID', '  ' + view.requestId, '',
    '• モデル', '  ' + quote(view.modelLabel) + ' (' + quote(view.modelId) + ')', '',
    '• 導入方法', view.source === 'managed' ? '  公式ダウンロード＋ポータブルインストール' : '  このPC上の既存 speech.exe を利用', '',
    '• ダウンロード', view.allowDownload ? '  許可（' + quote(view.downloadBytesNote) + '）' : '  許可しない（既存キャッシュのみ）', '',
    view.hasExistingExecutable ? '• 実行ファイル\n  ' + quote(view.executablePath ?? '') : '• 実行ファイルは Console データ領域内の検証済みコピーを使用します', '',
    view.hasExistingModelDirectory ? '• モデルキャッシュ\n  ' + quote(view.modelDirectory ?? '') : '• モデルは Console データ領域内のキャッシュを使用します', '',
    '• 有効期限 (UTC)', '  ' + new Date(view.expiresAt).toISOString(), '',
    '【Console の確認情報】',
    '• Console 世代', '  ' + view.generation, '',
    'これはローカルの意思確認です。OS の強固な本人認証ではありません。',
  ].join('\n');
}

// FIXED script only — same shape as the owner dialog but separate copy:
// speech approval text, '音声入力を許可' approve label, default Cancel.
// Display data enters through stdin JSON only; never argv, files, URLs or eval.
export const speechApprovalScript = String.raw`$ErrorActionPreference = 'Stop'
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
  $form.Text = 'Pi Console — 音声入力の確認'
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
  $approve.Text = '音声入力を許可'
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

/** Trusted composition/test injection only; no HTTP/env chooses a fake response. */
export function createWindowsSpeechApprovalDialog({ transport = windowsDialogTransport, platform = process.platform, env = process.env } = {}) {
  return async (view, { signal }) => {
    const digest = speechApprovalBinding(view);
    if (digest !== view.bindingDigest) throw Error('speech_approval_view_unavailable');
    if (signal.aborted) return { decision: 'cancelled', bindingDigest: digest };
    if (platform !== 'win32') return { decision: 'unavailable', bindingDigest: digest };
    const childEnv = {}; for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'ComSpec', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) if (env[key]) childEnv[key] = env[key];
    const file = join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(speechApprovalScript, 'utf16le').toString('base64')];
    let decision; try { decision = await transport({ file, args, input: JSON.stringify({ DisplayText: speechApprovalDisplay(view) }), env: childEnv, signal }); } catch { decision = 'unavailable'; }
    if (signal.aborted) decision = 'cancelled';
    if (!['approved', 'cancelled', 'noninteractive', 'unavailable'].includes(decision)) decision = 'unavailable';
    return { decision, bindingDigest: digest };
  };
}
