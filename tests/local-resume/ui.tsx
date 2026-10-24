import React from'react';import{createRoot}from'react-dom/client';
import SettingsPage from'../../web/SettingsPage.tsx';import LocalResumeMcp from'../../web/LocalResumeMcp.tsx';import{defaultPreferences}from'../../web/preferences.ts';
import '../../web/style.css';import '../../web/local-owner.css';
createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/owner')?<main className="local-owner"><LocalResumeMcp available ownerExpiresAt={Date.now()+(location.pathname==='/owner-expired'?-1:location.pathname==='/owner-boundary'?2000:600000)}/></main>:<SettingsPage preferences={defaultPreferences} onChange={()=>{}} onBack={()=>{}} workspaceCount={0} sessionCount={0} connected/>);
