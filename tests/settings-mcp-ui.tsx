import React from 'react';
import { createRoot } from 'react-dom/client';
import SettingsPage from '../web/SettingsPage.tsx';
import { defaultPreferences } from '../web/preferences.ts';
import '../web/style.css';
document.title = 'DUMMY ONLY — Local MCP Settings';
createRoot(document.getElementById('root')!).render(<SettingsPage preferences={{...defaultPreferences,language:'ja'}} onChange={()=>{}} onBack={()=>{}} workspaceCount={0} sessionCount={0} connected={true}/>);
