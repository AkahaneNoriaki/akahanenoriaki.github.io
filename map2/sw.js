const CACHE='map2-tiles-v1';
const TILE_HOSTS=['cyberjapandata.gsi.go.jp','tile.geospatial.jp'];

self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(!TILE_HOSTS.some(h=>url.hostname===h)) return;
  e.respondWith(
    caches.open(CACHE).then(c=>
      c.match(e.request).then(r=>r||fetch(e.request).then(res=>{
        if(res.ok) c.put(e.request,res.clone());
        return res;
      }))
    ).catch(()=>caches.match(e.request))
  );
});
