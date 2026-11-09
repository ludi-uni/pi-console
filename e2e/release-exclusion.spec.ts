import { test, expect } from '@playwright/test';

// Release UI only: all API calls are mocked; no owner approval or model calls.
test.use({ serviceWorkers: 'block' });
for (const width of [390, 1280]) {
  test(`connection features are absent from settings at width ${width}`, async ({ page }) => {
    const mcpRequests: string[] = [];
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem('pi-console:preferences:v1', JSON.stringify({ language: 'en' }));
      (window as any).EventSource = class { addEventListener() {} close() {} };
    });
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (/mcp|workspace-permissions|dots/i.test(path)) mcpRequests.push(path);
      let json: unknown = {};
      if (path === '/api/workspaces') json = { workspaces: [] };
      else if (path === '/api/activity' || path === '/api/sessions') json = { sessions: [] };
      else if (path === '/api/pets') json = { pets: [] };
      else if (path === '/api/quick-prompts') json = { prompts: [] };
      else if (path === '/api/session-retention') json = { enabled: false, days: 30 };
      else if (path === '/api/startup') json = { supported: false, enabled: false, installed: false };
      await route.fulfill({ json });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open settings' }).click();
    const settings = page.getByRole('region', { name: 'Settings', exact: true });
    await expect(settings).toBeVisible();
    const sections = settings.getByRole('navigation', { name: 'Settings sections' });
    await expect(sections.getByRole('button', { name: /Local MCP|Dots|ローカル MCP/ })).toHaveCount(0);
    await expect(sections.getByRole('button', { name: /Remote connections/ })).toBeVisible();
    await expect(sections.getByRole('button', { name: /Voice input/ })).toBeVisible();
    await expect(sections.getByRole('button', { name: /Sessions/ })).toBeVisible();
    await expect(sections.getByRole('button', { name: /Orchestrator/ })).toBeVisible();
    expect(mcpRequests).toEqual([]);
  });
}
