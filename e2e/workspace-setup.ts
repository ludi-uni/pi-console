import type { Page } from '@playwright/test';

// Enter the same Add disclosure on desktop or the mobile workspace screen.
export async function openWorkspaceAdd(page: Page) {
  await page.locator('.workspace-add-shortcut:visible,.add-toggle:visible').click();
  await page.getByLabel('Workspace path').waitFor({ state: 'visible' });
}
