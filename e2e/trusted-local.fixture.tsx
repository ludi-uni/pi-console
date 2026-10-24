import React from 'react';
import { createRoot } from 'react-dom/client';
import TrustedLocalMcp from '../web/TrustedLocalMcp.tsx';
import '../web/workspace-permissions.css';
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 760, boxSizing: 'border-box', margin: '24px auto', padding: 16, fontFamily: 'sans-serif', color: '#202735', background: '#f5f7fb' }}><TrustedLocalMcp ja={true}/></main>);
