/* BTCUSDT push notification worker (v204).
 * Remote Web Push triggers this worker even when no app window is running.
 * Server must be deployed separately; this worker never polls Binance.
 */
'use strict';
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=new URL('./',self.registration.scope).href;
 event.waitUntil((async()=>{
  const clientsList=await clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of clientsList){
   if(client.url.startsWith(self.registration.scope)){
    if('focus' in client)return client.focus();
   }
  }
  if(clients.openWindow)return clients.openWindow(url);
 })());
});

self.addEventListener('push',event=>{
 let data={};
 try{data=event.data?event.data.json():{}}catch(_){data={}}
 const title=typeof data.title==='string'?data.title:'🔔 BTCUSDT 신호';
 const opts={
  body:typeof data.body==='string'?data.body:'1분봉 RMI 확정 신호',
  tag:typeof data.tag==='string'?data.tag:'btc-rmi-alert',
  icon:'./push-icon.svg',
  badge:'./push-icon.svg',
  renotify:true,
  data:{url:new URL('./',self.registration.scope).href}
 };
 // Apple requires a visible notification for EVERY Web Push event.
 event.waitUntil(self.registration.showNotification(title,opts));
});
