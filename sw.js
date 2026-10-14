/* PWA offline shell. Never cache Firestore/Auth REST data or financial API responses. */
const BASE=self.registration.scope;
const CACHE='finansy-firestore-shell-v6-payments-forced-'+new URL(BASE).pathname;
const PREFIX='finansy-firestore-shell-';
const SHELL=['./','./index.html','./manifest.webmanifest','./styles_payments_20261014.css','./app_payments_20261014.js','./firebase_bridge.js','./event_journal.js','./icon-192.png','./icon-512.png'].map(path=>new URL(path,BASE).href);
const FIREBASE_SDK='https://www.gstatic.com/firebasejs/13.0.0/';
self.addEventListener('install',ev=>ev.waitUntil(caches.open(CACHE).then(async cache=>{
 await cache.addAll(SHELL);
 await Promise.allSettled(['firebase-app.js','firebase-auth.js','firebase-firestore.js'].map(filename=>cache.add(FIREBASE_SDK+filename)));
 await self.skipWaiting();
})));
self.addEventListener('activate',ev=>ev.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',ev=>{
 const req=ev.request;if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.href.startsWith(FIREBASE_SDK)){
  ev.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(response=>{
   if(response.ok){const copy=response.clone();ev.waitUntil(caches.open(CACHE).then(c=>c.put(req,copy)));}
   return response;
  })));
  return;
 }
 if(!url.href.startsWith(BASE))return;
 if(req.mode==='navigate'){
  ev.respondWith(fetch(req).then(response=>{
   if(response.ok){const copy=response.clone();ev.waitUntil(caches.open(CACHE).then(c=>c.put(new URL('./index.html',BASE),copy)));}
   return response;
  }).catch(async()=>(await caches.match(new URL('./index.html',BASE)))||Response.error()));return;
 }
 ev.respondWith(fetch(req).then(response=>{
  if(response.ok){const copy=response.clone();ev.waitUntil(caches.open(CACHE).then(c=>c.put(req,copy)));}
  return response;
 }).catch(async()=>(await caches.match(req))||Response.error()));
});
