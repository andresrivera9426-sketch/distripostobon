const C="dp-v2",F=["./","index.html","styles.css","app.js","config.js","icon.svg","icon-192.png","manifest.webmanifest"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET"||u.origin!==location.origin)return;
e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)))});
self.addEventListener("notificationclick",e=>{e.notification.close();const url=e.notification.data?.url||"";e.waitUntil(clients.matchAll({type:"window"}).then(l=>{if(l[0]){l[0].focus();l[0].postMessage({url});}else clients.openWindow("./"+url)}))});
