import React, { useEffect, useState } from 'react';
import type { SessionOptions } from '../shared/types.ts';

type Config = {
  modelSource: string;
  modelSavePath: string;
  capabilities: Record<string, { description: string; primary: string; fallback: string[]; status: string; candidates: string[]; placeholder: string[]; unbound: string[] }>;
  backends: Record<string, { description: string; vision: boolean; provider: string; model: string; thinking: string; status: string }>;
};
type AvailableModel = SessionOptions['models'][number];
function ModelPicker({ models, value, onSelect, ariaLabel, label, placeholder, disabled }: { models: AvailableModel[]; value: { provider: string; model: string }; onSelect: (model: AvailableModel) => void; ariaLabel: string; label: string; placeholder: string; disabled: boolean }) {
  const [query,setQuery]=useState('');const [provider,setProvider]=useState('*');
  const selected = models.find(m => m.provider === value.provider && m.id === value.model);
  const providers=[...new Set(models.map(m=>m.provider))];
  const matching=models.filter(m=>(provider==='*'||m.provider===provider)&&`${m.provider} ${m.name} ${m.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const shown=matching.slice(0,80);
  if(selected&&!shown.includes(selected))shown.unshift(selected);
  return <div className="orchestrator-model-picker"><label>{label}<select aria-label={ariaLabel} value={selected ? JSON.stringify([selected.provider, selected.id]) : ''} disabled={disabled} onChange={e => { const model = models.find(m => JSON.stringify([m.provider, m.id]) === e.target.value); if (model) onSelect(model); }}><option value="">{placeholder}</option>{shown.map(m => <option key={JSON.stringify([m.provider, m.id])} value={JSON.stringify([m.provider, m.id])}>{m.provider} / {m.name}{m.name !== m.id ? ` (${m.id})` : ''}</option>)}</select></label><div className="orchestrator-model-filters"><input aria-label={`${ariaLabel} search`} placeholder="Search name or ID" value={query} onChange={e=>setQuery(e.target.value)} disabled={disabled}/><select aria-label={`${ariaLabel} provider`} value={provider} onChange={e=>setProvider(e.target.value)} disabled={disabled}><option value="*">All providers</option>{providers.map(name=><option key={name} value={name}>{name}</option>)}</select></div><small>{matching.length>80?`First 80 of ${matching.length} models · refine search`:`${matching.length} matching models`}</small></div>;
}
export default function OrchestratorSettings({ ja, availableModels }: { ja: boolean; availableModels?: SessionOptions['models'] }) {
  const [config, setConfig] = useState<Config>();
  const [draft, setDraft] = useState<Record<string, { primary: string; fallback: string[] }>>({});
  const [models, setModels] = useState<Record<string, { provider: string; model: string }>>({});
  const [fallbackText, setFallbackText] = useState<Record<string, string>>({});
  const [quickChoices, setQuickChoices] = useState<Record<string, string>>({});
  const [starterBackend, setStarterBackend] = useState('');
  const [starterProvider, setStarterProvider] = useState('');
  const [starterModel, setStarterModel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const label = (en: string, jp: string) => ja ? jp : en;
  const receive = (data: Config) => {
    setConfig(data);
    setDraft(Object.fromEntries(Object.entries(data.capabilities).map(([name, cap]) => [name, { primary: cap.primary, fallback: cap.fallback }])));
    setModels(Object.fromEntries(Object.entries(data.backends).map(([name, backend]) => [name, { provider: backend.provider, model: backend.model }])));
    setFallbackText(Object.fromEntries(Object.entries(data.capabilities).map(([name, cap]) => [name, cap.fallback.join(', ')])));
    setQuickChoices(Object.fromEntries(Object.entries(data.capabilities).map(([name, cap]) => [name, cap.candidates[0] ?? ''])));
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
  const quickRoutes = [{ name: 'strong-code', en: 'Coding tasks', jp: 'コード作業' }, { name: 'orchestration', en: 'Model-based planning', jp: 'モデルによる計画' }];
  const bound = config ? Object.entries(config.backends).filter(([, backend]) => backend.status === 'bound') : [];
  return <><h3>{label('Orchestrator setup','オーケストレータの設定')}</h3>
    <p>{label('Choose a preferred model for common tasks. Existing fallback models stay available; changes apply to new runs only.','よく使う作業の優先モデルを選びます。既存の代替モデルは残り、変更は次のランから適用されます。')}</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!config && !error && <p>{label('Loading…','読み込み中…')}</p>}
    {config && <><div className="orchestrator-quick"><strong>{label('Quick setup','簡単設定')}</strong><div className="orchestrator-access" role="status"><span>{label('Configured routes','設定済み経路')}: {Object.values(config.capabilities).filter(cap => cap.status === 'bound').length}/{Object.keys(config.capabilities).length}</span><span>{label('Provider access: Not verified','プロバイダー接続: 未確認')}</span></div><small>{label('A configured model is not a connection test. The first run can still fail if provider access is unavailable.','モデルの設定だけでは接続確認になりません。プロバイダーに接続できない場合、初回のランは失敗することがあります。')}</small>
      {quickRoutes.filter(route => config.capabilities[route.name]).map(route => { const cap = config.capabilities[route.name]; const selected = quickChoices[route.name] ?? ''; const fallback = [cap.primary, ...cap.fallback].filter((name, index, all) => name !== selected && all.indexOf(name) === index); return <div className="orchestrator-quick-route" key={route.name}><label>{label(route.en, route.jp)}<select aria-label={`${route.name} preferred model`} value={selected} disabled={busy || !bound.length} onChange={e => setQuickChoices(old => ({ ...old, [route.name]: e.target.value }))}><option value="">{label('Choose a configured model','設定済みモデルを選択')}</option>{bound.map(([name, backend]) => <option key={name} value={name}>{backend.provider} / {backend.model} ({name})</option>)}</select></label><small>{label('Order after saving','保存後の順序')}: {selected ? [selected, ...fallback].join(' → ') : '—'}</small><button disabled={busy || !selected || selected === cap.primary} onClick={() => void save({ kind: 'capability', name: route.name, primary: selected, fallback })}>{label('Use this model','このモデルを優先')}</button>{route.name === 'orchestration' && <small>{label('Only used when the model planner is selected; the default rules planner does not call a planning model.','モデルプランナーを選択した場合だけ使用します。標準のルールプランナーは計画用モデルを呼びません。')}</small>}</div>; })}
      {!bound.length && <div className="orchestrator-quick-route"><strong>{label('Connect your first model','最初のモデルを設定')}</strong><small>{label('Use a provider and model ID already available to Pi. This does not change credentials or test model access.','Pi で利用できる provider とモデル ID を入力してください。認証情報は変更せず、接続テストも行いません。')}</small><label>{label('Backend to configure','設定する backend')}<select aria-label="Starter backend" disabled={busy} value={starterBackend || config.capabilities['strong-code']?.primary || Object.keys(config.backends)[0] || ''} onChange={e => setStarterBackend(e.target.value)}>{Object.keys(config.backends).map(name => <option key={name} value={name}>{name}</option>)}</select></label>{availableModels?.length ? <ModelPicker models={availableModels} value={{ provider: starterProvider, model: starterModel }} onSelect={m => { setStarterProvider(m.provider); setStarterModel(m.id); }} ariaLabel="Starter available Pi model" label={label('Available Pi models','Pi で利用可能なモデル')} placeholder={label('Choose a model…','モデルを選択…')} disabled={busy}/> : <small>{label('Open a Pi session to browse available models, or enter provider and model manually.','利用可能なモデルを選ぶには Pi セッションを開いてください。手入力もできます。')}</small>}<label>Provider<input aria-label="Starter provider" value={starterProvider} disabled={busy} onChange={e => setStarterProvider(e.target.value)}/></label><label>Model ID<input aria-label="Starter model" value={starterModel} disabled={busy} onChange={e => setStarterModel(e.target.value)}/></label><button disabled={busy || !starterProvider.trim() || !starterModel.trim()} onClick={() => void save({ kind: 'backend', name: starterBackend || config.capabilities['strong-code']?.primary || Object.keys(config.backends)[0], provider: starterProvider, model: starterModel })}>{label('Connect model','モデルを設定')}</button></div>}</div>
      <details className="orchestrator-advanced"><summary>{label('Advanced settings · all capabilities and backend models','詳細設定 · 全 capability と backend モデル')}</summary><p>{label('Set the model for each backend and choose which backends each capability tries. Changes affect new runs only.','backend ごとのモデルと、各 capability が試す backend の順序を設定します。変更は次のランから適用されます。')}</p><p>{label('Model bindings are saved outside the installed kit. Routes use the kit’s routing.local.json. Shared defaults and credentials are not changed. Provider/model must already be available to Pi.','モデルの割り当てはインストール済み kit の外に保存します。経路は kit の routing.local.json を使用します。共有設定や認証情報は変更しません。provider/model は Pi で利用可能である必要があります。')}</p><p className="orchestrator-path">{label('Effective model source','有効なモデル設定元')}: <code>{config.modelSource}</code><br/>{label('Save path','保存先')}: <code>{config.modelSavePath}</code></p><h4>{label('Capability routes','capability の経路')}</h4>
      {Object.entries(config.capabilities).map(([name, cap]) => <div className="orchestrator-setting" key={name}><strong>{name} · {cap.status}</strong><small>{cap.description}</small><small>{label('Bound','割り当て済み')}: {cap.candidates.join(', ') || '—'} · {label('Placeholder','仮設定')}: {cap.placeholder.join(', ') || '—'} · {label('Unbound','未設定')}: {cap.unbound.join(', ') || '—'}</small>
        <label className="settings-row"><span>{label('First backend','最初の backend')}</span><select aria-label={`${name} primary backend`} value={draft[name]?.primary ?? cap.primary} disabled={busy} onChange={e => { const next = e.target.value; setDraft(old => ({ ...old, [name]: { ...old[name], primary: next } })); setFallbackText(old => ({ ...old, [name]: (old[name] ?? '').split(',').map(b => b.trim()).filter(b => b && b !== next).join(', ') })); }}>{Object.keys(config.backends).map(b => <option key={b} value={b}>{b} · {config.backends[b].provider || '—'} / {config.backends[b].model || '—'}</option>)}</select></label>
        <label className="settings-row"><span>{label('Fallback order (comma-separated)','代替順（カンマ区切り）')}</span><input aria-label={`${name} fallback backends`} value={fallbackText[name] ?? ''} disabled={busy} onChange={e => setFallbackText(old => ({ ...old, [name]: e.target.value }))}/></label>
        <button disabled={busy} onClick={() => void save({ kind: 'capability', name, primary: draft[name].primary, fallback: (fallbackText[name] ?? '').split(',').map(b => b.trim()).filter(Boolean) })}>{label('Save route','経路を保存')}</button></div>)}
      <h4>{label('Backend models','backend のモデル')}</h4>{!availableModels?.length && <small>{label('Open a Pi session to browse available models; manual entry remains available.','利用可能なモデルを選ぶには Pi セッションを開いてください。手入力もできます。')}</small>}
      {Object.entries(config.backends).map(([name, backend]) => <div className="orchestrator-setting" key={name}><strong>{name}{backend.vision ? ' · vision' : ''} · {backend.status}</strong><small>{backend.description}</small>
        {availableModels?.length ? <ModelPicker models={availableModels} value={models[name] ?? { provider: '', model: '' }} onSelect={m => setModels(old => ({ ...old, [name]: { provider: m.provider, model: m.id } }))} ariaLabel={`${name} available Pi model`} label={label('Available Pi models','Pi で利用可能なモデル')} placeholder={label('Choose a model…','モデルを選択…')} disabled={busy}/> : null}
        <label className="settings-row"><span>Provider</span><input aria-label={`${name} provider`} value={models[name]?.provider ?? ''} disabled={busy} onChange={e => setModels(old => ({ ...old, [name]: { ...old[name], provider: e.target.value } }))}/></label>
        <label className="settings-row"><span>Model ID</span><input aria-label={`${name} model`} value={models[name]?.model ?? ''} disabled={busy} onChange={e => setModels(old => ({ ...old, [name]: { ...old[name], model: e.target.value } }))}/></label>
        <button disabled={busy} onClick={() => void save({ kind: 'backend', name, ...models[name] })}>{label('Save model','モデルを保存')}</button></div>)}</details></>}
  </>;
}
