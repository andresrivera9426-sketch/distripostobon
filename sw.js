const C="dp-v3",F=["./","index.html","styles.css","app.js","config.js","icon.svg","icon-192.png","manifest.webmanifest"];
const CDN=["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F).then(()=>c.addAll(CDN).catch(()=>{}))));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;const u=new URL(e.request.url);
 if(CDN.includes(u.href)||u.hostname==="cdn.sheetjs.com"){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(x=>{const cp=x.clone();caches.open(C).then(c=>c.put(e.request,cp));return x})));return}
 if(u.origin!==location.origin)return;
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp))}return r}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("index.html"))))});
self.addEventListener("notificationclick",e=>{e.notification.close();const url=e.notification.data?.url||"";e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{if(l[0]){l[0].focus();l[0].postMessage({url})}else clients.openWindow("./"+url)}))});
