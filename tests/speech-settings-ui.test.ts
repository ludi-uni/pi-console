// Static-render boundary tests for the speech.cpp settings surfaces.
// The normal Settings voice tab shows the terminal-free onboarding card; the
// owner-login command must stay inside the collapsed troubleshooting area and
// the public surface never exposes owner actions or paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// The default npm test command must work without an extra loader CLI flag —
// register the CSS stub BEFORE any component that imports its own stylesheet.
import './helpers/css-stub-register.mjs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { default: SpeechOnboarding } = await import('../web/SpeechOnboarding.tsx');
const { default: SettingsSpeech } = await import('../web/SettingsSpeech.tsx');
const { default: SettingsPage } = await import('../web/SettingsPage.tsx');
import { defaultPreferences } from '../web/preferences.ts';

const html = (props: Parameters<typeof SpeechOnboarding>[0]) => renderToStaticMarkup(React.createElement(SpeechOnboarding as React.ElementType, props));
const ownerHtml = (props: Parameters<typeof SettingsSpeech>[0]) => renderToStaticMarkup(React.createElement(SettingsSpeech as React.ElementType, props));
const page = () => renderToStaticMarkup(React.createElement(SettingsPage, { preferences: { ...defaultPreferences, language: 'ja' }, onChange: () => {}, onBack: () => {}, workspaceCount: 0, sessionCount: 0, connected: true }));

test('settings page exposes a voice section entry', () => {
  const s = page();
  assert(s.includes('音声入力'));
});

test('the voice tab renders the onboarding card, not the old redirect entry', async () => {
  const s = page();
  assert(s.includes('音声入力'));
  // The deprecated auto-redirect entry is gone from the normal tab.
  assert(!s.includes('Checking whether this device is the Console PC'));
  assert(!s.includes('この端末が Console PC か確認中'));
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../web/SettingsPage.tsx', import.meta.url), 'utf8');
  assert(!src.includes('SpeechSetupEntry'), 'normal tab must not mount the redirect entry');
});

test('onboarding card: primary CTA is one 準備する action; command stays in troubleshooting', () => {
  const s = html({ ja: true });
  assert(s.includes('準備する'));
  assert(s.includes('0.6B'));
  // Commands live ONLY inside the collapsed troubleshooting details.
  assert(s.includes('トラブルシューティング'));
  // No visible owner-login textarea in the default (collapsed) render path —
  // details content exists in markup but the primary flow is command-free.
  assert(!s.includes('/local-owner/voice'));
  assert(!s.includes('speech.exe のパス')); // advanced collapsed field names stay out of the main flow
});

test('capacity claim names the model size and never a fake total', () => {
  const s = html({ ja: true });
  assert(s.includes('0.6B'));
  // No fabricated total/percent/time figures.
  assert(!s.includes('%'));
});

test('owner panel still renders behind the owner prop (existing surface unchanged)', () => {
  const s = ownerHtml({ owner: true, ja: true });
  assert(s.includes('ローカル音声認識'));
  assert(s.includes('本人確認は10分'));
  const en = ownerHtml({ owner: true, ja: false });
  assert(en.includes('Local speech recognition'));
});

test('public owner API surface is unchanged: owner routes stay POST-bound to /local-owner/voice/*', async () => {
  const { readFile } = await import('node:fs/promises');
  const file = await readFile(new URL('../web/SettingsSpeech.tsx', import.meta.url), 'utf8');
  assert(file.includes("'/local-owner/voice/'"));
  assert(!file.includes("method:'GET'"));
  assert.equal([...file.matchAll(/fetch\(/g)].length, 2);
});
