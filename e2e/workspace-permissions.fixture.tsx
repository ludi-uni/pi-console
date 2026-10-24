import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SettingsPage from '../web/SettingsPage.tsx';
import { defaultPreferences } from '../web/preferences.ts';
import '../web/style.css';
function Fixture(){const [open,setOpen]=useState(true),[preferences,setPreferences]=useState(defaultPreferences);return open?<SettingsPage preferences={preferences} onChange={setPreferences} onBack={()=>setOpen(false)} workspaceCount={2} sessionCount={2} connected={true}/>:<button onClick={()=>setOpen(true)}>Open settings</button>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
