// Push-only service worker: never caches or controls paper orders.
self.addEventListener('push',event=>{
  let data={title:'BTCUSDT 신호',body:'새 진입 신호가 발생했어요.',url:'./'};
  try{if(event.data)data={...data,...event.data.json()}}catch{}
  event.waitUntil(self.registration.showNotification(data.title,{
    body:data.body,tag:'btc-'+(data.barTime||Date.now())+'-'+(data.side||'signal'),
    data:{url:data.url||'./'},icon:'./push-icon.svg',badge:'./push-icon.svg'
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL(event.notification.data?.url||'./',self.registration.scope).href;
    const clientsList=await clients.matchAll({type:'window',includeUncontrolled:true});
    const matching=clientsList.find(c=>c.url.startsWith(self.registration.scope));
    if(matching){await matching.focus();return}
    await clients.openWindow(url);
  })());
});
