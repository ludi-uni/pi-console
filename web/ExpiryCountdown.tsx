import React, {useEffect, useState} from 'react';
import {expiryText} from '../package/connection-expiry.mjs';
export default function ExpiryCountdown({expiresAt}:{expiresAt:number|null}) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{setNow(Date.now());if(expiresAt===null)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[expiresAt]);
  return <span role="timer" aria-live="off">{expiryText(expiresAt,now)}</span>;
}
