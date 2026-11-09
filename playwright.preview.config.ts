import {defineConfig} from '@playwright/test';
import base from './playwright.config.ts';

// Isolated test Console; never attaches to the running user instance.
export default defineConfig({
 ...base,
 testMatch:['html-preview.spec.ts','html-preview-live.spec.ts','html-preview-assets.spec.ts'],
 timeout:30000,
 outputDir:'test-results/html-preview',
 use:{...base.use,channel:undefined,serviceWorkers:'block'},
 projects:[
  {name:'chrome',use:{browserName:'chromium',channel:'chrome'}},
  {name:'firefox',use:{browserName:'firefox'}},
  {name:'webkit',use:{browserName:'webkit'}},
 ],
});
