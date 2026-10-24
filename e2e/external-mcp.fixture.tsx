import React from 'react';import {createRoot} from 'react-dom/client';
import ExternalMcp from '../web/ExternalMcp.tsx';import '../web/workspace-permissions.css';
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:900,margin:'auto',padding:16}}><section className="workspace-permissions"><ExternalMcp ja /></section></main>);
