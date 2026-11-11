/* BTCUSDT local notification display worker (v202).
 * No background price monitoring or push sending is performed here.
 * A future external push sender is required for reliable screen-off alerts.
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
