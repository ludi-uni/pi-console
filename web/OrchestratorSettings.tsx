import React, { useEffect, useState } from 'react';

type Config = {
  modelSource: string;
  modelSavePath: string;
  capabilities: Record<string, { description: string; primary: string; fallback: string[]; status: string; candidates: string[]; placeholder: string[]; unbound: string[] }>;
  backends: Record<string, { description: string; vision: boolean; provider: string; model: string; thinking: string; status: string }>;
};
export default function OrchestratorSettings({ ja }: { ja: boolean }) {
  const [config, setConfig] = useState<Config>();
  const [draft, setDraft] = useState<Record<string, { primary: string; fallback: string[] }>>({});
  const [models, setModels] = useState<Record<string, { provider: string; model: string }>>({});
  const [fallbackText, setFallbackText] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const label = (en: string, jp: string) => ja ? jp : en;
  const receive = (data: Config) => {
    setConfig(data);
    setDraft(Object.fromEntries(Object.entries(data.capabilities).map(([name, cap]) => [name, { primary: cap.primary, fallback: cap.fallback }])));
    setModels(Object.fromEntries(Object.entries(data.backends).map(([name, backend]) => [name, { provider: backend.provider, model: backend.model }])));
    setFallbackText(Object.fromEntries(Object.entries(data.capabilities).map(([name, cap]) => [name, cap.fallback.join(', ')])));
  };
  useEffect(() => { let mounted = true; fetch('/api/orchestrator/settings').then(async r => { const data = await r.json(); if (!r.ok) throw Error(data.error ?? `HTTP ${r.status}`); return data; }).then(d => { if (mounted) receive(d); }).catch(e => { if (mounted) setError((e as Error).message); }); return () => { mounted = false; }; }, []);
  const save = async (payload: object) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/orchestrator/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? `HTTP ${response.status}`);
      receive(data); setNotice(label('Saved. New runs use these settings.','保存しました。次のランから適用されます。'));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <><h3>{label('Orchestrator models & capabilities','オーケストレータのモデルと capability')}</h3>
    <p>{label('Set the model for each backend and choose which backends each capability tries. The orchestration capability controls the orchestrator planner model; the default rules planner does not call a model. Changes affect new runs only.','backend ごとのモデルと、各 capability が試す backend の順序を設定します。orchestration はモデルプランナーのモデルを制御します。標準のルールプランナーはモデルを呼びません。変更は次のランから適用されます。')}</p>
    <p>{label('Model bindings are saved outside the installed kit. Routes use the kit’s routing.local.json. Shared defaults and credentials are not changed. Provider/model must already be available to Pi.','モデルの割り当てはインストール済み kit の外に保存します。経路は kit の routing.local.json を使用します。共有設定や認証情報は変更しません。provider/model は Pi で利用可能である必要があります。')}</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!config && !error && <p>{label('Loading…','読み込み中…')}</p>}
    {config && <><p className="orchestrator-path">{label('Effective model source','有効なモデル設定元')}: <code>{config.modelSource}</code><br/>{label('Save path','保存先')}: <code>{config.modelSavePath}</code></p><h4>{label('Capability routes','capability の経路')}</h4>
      {Object.entries(config.capabilities).map(([name, cap]) => <div className="orchestrator-setting" key={name}><strong>{name} · {cap.status}</strong><small>{cap.description}</small><small>{label('Bound','割り当て済み')}: {cap.candidates.join(', ') || '—'} · {label('Placeholder','仮設定')}: {cap.placeholder.join(', ') || '—'} · {label('Unbound','未設定')}: {cap.unbound.join(', ') || '—'}</small>
        <label className="settings-row"><span>{label('First backend','最初の backend')}</span><select aria-label={`${name} primary backend`} value={draft[name]?.primary ?? cap.primary} disabled={busy} onChange={e => { const next = e.target.value; setDraft(old => ({ ...old, [name]: { ...old[name], primary: next } })); setFallbackText(old => ({ ...old, [name]: (old[name] ?? '').split(',').map(b => b.trim()).filter(b => b && b !== next).join(', ') })); }}>{Object.keys(config.backends).map(b => <option key={b} value={b}>{b} · {config.backends[b].provider || '—'} / {config.backends[b].model || '—'}</option>)}</select></label>
        <label className="settings-row"><span>{label('Fallback order (comma-separated)','代替順（カンマ区切り）')}</span><input aria-label={`${name} fallback backends`} value={fallbackText[name] ?? ''} disabled={busy} onChange={e => setFallbackText(old => ({ ...old, [name]: e.target.value }))}/></label>
        <button disabled={busy} onClick={() => void save({ kind: 'capability', name, primary: draft[name].primary, fallback: (fallbackText[name] ?? '').split(',').map(b => b.trim()).filter(Boolean) })}>{label('Save route','経路を保存')}</button></div>)}
      <h4>{label('Backend models','backend のモデル')}</h4>
      {Object.entries(config.backends).map(([name, backend]) => <div className="orchestrator-setting" key={name}><strong>{name}{backend.vision ? ' · vision' : ''} · {backend.status}</strong><small>{backend.description}</small>
        <label className="settings-row"><span>Provider</span><input aria-label={`${name} provider`} value={models[name]?.provider ?? ''} disabled={busy} onChange={e => setModels(old => ({ ...old, [name]: { ...old[name], provider: e.target.value } }))}/></label>
        <label className="settings-row"><span>Model ID</span><input aria-label={`${name} model`} value={models[name]?.model ?? ''} disabled={busy} onChange={e => setModels(old => ({ ...old, [name]: { ...old[name], model: e.target.value } }))}/></label>
        <button disabled={busy} onClick={() => void save({ kind: 'backend', name, ...models[name] })}>{label('Save model','モデルを保存')}</button></div>)}</>}
  </>;
}
