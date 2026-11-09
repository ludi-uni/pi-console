import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import './helpers/css-stub-register.mjs';
import { chromium } from '@playwright/test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultPreferences } from '../web/preferences.ts';

const root = new URL('..', import.meta.url);
const { default: SettingsPage } = await import('../web/SettingsPage.tsx');
const settings = renderToStaticMarkup(React.createElement(SettingsPage, {
  preferences: defaultPreferences, onChange: () => {}, onBack: () => {}, workspaceCount: 0, sessionCount: 0, connected: true,
}));
const inbox = (open: boolean) => `<aside class="activity-inbox"><details class="activity-inbox-details"${open ? ' open' : ''}><summary class="activity-inbox-heading">Active work</summary><div class="activity-inbox-list"><div class="activity-card">Notification</div></div></details></aside>`;
const settingsDocument = (css: string, notification: 'none' | 'closed' | 'open') => `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><main class="app-shell view-settings"><header class="app-header">Pi Console</header>${notification === 'none' ? '' : inbox(notification === 'open')}${settings.replace('</div></div></section>', '<div data-scroll-tail style="height:1200px">Settings tail</div></div></div></section>')}</main>`;
const shellDocument = (css: string, view: string, content: string) => `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><main class="app-shell ${view}"><header class="app-header">Pi Console</header>${inbox(false)}${content}</main>`;

test('desktop settings remain document-scrollable with activity notifications while other views retain the root clamp', { timeout: 30_000 }, async () => {
  const css = await readFile(new URL('web/style.css', root), 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    for (const notification of ['none', 'closed', 'open'] as const) {
      await page.setContent(settingsDocument(css, notification));
      const metrics = await page.evaluate(() => ({
        page: document.scrollingElement!.scrollHeight,
        viewport: document.scrollingElement!.clientHeight,
        shellOverflow: getComputedStyle(document.querySelector('.app-shell')!).overflowY,
      }));
      assert(metrics.page > metrics.viewport, `${notification} notification must leave settings reachable by document scroll`);
      assert.notEqual(metrics.shellOverflow, 'hidden', `${notification} notification must not clip settings at the shell`);
    }
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.setContent(settingsDocument(css, 'closed'));
    assert((await page.evaluate(() => document.scrollingElement!.scrollHeight > document.scrollingElement!.clientHeight)), 'short desktop settings must remain scrollable');
    await page.setContent(shellDocument(css, 'view-chat', '<div class="console-layout"><div class="content-pane"><section class="chat-panel"><div class="chat"><div style="height:1600px">Conversation</div></div><div class="composer-dock">Composer</div></section></div></div>'));
    const chat = await page.evaluate(() => {
      const shell = document.querySelector('.app-shell')!;
      const content = document.querySelector('.chat')!;
      return { shell: shell.clientHeight, viewport: innerHeight, scroll: content.scrollHeight, client: content.clientHeight, overflow: getComputedStyle(shell).overflowY };
    });
    assert.equal(chat.shell, chat.viewport, 'chat shell stays viewport-clamped');
    assert(chat.scroll > chat.client, 'chat content retains inner scrolling');
    assert.equal(chat.overflow, 'hidden', 'chat shell remains clipped to its viewport');
    await page.setContent(shellDocument(css, 'view-workspaces', '<div class="console-layout"></div>'));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.app-shell')!).overflowY), 'hidden', 'workspace view remains covered by the existing root clamp');
  } finally {
    await browser.close();
  }
});
