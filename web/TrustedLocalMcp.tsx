import React, { useEffect, useRef, useState } from 'react';
import type { LocalOwnerReview, LocalOwnerView } from '../shared/trusted-local-mcp.ts';
export default function TrustedLocalMcp({ ja, apiPrefix = '/api/' }: {
    ja: boolean;
    apiPrefix?: string;
}) {
    const t = (en: string, jp: string) => ja ? jp : en;
    const [view, setView] = useState<LocalOwnerView>(), [review, setReview] = useState<LocalOwnerReview>(), [choice, setChoice] = useState(''), [minutes, setMinutes] = useState('15'), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState<string>();
    const alive = useRef(true), sequence = useRef(0), storage = 'pi-console-local-mcp-save-request';
    const request = async (route: string, body: unknown) => {
        const response = await fetch(apiPrefix + 'local-mcp/' + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pi-console-admin': '1' }, body: JSON.stringify(body) });
        const value = await response.json();
        if (!response.ok)
            throw Error(value.error ?? 'owner_unavailable');
        return value;
    };
    const run = async (work: () => Promise<void>) => {
        if (busy)
            return;
        const id = ++sequence.current;
        setBusy(true);
        setError('');
        try {
            await work();
        }
        catch {
            if (alive.current && id === sequence.current)
                setError(t('Disabled, unconfigured, or owner verification unavailable. Inspect the save result after an unknown outcome.', '無効・未設定・本人確認不可、または操作結果が不明です。保存結果を再読取してください。'));
        }
        finally {
            if (alive.current && id === sequence.current)
                setBusy(false);
        }
    };
    const refresh = () => run(async () => {
        const value = await request('status', {});
        if (alive.current) {
            setView(value);
            setReview(undefined);
            setConfirmed(false);
        }
    });
    useEffect(() => {
        alive.current = true;
        try {
            const id = sessionStorage.getItem(storage);
            if (id)
                setPending(id);
        }
        catch { }
        void refresh();
        return () => { alive.current = false; sequence.current++; };
    }, []);
    const inspect = (revoke: boolean) => run(async () => {
        if (!view || pending)
            return;
        const target = revoke ? null : view.choices[Number(choice)], n = Number(minutes);
        if (!revoke && (!target || !Number.isFinite(n) || n <= 0 || n > 1440))
            throw Error('invalid_review');
        const r = await request('review', { instance: view.instance, revision: view.revision, target, expiresAt: revoke ? null : Date.now() + n * 60000 });
        if (alive.current) {
            setReview(r);
            setConfirmed(false);
        }
    });
    const save = () => run(async () => {
        if (!review || !confirmed)
            return;
        setPending(review.requestId);
        try {
            sessionStorage.setItem(storage, review.requestId);
        }
        catch { }
        setReview(undefined);
        setConfirmed(false);
        const value = await request('save', { reviewId: review.reviewId, requestId: review.requestId, confirmed: true });
        if (alive.current) {
            setView(value);
            setPending(undefined);
        }
        try {
            sessionStorage.removeItem(storage);
        }
        catch { }
    });
    const result = () => run(async () => {
        if (!pending)
            return;
        const value = await request('result', { requestId: pending });
        if (value.state === 'unknown')
            throw Error('save_unconfirmed');
        if (alive.current) {
            setView(value.current);
            setPending(undefined);
            setReview(undefined);
            setConfirmed(false);
        }
        try {
            sessionStorage.removeItem(storage);
        }
        catch { }
    });
    return <section className="workspace-permissions" aria-label="Trusted local MCP"><h4>{t('Trusted local MCP', '信頼する Pi のローカル MCP')}</h4>
    <p>{t('Pi, SDK and extensions are trusted. OS isolation is unverified. Public UI routes never expose MCP. The dedicated loopback port must stay outside Tunnel routes.', 'Pi・SDK・拡張を信頼する運用です。OS 隔離成立は未検証です。公開 UI 側は MCP を公開しません。専用ローカルポートを Tunnel の転送先にしないでください。')}</p>
    <p>{t('Default OFF. Credential setup, listener activation and scope approval are separate. Keys are never entered here.', '既定 OFF。キー設定・入口の有効化・範囲の承認は別操作です。この画面でキーを入力しません。')}</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => void refresh()}>{t('Read local MCP status', 'ローカル MCP の状態を再読取')}</button>
    {view && <><p role="status">{view.status.reason} / {t('OS isolation unverified', 'OS 隔離未検証')}</p>
      <p>{view.grant?.active ? t('Active explicit control grant', '明示 control 許可が有効') : t('No active local control grant', '有効なローカル control 許可なし')}</p>
      <p>{t('The exact grant expiry must stay within the current credential expiry.','exact grant の期限は現在の credential 期限以内です。')} {view.status.credentialExpiresAt && new Date(view.status.credentialExpiresAt).toLocaleString()}</p>
      {view.grant && <p style={{ overflowWrap: 'anywhere' }}>{view.grant.target.workspaceId} / {view.grant.target.sessionId} / {new Date(view.grant.expiresAt).toLocaleString()}</p>}
      {!review && <><label>{t('Observed target', '観測済み対象')} <select aria-label="Local control target" style={{ maxWidth: '100%' }} value={choice} disabled={busy || !!pending || !view.status.enabled} onChange={e => { setChoice(e.target.value); setConfirmed(false); }}><option value="">{t('Select a target', '対象を選択')}</option>{view.choices.map((c, i) => <option key={i} value={i}>{c.workspaceId} / {c.sessionId} / {c.generation}</option>)}</select></label>
        <label>{t('Expiry in minutes', '期限（分）')} <input aria-label="Local grant minutes" type="number" min="1" max="1440" value={minutes} disabled={busy || !!pending} onChange={e => { setMinutes(e.target.value); setConfirmed(false); }}/></label>
        <button disabled={busy || !!pending || !view.status.enabled || choice === ''} onClick={() => void inspect(false)}>{t('Review local control', 'ローカル control を確認')}</button>
        <button disabled={busy || !!pending || !view.status.enabled || !view.grant} onClick={() => void inspect(true)}>{t('Review local revocation', 'ローカル許可の解除を確認')}</button></>}
      {review && <><h5>{t('Review exact local scope', 'ローカル対象範囲の確認')}</h5><p style={{ overflowWrap: 'anywhere' }}>{review.target ? `${review.target.workspaceId} / ${review.target.sessionId} / ${review.target.generation} / ${new Date(review.expiresAt!).toLocaleString()}` : t('Revoke local control grant', 'ローカル control 許可を解除')}</p>
        <p>{t('Control key holders can stage/start/stop the selected Pi session. This grants no final answer or history disclosure and does not prove OS isolation.', 'control キーを持つ主体が対象 Pi session の送信準備・開始・停止を行えます。最終回答・履歴の公開許可にはならず、OS 隔離も証明しません。')}</p>
        <label className="permission-choice"><input aria-label="Confirm local MCP scope" type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>{t('I confirm this target, expiry and operation.', '対象・期限・操作を本人として確認しました。')}</label>
        <button disabled={busy || !confirmed} onClick={() => void save()}>{t('Save reviewed local scope', '確認したローカル範囲を保存')}</button>
        <button disabled={busy} onClick={() => void run(async () => {
                    await request('cancel', { reviewId: review.reviewId, requestId: review.requestId });
                    if (alive.current) {
                        setReview(undefined);
                        setConfirmed(false);
                    }
                })}>{t('Cancel local review', 'ローカル確認をキャンセル')}</button></>}
    </>}
    {pending && <><p role="status">{t('Save outcome needs inspection. No automatic resend.', '保存結果の確認が必要です。自動再送はしません。')}</p><button disabled={busy} onClick={() => void result()}>{t('Read local save result', 'ローカル保存結果を再読取')}</button></>}
  </section>;
}
