import React from 'react';
import {createRoot} from 'react-dom/client';
import SettingsLocalMcp from '../web/SettingsLocalMcp.tsx';
import '../web/style.css';
document.title='DUMMY ONLY — トンネル設定（実入力・実接続なし）';
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1000,padding:20,margin:'auto'}}><h1>設定 — ダミー表示検証</h1><p>実 credential・native 画面・Tunnel・grant は起動しません。</p><SettingsLocalMcp/></main>);
