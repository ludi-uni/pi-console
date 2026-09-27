const CACHE='pi-console-shell-v3';
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});const current=tabs.find(tab=>new URL(tab.url).origin===self.location.origin);if(current)await current.focus();else await self.clients.openWindow('/')})());});
self.addEventListener('install',event=>{event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(['/','/manifest.webmanifest','/icon-192.png','/icon-512.png','/icon-maskable.svg']);const html=await(await cache.match('/')).text();const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m=>m[1]);await cache.addAll(assets);await self.skipWaiting();})());});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()]));});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname==='/events')return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();void caches.open(CACHE).then(cache=>cache.put('/',copy));}return response}).catch(async()=>await caches.match('/')??Response.error()));return;
  }
  if(url.pathname.startsWith('/assets/')||['/manifest.webmanifest','/icon-192.png','/icon-512.png','/icon-maskable.svg'].includes(url.pathname))
    event.respondWith(caches.match(request).then(cached=>cached??fetch(request).then(response=>{if(response.ok){const copy=response.clone();void caches.open(CACHE).then(cache=>cache.put(request,copy));}return response})));
});
