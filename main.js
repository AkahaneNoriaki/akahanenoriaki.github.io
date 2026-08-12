/* =========================
   Service Worker
========================= */
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW:',e));
}

/* =========================
   util
========================= */
function toast(msg, ms=2000){
  const t=document.getElementById('toast');
  t.textContent=msg; t.style.display='block';
  clearTimeout(t._t);
  t._t=setTimeout(()=>t.style.display='none', ms);
}
const _lb=document.getElementById('lightbox');
const _lbImg=document.getElementById('lightboxImg');
window.openPhoto=src=>{ _lbImg.src=src; _lb.style.display='flex'; };
_lb.onclick=()=>{ _lb.style.display='none'; _lbImg.src=''; };

function showConfirm(msg){
  return new Promise(resolve=>{
    const ov=document.getElementById('confirmOverlay');
    document.getElementById('confirmMsg').textContent=msg;
    ov.style.display='flex';
    const ok=document.getElementById('confirmOk');
    const cancel=document.getElementById('confirmCancel');
    const done=result=>{ ov.style.display='none'; ok.onclick=null; cancel.onclick=null; resolve(result); };
    ok.onclick=()=>done(true);
    cancel.onclick=()=>done(false);
  });
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function propsToHtml(props){
  if(!props) return '属性なし';
  const keys=Object.keys(props); if(!keys.length) return '属性なし';
  return keys.slice(0,40).map(k=>`<div><b>${escapeHtml(k)}</b>: ${escapeHtml(props[k]==null?'':String(props[k]))}</div>`).join('');
}

/* =========================
   PC / スマホ判定
========================= */
function isPC(){ return window.innerWidth>=768; }

/* =========================
   PC サイドバー左右切替
========================= */
let sidebarSide=localStorage.getItem('sidebarSide')||'left';

function applySidebarSide(){
  const right=sidebarSide==='right';
  document.body.classList.toggle('sidebar-right', right);
  if(typeof zoomCtrl!=='undefined') zoomCtrl.setPosition(right?'topleft':'topright');
  const btn=document.getElementById('btnSideSwitch');
  if(btn) btn.title=right?'サイドバーを左へ':'サイドバーを右へ';
}

document.getElementById('btnSideSwitch').onclick=()=>{
  sidebarSide=sidebarSide==='left'?'right':'left';
  localStorage.setItem('sidebarSide',sidebarSide);
  applySidebarSide();
  map.invalidateSize();
};

function applyLayout(){
  document.getElementById('sideHeader').style.display=isPC()?'flex':'none';
  if(isPC()) applySidebarSide();
  else document.body.classList.remove('sidebar-right');
  map.invalidateSize();
}
window.addEventListener('resize', applyLayout);

/* =========================
   Bottom Sheet / Sidebar
========================= */
const sheet=document.getElementById('bottomSheet');
let sheetOpen=false, measuring='';
function openSheet(){ if(isPC()) return; sheetOpen=true; sheet.classList.add('open'); }
function closeSheet(){ if(isPC()) return; sheetOpen=false; sheet.classList.remove('open'); }
document.getElementById('sheetHandle').addEventListener('click',()=>sheetOpen?closeSheet():openSheet());
document.getElementById('map').addEventListener('click',()=>{ if(measuring||sharing) return; if(sheetOpen) closeSheet(); });

/* =========================
   Map
========================= */
const map=L.map('map',{maxZoom:25,zoomControl:false}).setView([36.2,138.0],12);
map.createPane('segyohanPane').style.zIndex='410';
map.createPane('shohanPane').style.zIndex='420';
map.createPane('rinpanPane').style.zIndex='430';
const zoomCtrl=L.control.zoom({position:'topright'}).addTo(map);
const gsiStd=L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
  {maxNativeZoom:18,maxZoom:25,attribution:'© 地理院'});
const gsiPhoto=L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
  {maxNativeZoom:18,maxZoom:25,attribution:'© 地理院（航空写真）'});
const csLayer=L.tileLayer('https://tile.geospatial.jp/CS/VER2/{z}/{x}/{y}.png',
  {opacity:1.0,minZoom:8,maxNativeZoom:18,maxZoom:25,attribution:'© 長野県 CS立体図'});

let bgMode='cs';
const csSliderRow=document.getElementById('csSliderRow');
const csOpacity=document.getElementById('csOpacity');
csOpacity.addEventListener('input',()=>csLayer.setOpacity(csOpacity.value/100));

function applyBG(){
  map.removeLayer(gsiStd); map.removeLayer(gsiPhoto); map.removeLayer(csLayer);
  if(bgMode==='map'){ gsiStd.addTo(map); csSliderRow.style.display='none'; }
  if(bgMode==='photo'){ gsiPhoto.addTo(map); csSliderRow.style.display='none'; }
  if(bgMode==='cs'){ gsiStd.addTo(map); csLayer.addTo(map); csSliderRow.style.display='block'; }
}
document.getElementById('btnBG').onclick=()=>{
  bgMode=bgMode==='cs'?'photo':bgMode==='photo'?'map':'cs';
  applyBG();
  toast(bgMode==='cs'?'背景：CS立体図':bgMode==='photo'?'背景：航空写真':'背景：地理院');
  closeSheet();
};
applyBG();

/* =========================
   CRS コントロール
========================= */
const CrsControl=L.Control.extend({
  options:{position:'bottomleft'},
  onAdd(){
    const div=L.DomUtil.create('div','leaflet-control-crs');
    div.title='地図タイルのCRS（GeoTIFF作成時に使用）\n座標表示: WGS84 (EPSG:4326)';
    div.innerHTML='🌐 EPSG:3857<br><span style="font-size:9px;color:#666">Web Mercator</span>';
    L.DomEvent.disableClickPropagation(div);
    return div;
  }
});
new CrsControl().addTo(map);

/* =========================
   Location + Follow
========================= */
let follow=false, me=null, _gpsInitDone=false;
if(navigator.geolocation){
  navigator.geolocation.watchPosition(
    pos=>{
      const ll=[pos.coords.latitude,pos.coords.longitude];
      if(!me){
        me=L.circleMarker(ll,{radius:8,color:'#0066ff',fillColor:'#3399ff',fillOpacity:0.9}).addTo(map);
      } else {
        me.setLatLng(ll);
      }
      if(!_gpsInitDone){
        // 初回のみ現在位置へ移動（追従はOFFのまま）
        _gpsInitDone=true;
        map.setView(ll,16,{animate:false});
      } else if(follow){
        _panToFollow(ll);
      }
      if(recording) addTrackPoint(pos.coords.latitude,pos.coords.longitude);
    },
    err=>toast('現在地エラー: '+err.message,2500),
    {enableHighAccuracy:true,maximumAge:0,timeout:15000}
  );
} else { toast('位置情報に対応していません'); }

const btnFollow=document.getElementById('btnFollow');

// プログラム的なpanTo後の誤dragstart検知を防ぐタイムスタンプ
let _lastProgrammaticPan=0;
function _panToFollow(ll){
  _lastProgrammaticPan=Date.now();
  map.panTo(ll,{animate:false});
}

// ユーザーのドラッグ操作で追従を自動解除（プログラム移動直後は無視）
map.on('dragstart',()=>{
  if(Date.now()-_lastProgrammaticPan<300) return;
  if(follow){
    follow=false;
    btnFollow.innerHTML='<span class="ico">🚶</span>追従 OFF';
    btnFollow.classList.add('on');
  }
});

btnFollow.onclick=()=>{
  follow=!follow;
  if(follow&&me) _panToFollow(me.getLatLng());
  btnFollow.innerHTML=`<span class="ico">${follow?'🧍':'🚶'}</span>追従 ${follow?'ON':'OFF'}`;
  btnFollow.classList.toggle('on',!follow);
  toast(follow?'自分を中央 ON':'自分を中央 OFF');
  closeSheet();
};

/* =========================
   Share
========================= */
let sharing=false;
const shareBadge=document.getElementById('shareBadge');
let _shareLL=null;

window._copyShareUrl=()=>{
  if(!_shareLL) return;
  const url=`${location.origin}${location.pathname}?lat=${_shareLL.lat.toFixed(6)}&lng=${_shareLL.lng.toFixed(6)}&z=${map.getZoom()}`;
  navigator.clipboard.writeText(url).then(()=>toast('URLをコピーしました')).catch(()=>prompt('URLをコピーしてください',url));
};
window._webShare=()=>{
  if(!_shareLL) return;
  const url=`${location.origin}${location.pathname}?lat=${_shareLL.lat.toFixed(6)}&lng=${_shareLL.lng.toFixed(6)}&z=${map.getZoom()}`;
  navigator.share({title:'現場確認マップ',url}).catch(()=>{});
};

/* =========================
   住所検索（アドレス・ベース・レジストリ）
========================= */
let searchMarker=null;
const addrRow=document.getElementById('addrSearchRow');

document.getElementById('btnAddrBtn').onclick=()=>{
  const open=addrRow.style.display==='flex';
  addrRow.style.display=open?'none':'flex';
  if(!open) setTimeout(()=>document.getElementById('addrInput').focus(),50);
};

async function searchAddr(){
  const q=document.getElementById('addrInput').value.trim();
  if(!q) return;
  toast('住所を検索中...',5000);
  try{
    const res=await rpFetch(`https://api.qchizu.jp/geocode.php?address=${encodeURIComponent(q)}`);
    const data=await res.json();
    if(!data.results||!data.results.length){ toast('住所が見つかりませんでした',3000); return; }
    const r=data.results[0].result;
    const lat=r.lat, lng=r.lon;
    const addrStr=r.output||q;
    const qlink=data.results[0].links?.qchizu_map||'https://qchizu.jp/';
    map.setView([lat,lng],15);
    if(searchMarker) map.removeLayer(searchMarker);
    searchMarker=L.marker([lat,lng],{
      icon:L.divIcon({html:'<div style="font-size:28px;margin:-28px 0 0 -14px">📍</div>',iconSize:[28,28],className:''})
    }).addTo(map)
      .bindPopup(`<div style="font-size:12px;font-weight:bold">${addrStr}</div><div style="font-size:11px;margin-top:4px"><a href="${qlink}" target="_blank" rel="noopener">全国Q地図で開く</a></div>`)
      .openPopup();
    document.getElementById('btnAddrClear').style.display='block';
    toast('住所が見つかりました',2000);
    addrRow.style.display='none';
    document.getElementById('addrInput').value='';
    closeSheet();
  }catch(e){ toast('検索に失敗しました',3000); console.error(e); }
}
document.getElementById('btnAddrSearch').onclick=searchAddr;
document.getElementById('addrInput').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.isComposing) searchAddr(); });
document.getElementById('btnAddrClear').onclick=()=>{
  if(searchMarker){ map.removeLayer(searchMarker); searchMarker=null; }
  map.closePopup();
  document.getElementById('btnAddrClear').style.display='none';
  addrRow.style.display='none';
  toast('ピンを削除しました');
  closeSheet();
};

document.getElementById('btnShare').onclick=()=>{
  sharing=!sharing;
  document.getElementById('btnShare').classList.toggle('on',sharing);
  if(sharing){
    shareBadge.style.display='block';
    closeSheet();
    toast('共有したい場所をタップ',3000);
  } else {
    shareBadge.style.display='none';
    map.closePopup();
  }
};

/* =========================
   Camera
========================= */
const cameraInput=document.getElementById('cameraInput');
const photoLayer=L.layerGroup().addTo(map);
document.getElementById('btnCamera').onclick=()=>{ cameraInput.value=''; cameraInput.click(); closeSheet(); };

function decToDmsRational(deg){
  const d=Math.floor(deg);
  const mFull=(deg-d)*60, m=Math.floor(mFull);
  const s=Math.round((mFull-m)*60*1000000);
  return [[d,1],[m,1],[s,1000000]];
}

const _photoBlobs={};
window.savePhoto=async key=>{
  const data=_photoBlobs[key]; if(!data){ toast('写真データがありません'); return; }
  const url=URL.createObjectURL(data.blob);
  const a=document.createElement('a'); a.href=url; a.download=data.name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

cameraInput.addEventListener('change',()=>{
  const file=cameraInput.files&&cameraInput.files[0]; if(!file) return;
  if(!me){ toast('現在地が未取得です',2500); return; }
  const ll=me.getLatLng();
  const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const fn=`photo_${ll.lat.toFixed(6)}_${ll.lng.toFixed(6)}_${ts}.jpg`;
  const imgURL=URL.createObjectURL(file);
  const key=Date.now();

  const reader=new FileReader();
  reader.onload=e=>{
    let blob=file;
    try{
      const exifObj=piexif.load(e.target.result);
      if(!exifObj['GPS']) exifObj['GPS']={};
      const lat=ll.lat, lng=ll.lng;
      exifObj['GPS'][piexif.GPSIFD.GPSLatitudeRef]=lat>=0?'N':'S';
      exifObj['GPS'][piexif.GPSIFD.GPSLatitude]=decToDmsRational(Math.abs(lat));
      exifObj['GPS'][piexif.GPSIFD.GPSLongitudeRef]=lng>=0?'E':'W';
      exifObj['GPS'][piexif.GPSIFD.GPSLongitude]=decToDmsRational(Math.abs(lng));
      const modified=piexif.insert(piexif.dump(exifObj),e.target.result);
      const arr=modified.split(','), bstr=atob(arr[1]);
      const u8=new Uint8Array(bstr.length);
      for(let i=0;i<bstr.length;i++) u8[i]=bstr.charCodeAt(i);
      blob=new Blob([u8],{type:'image/jpeg'});
    }catch(err){ console.warn('EXIF write failed:',err); }
    _photoBlobs[key]={blob,name:fn};

    L.marker(ll).addTo(photoLayer).bindPopup(`
      <div style="text-align:center">
        <img src="${imgURL}" class="photo-thumb" onclick="openPhoto('${imgURL}')"><br>
        <div style="font-size:12px;margin-top:4px;">${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}</div>
        <button onclick="savePhoto(${key})" style="margin-top:6px;padding:8px 16px;background:#0066ff;color:white;border-radius:8px;font-size:13px;border:none;cursor:pointer;">💾 ダウンロード</button>
      </div>`).openPopup();
    map.setView(ll,Math.max(map.getZoom(),16));
    toast('ピンを追加しました',2000);
  };
  reader.readAsDataURL(file);
});

/* =========================
   写真読込（ジオタグ→ピン）
========================= */
const photoLoadInput=document.getElementById('photoLoadInput');
let loadedPhotoMarkers=[];

function dmsToDecimal(dms,ref){
  const [d,m,s]=dms;
  const dec=d[0]/d[1]+m[0]/m[1]/60+s[0]/s[1]/3600;
  return (ref==='S'||ref==='W')?-dec:dec;
}

document.getElementById('btnLoadPhotos').onclick=()=>{ photoLoadInput.value=''; photoLoadInput.click(); closeSheet(); };

photoLoadInput.addEventListener('change',async()=>{
  const files=[...photoLoadInput.files]; if(!files.length) return;
  let added=0, skipped=0;
  for(const file of files){
    await new Promise(resolve=>{
      const reader=new FileReader();
      reader.onload=e=>{
        try{
          const exif=piexif.load(e.target.result);
          const gps=exif['GPS'];
          if(!gps||!gps[piexif.GPSIFD.GPSLatitude]){ skipped++; resolve(); return; }
          const lat=dmsToDecimal(gps[piexif.GPSIFD.GPSLatitude],gps[piexif.GPSIFD.GPSLatitudeRef]);
          const lng=dmsToDecimal(gps[piexif.GPSIFD.GPSLongitude],gps[piexif.GPSIFD.GPSLongitudeRef]);
          const imgURL=URL.createObjectURL(file);
          const marker=L.marker([lat,lng],{
            icon:L.divIcon({html:'<div style="font-size:22px;margin:-22px 0 0 -11px">🖼️</div>',iconSize:[22,22],className:''})
          }).addTo(map).bindPopup(`
            <div style="text-align:center">
              <img src="${imgURL}" class="photo-thumb" onclick="openPhoto('${imgURL}')"><br>
              <div style="font-size:11px;margin-top:4px;color:#666">${file.name}</div>
              <div style="font-size:11px;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
            </div>`);
          loadedPhotoMarkers.push(marker);
          added++;
        }catch(err){ skipped++; }
        resolve();
      };
      reader.readAsDataURL(file);
    });
  }
  if(loadedPhotoMarkers.length>0) document.getElementById('btnClearPhotos').style.display='block';
  if(added>0&&loadedPhotoMarkers.length>0){
    const group=L.featureGroup(loadedPhotoMarkers);
    map.fitBounds(group.getBounds(),{padding:[40,40]});
  }
  const msg=skipped>0?`${added}枚表示（${skipped}枚は位置情報なし）`:`${added}枚を地図に表示しました`;
  toast(msg,3000);
});

document.getElementById('btnClearPhotos').onclick=()=>{
  loadedPhotoMarkers.forEach(m=>map.removeLayer(m));
  loadedPhotoMarkers=[];
  document.getElementById('btnClearPhotos').style.display='none';
  toast('写真ピンをクリアしました'); closeSheet();
};

/* =========================
   軌跡記録
========================= */
// trackSegments: セグメントの配列。各セグメントは点の配列。
// 記録開始→停止のたびに新セグメントを追加し、停止中は繋がない。
let recording=false, trackSegments=[], trackLines=[];
const recBadge=document.getElementById('recBadge');

function _trackHasPoints(){ return trackSegments.some(s=>s.length>0); }

function updateTrackUI(){
  const has=_trackHasPoints();
  const btn=document.getElementById('btnRecord');
  if(recording){
    btn.innerHTML='<span class="ico">⏹️</span>記録停止';
    btn.classList.add('on'); recBadge.style.display='block';
  } else {
    btn.innerHTML='<span class="ico">🔴</span>記録開始';
    btn.classList.remove('on'); recBadge.style.display='none';
  }
  document.getElementById('btnExportTrack').style.display=has?'':'none';
  document.getElementById('btnClearTrack').style.display=has?'':'none';
}
function addTrackPoint(lat,lng){
  if(!trackSegments.length) return;
  const seg=trackSegments[trackSegments.length-1];
  seg.push({lat,lng,time:new Date().toISOString()});
  // 最後のセグメントのpolylineを更新
  const ll=seg.map(p=>[p.lat,p.lng]);
  const line=trackLines[trackLines.length-1];
  if(ll.length===1){ line.setLatLngs(ll); }
  else { line.setLatLngs(ll); }
}
document.getElementById('btnRecord').onclick=()=>{
  recording=!recording;
  if(recording){
    // 新セグメント開始
    trackSegments.push([]);
    const line=L.polyline([],{color:'#ff6600',weight:4,opacity:0.85}).addTo(map);
    trackLines.push(line);
    if(me) addTrackPoint(me.getLatLng().lat,me.getLatLng().lng);
    // 記録開始時に自動で追従ON
    follow=true;
    btnFollow.innerHTML='<span class="ico">🧍</span>追従 ON';
    btnFollow.classList.remove('on');
    if(me) _panToFollow(me.getLatLng());
  }
  toast(recording?'軌跡記録を開始しました（追従ON）':'軌跡記録を停止しました',2000);
  updateTrackUI(); closeSheet();
};
document.getElementById('btnExportTrack').onclick=()=>{
  if(!_trackHasPoints()){ toast('軌跡データがありません'); return; }
  const segs=trackSegments.filter(s=>s.length>0).map(s=>{
    const pts=s.map(p=>`      <trkpt lat="${p.lat}" lon="${p.lng}"><time>${p.time}</time></trkpt>`).join('\n');
    return `    <trkseg>\n${pts}\n    </trkseg>`;
  }).join('\n');
  const gpx=`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CS立体図マップ" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Track ${new Date().toLocaleString('ja-JP')}</name>
${segs}
  </trk>
</gpx>`;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([gpx],{type:'application/gpx+xml'}));
  a.download=`track_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.gpx`;
  a.click();
  toast('GPXをダウンロードしました',2000); closeSheet();
};
document.getElementById('btnClearTrack').onclick=()=>{
  trackSegments=[]; trackLines.forEach(l=>map.removeLayer(l)); trackLines=[];
  updateTrackUI(); toast('軌跡をクリアしました'); closeSheet();
};
updateTrackUI();

/* =========================
   ベクタレイヤー共通（GeoJSON / GPKG）
========================= */
const gjGroup=L.featureGroup().addTo(map);

function geoJsonPts(coords){ return coords.map(c=>({lat:c[1],lng:c[0]})); }

function calcGeomMeasure(geom){
  if(!geom) return null;
  switch(geom.type){
    case 'Polygon':
      return {ico:'📐', val:fmtArea(sphericalArea(geoJsonPts(geom.coordinates[0])))};
    case 'MultiPolygon':{
      const a=geom.coordinates.reduce((s,poly)=>s+sphericalArea(geoJsonPts(poly[0])),0);
      return {ico:'📐', val:fmtArea(a)};
    }
    case 'LineString':
      return {ico:'📏', val:fmtDist(totalDist(geoJsonPts(geom.coordinates)))};
    case 'MultiLineString':{
      const d=geom.coordinates.reduce((s,line)=>s+totalDist(geoJsonPts(line)),0);
      return {ico:'📏', val:fmtDist(d)};
    }
    default: return null;
  }
}

function makeVectorLayer(geojson){
  return L.geoJSON(geojson,{
    style:()=>({color:'#ff0066',weight:2,fillOpacity:0.2}),
    onEachFeature:(ft,l)=>l.on('click',e=>{
      const m=calcGeomMeasure(ft.geometry);
      const mHtml=m
        ?`<div style="margin-bottom:6px;padding:5px 10px;background:#eef4ff;border-radius:7px;font-size:14px;font-weight:bold;color:#0044cc;text-align:center">${m.ico} ${m.val}</div>`
        :'';
      L.popup({maxWidth:360,autoPan:true}).setLatLng(e.latlng).setContent(mHtml+propsToHtml(ft.properties)).openOn(map);
    })
  });
}

document.getElementById('btnJumpVector').onclick=()=>{
  if(!gjGroup.getLayers().length){ toast('データなし'); return; }
  map.fitBounds(gjGroup.getBounds().pad(0.1)); closeSheet();
};
document.getElementById('btnClearVector').onclick=()=>{
  gjGroup.clearLayers(); map.closePopup(); toast('ベクタデータをクリア'); closeSheet();
};

/* --- ポリゴン面積重心 --- */
function _polygonCentroid(ring){
  let area=0,cx=0,cy=0;
  const n=(ring[0].x===ring[ring.length-1].x&&ring[0].y===ring[ring.length-1].y)?ring.length-1:ring.length;
  for(let i=0,j=n-1;i<n;j=i++){
    const cross=ring[j].x*ring[i].y-ring[i].x*ring[j].y;
    area+=cross; cx+=(ring[j].x+ring[i].x)*cross; cy+=(ring[j].y+ring[i].y)*cross;
  }
  area/=2;
  if(Math.abs(area)<1e-10){
    let sx=0,sy=0; for(let i=0;i<n;i++){sx+=ring[i].x;sy+=ring[i].y;} return{x:sx/n,y:sy/n};
  }
  return{x:cx/(6*area),y:cy/(6*area)};
}

/* --- 市町村選択 --- */
let _currentMuni='tatsuno';
const _muniSel=document.getElementById('muniSel');

fetch('data/municipalities.json')
  .then(r=>r.json())
  .then(list=>{
    _muniSel.innerHTML=list.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
    _muniSel.value=_currentMuni;
  })
  .catch(()=>{ _muniSel.innerHTML=`<option value="tatsuno">辰野町</option>`; });

_muniSel.onchange=()=>{
  _currentMuni=_muniSel.value;
  // 全レイヤをリセット
  [
    [_rinpanOn,  ()=>{ map.removeLayer(_rinpanLayer);   _rinpanLayer=null;   _rinpanOn=false;   _rinpanBtn.classList.remove('active'); }],
    [_shohanOn,  ()=>{ map.removeLayer(_shohanLayer);   _shohanLayer=null;   _shohanOn=false;   _shohanBtn.classList.remove('active'); }],
    [_segyohanOn,()=>{ map.removeLayer(_segyohanLayer); _segyohanLayer=null; _segyohanOn=false; _segyohanBtn.classList.remove('active'); _btnToggleFilter.classList.remove('hi'); }],
  ].forEach(([on,fn])=>{ if(on) fn(); });
  // Excel連携もリセット
  if(_xlsxJoinMap){
    _xlsxRows=[]; _xlsxJoinMap=null;
    btnExcelLink.classList.remove('active');
    btnExcelClear.style.display='none';
    document.getElementById('xlsxStatCard').style.display='none';
  }
  toast(`${_muniSel.options[_muniSel.selectedIndex].text}に切り替えました`);
};

function _muniUrl(layer){ return `data/${_currentMuni}_${layer}.pmtiles`; }

/* --- 連携可能レイヤ: 林班 PMTiles --- */
let _rinpanLayer=null;
let _rinpanOn=false;
const _rinpanBtn=document.getElementById('btnToggleRinpan');

function _buildRinpanLayer(){
  const paintRules=[
    {
      dataLayer:'rinpan',
      symbolizer: new protomapsL.PolygonSymbolizer({
        fill: 'rgba(0,0,0,0)',
        stroke: '#2e7d32',
        width: 2.0
      })
    }
  ];
  if(_xlsxJoinMap&&_xlsxTargetLayer==='rinpan'){
    paintRules.unshift({
      dataLayer:'rinpan',
      filter:(zoom,feat)=>_xlsxJoinMap.has(String(feat.props[_xlsxKeyPmtField]??'').trim()),
      symbolizer: new protomapsL.PolygonSymbolizer({fill:'rgba(255,220,0,0.55)',stroke:'#f9a825',width:2})
    });
  }
  return protomapsL.leafletLayer({
    url: _muniUrl('rinpan'),
    pane:'rinpanPane',
    paintRules,
    labelRules:[
      {
        dataLayer:'rinpan',
        minzoom:10,
        symbolizer:(()=>{
          const _inner=new protomapsL.CenteredTextSymbolizer({
            labelProps:['_R'],
            font:'bold 14px sans-serif',
            fill:'#1b5e20',
            stroke:'rgba(255,255,255,0.8)',
            width:2
          });
          return {
            place(layout,geom,feature){
              const ring=geom[0];
              if(!ring||ring.length===0) return;
              const{x:cx,y:cy}=_polygonCentroid(ring);
              const orig=feature.props;
              const fakeProps=Object.assign({},orig);
              fakeProps['_R']=String(parseInt(orig['RIN']||'0',10));
              feature.props=fakeProps;
              const r=_inner.place(layout,[[{x:cx,y:cy}]],feature);
              feature.props=orig;
              return r;
            }
          };
        })()
      }
    ]
  });
}

_rinpanBtn.onclick=()=>{
  if(_rinpanOn){
    if(_rinpanLayer){ map.removeLayer(_rinpanLayer); }
    _rinpanOn=false;
    _rinpanBtn.classList.remove('active');
    toast('林班レイヤを非表示');
  } else {
    if(!_rinpanLayer){ _rinpanLayer=_buildRinpanLayer(); }
    _rinpanLayer.addTo(map);
    _rinpanOn=true;
    _rinpanBtn.classList.add('active');
    toast('林班レイヤを表示');
  }
  closeSheet();
};

/* --- 連携可能レイヤ: 小班 PMTiles --- */
const _IROHA=['い','ろ','は','に','ほ','へ','と','ち','り','ぬ','る','を','わ','か','よ','た','れ','そ','つ','ね','な','ら','む','う','ゐ','の','お','く','や','ま','け','ふ','こ','え','て','あ','さ','き','ゆ','め','み','し','ゑ','ひ','も','せ','す'];
const _KATA_IROHA=['イ','ロ','ハ','ニ','ホ','ヘ','ト','チ','リ','ヌ','ル','ヲ','ワ','カ','ヨ','タ','レ','ソ','ツ','ネ','ナ','ラ','ム','ウ','ヰ','ノ','オ','ク','ヤ','マ','ケ','フ','コ','エ','テ','ア','サ','キ','ユ','メ','ミ','シ','ヱ','ヒ','モ','セ','ス'];
function _edaToKana(eda){
  if(!eda||eda==='-') return '';
  const idx=String(eda).toUpperCase().charCodeAt(0)-65;
  return (idx>=0&&idx<_KATA_IROHA.length)?_KATA_IROHA[idx]:String(eda);
}
function _shoToIroha(sho){
  if(!sho) return '';
  const idx=sho.toUpperCase().charCodeAt(0)-65;
  return (idx>=0&&idx<_IROHA.length)?_IROHA[idx]:String(sho);
}

let _shohanLayer=null;
let _shohanOn=false;
const _shohanBtn=document.getElementById('btnToggleShohan');

function _buildShohanLayer(){
  const paintRules=[
    {
      dataLayer:'shohan',
      symbolizer: new protomapsL.PolygonSymbolizer({
        fill:'rgba(0,0,0,0)',
        stroke:'#1565c0',
        width:1.2
      })
    }
  ];
  if(_xlsxJoinMap&&_xlsxTargetLayer==='shohan'){
    paintRules.unshift({
      dataLayer:'shohan',
      filter:(zoom,feat)=>_xlsxJoinMap.has(String(feat.props[_xlsxKeyPmtField]??'').trim()),
      symbolizer: new protomapsL.PolygonSymbolizer({fill:'rgba(255,220,0,0.55)',stroke:'#f9a825',width:1.6})
    });
  }
  return protomapsL.leafletLayer({
    url:_muniUrl('shohan'),
    pane:'shohanPane',
    paintRules,
    labelRules:[
      {
        dataLayer:'shohan',
        minzoom:13,
        symbolizer:(()=>{
          const _IR=['い','ろ','は','に','ほ','へ','と','ち','り','ぬ','る','を','わ','か','よ','た','れ','そ','つ','ね','な','ら','む','う','ゐ','の','お','く','や','ま','け','ふ','こ','え','て','あ','さ','き','ゆ','め','み','し','ゑ','ひ','も','せ','す'];
          const _inner=new protomapsL.CenteredTextSymbolizer({
            labelProps:['_S'],
            font:'bold 13px IPAGothic,IPAゴシック,sans-serif',
            fill:'#0d47a1',
            stroke:'rgba(255,255,255,0.9)',
            width:3
          });
          return {
            place(layout,geom,feature){
              const ring=geom[0];
              if(!ring||ring.length===0) return;
              const{x:cx,y:cy}=_polygonCentroid(ring);
              const orig=feature.props;
              const sho=(orig['SHO']||'').toUpperCase();
              const idx=sho.length>0?sho.charCodeAt(0)-65:-1;
              const lbl=(idx>=0&&idx<_IR.length)?_IR[idx]:sho;
              const fakeProps=Object.assign({},orig);
              fakeProps['_S']=lbl;
              feature.props=fakeProps;
              const r=_inner.place(layout,[[{x:cx,y:cy}]],feature);
              feature.props=orig;
              return r;
            }
          };
        })()
      }
    ]
  });
}

_shohanBtn.onclick=()=>{
  if(_shohanOn){
    if(_shohanLayer){ map.removeLayer(_shohanLayer); }
    _shohanOn=false;
    _shohanBtn.classList.remove('active');
    toast('小班レイヤを非表示');
  } else {
    if(!_shohanLayer){ _shohanLayer=_buildShohanLayer(); }
    _shohanLayer.addTo(map);
    _shohanOn=true;
    _shohanBtn.classList.add('active');
    toast('小班レイヤを表示');
  }
  closeSheet();
};

/* --- 連携可能レイヤ: 施業班 PMTiles --- */
let _segyohanLayer=null;
let _segyohanOn=false;
const _segyohanBtn=document.getElementById('btnToggleSegyohan');

function _buildSegyohanLayer(){
  const hasFilter=_filterRules.length>0;
  const paintRules=[
    {
      // ベース: フィルタ中は非一致をグレーアウト、フィルタなしは通常表示
      dataLayer:'segyohan',
      symbolizer: new protomapsL.PolygonSymbolizer({
        fill: 'rgba(0,0,0,0)',
        stroke: hasFilter ? 'rgba(180,180,180,0.35)' : '#e65100',
        width: hasFilter ? 0.4 : 0.6
      })
    }
  ];
  if(hasFilter){
    // 一致する施業班をハイライト
    paintRules.unshift({
      dataLayer:'segyohan',
      filter:(zoom,feat)=>_evalFilter(feat.props),
      symbolizer: new protomapsL.PolygonSymbolizer({
        fill:'rgba(0,100,255,0.18)',
        stroke:'#0044cc',
        width:1.4
      })
    });
  }
  if(_xlsxJoinMap&&_xlsxTargetLayer==='segyohan'){
    paintRules.unshift({
      dataLayer:'segyohan',
      filter:(zoom,feat)=>_xlsxJoinMap.has(String(feat.props[_xlsxKeyPmtField]??'').trim()),
      symbolizer: new protomapsL.PolygonSymbolizer({fill:'rgba(255,220,0,0.55)',stroke:'#f9a825',width:1.2})
    });
  }
  paintRules.push({dataLayer:'segyohan',symbolizer:_valueCollector});
  return protomapsL.leafletLayer({
    url: _muniUrl('segyohan'),
    pane:'segyohanPane',
    paintRules,
    labelRules:[
      {
        dataLayer:'segyohan',
        minzoom:14,
        symbolizer:(()=>{
          const _inner=new protomapsL.CenteredTextSymbolizer({
            labelProps:['_S'],
            font:'9px sans-serif',
            fill:'#bf360c',
            stroke:'rgba(255,255,255,0.8)',
            width:1.5
          });
          return {
            place(layout,geom,feature){
              const ring=geom[0];
              if(!ring||ring.length===0) return;
              const{x:cx,y:cy}=_polygonCentroid(ring);
              const orig=feature.props;
              feature.props=Object.assign({},orig,{_S:String(parseInt(orig['SEGYO']||'0',10))+_edaToKana(orig['EDA'])});
              const r=_inner.place(layout,[[{x:cx,y:cy}]],feature);
              feature.props=orig;
              return r;
            }
          };
        })()
      }
    ]
  });
}

const _btnToggleFilter=document.getElementById('btnToggleFilter');

_segyohanBtn.onclick=()=>{
  if(_segyohanOn){
    if(_segyohanLayer){ map.removeLayer(_segyohanLayer); }
    _segyohanOn=false;
    _segyohanBtn.classList.remove('active');
    _btnToggleFilter.classList.remove('hi');
    toast('施業班レイヤを非表示');
  } else {
    if(!_segyohanLayer){ _segyohanLayer=_buildSegyohanLayer(); }
    _segyohanLayer.addTo(map);
    _segyohanOn=true;
    _segyohanBtn.classList.add('active');
    _btnToggleFilter.classList.add('hi');
    toast('施業班レイヤを表示');
  }
  closeSheet();
};

const _filterModal=document.getElementById('filterModal');
function _openFilterModal(){ _filterModal.style.display='flex'; }
function _closeFilterModal(){ _filterModal.style.display='none'; }

_btnToggleFilter.onclick=()=>{
  if(!_segyohanOn){ toast('先に施業班を表示してください'); return; }
  _openFilterModal();
};
document.getElementById('btnFilterClose').onclick=()=>_closeFilterModal();

/* --- 施業班フィルタ --- */
const _FILTER_FIELDS=[
  '林種','育成区分','施業区分','層区分','樹種',
  '推進方向','地利級','疎密度','地位','齢級',
  '木材生産機能','施業種','効率的施業区域',
  '保安林1','特定施業森林','市町村名','大字名',
  '林齢','面積','樹高','材積','標高','傾斜',
];

const _NUMERIC_FIELDS=new Set(['林齢','面積','混交率','混交面積','疎密度','地位','樹高','材積','HA材積','成長量','標高','傾斜','齢級']);

// フィールドのselectを初期化
document.querySelectorAll('#filterRows .filter-field').forEach(sel=>{
  _FILTER_FIELDS.forEach(f=>{
    const o=document.createElement('option'); o.value=f; o.textContent=f; sel.appendChild(o);
  });
  sel.addEventListener('change',()=>_populateFilterValues(sel.closest('.filter-row')));
});

// PMTilesレンダリング時に値を収集するコレクタ
const _collectedValues=new Map();
const _valueCollector={
  draw(ctx,geom,z,feat){
    _FILTER_FIELDS.forEach(f=>{
      const v=feat.props[f];
      if(v==null||String(v).trim()==='') return;
      if(!_collectedValues.has(f)) _collectedValues.set(f,new Set());
      _collectedValues.get(f).add(String(v).trim());
    });
  }
};

function _populateFilterValues(row){
  const field=row.querySelector('.filter-field').value;
  const container=row.querySelector('.filter-values');
  container.innerHTML='';
  if(!field) return;
  if(_NUMERIC_FIELDS.has(field)){
    const nums=[...(_collectedValues.get(field)||[])].map(Number).filter(v=>!isNaN(v));
    const hint=nums.length?`データ範囲: ${Math.min(...nums)}〜${Math.max(...nums)}`:'';
    container.innerHTML=`<div class="filter-range">
      <input type="number" class="filter-min" placeholder="最小">
      <span>〜</span>
      <input type="number" class="filter-max" placeholder="最大">
    </div><div class="filter-range-hint">${hint}</div>`;
  } else {
    const vals=[...(_collectedValues.get(field)||[])].sort();
    if(!vals.length){
      container.innerHTML='<div class="filter-no-vals">（地図を表示後に再度開くと選択肢が出ます）</div>';
      return;
    }
    const list=document.createElement('div');
    list.className='filter-checkboxes';
    vals.forEach(v=>{
      const lbl=document.createElement('label');
      lbl.className='filter-chk-item';
      lbl.innerHTML=`<input type="checkbox" value="${v}"><span>${v}</span>`;
      list.appendChild(lbl);
    });
    container.appendChild(list);
  }
}

let _filterRules=[]; // [{field,type,values:[]} | {field,type,min,max}]

function _evalFilter(props){
  return _filterRules.every(r=>{
    if(!r.field) return true;
    const val=String(props[r.field]??'').trim();
    if(r.type==='categorical'){
      return r.values.length===0||r.values.includes(val);
    }
    const num=Number(val);
    if(isNaN(num)) return false;
    if(r.min!==''&&!isNaN(r.min)&&num<r.min) return false;
    if(r.max!==''&&!isNaN(r.max)&&num>r.max) return false;
    return true;
  });
}

function _rebuildSegyohanLayer(){
  if(!_segyohanOn) return;
  if(_segyohanLayer){ map.removeLayer(_segyohanLayer); }
  _segyohanLayer=_buildSegyohanLayer();
  _segyohanLayer.addTo(map);
}

document.getElementById('btnFilterApply').onclick=()=>{
  _filterRules=[];
  document.querySelectorAll('#filterModal .filter-row').forEach(row=>{
    const field=row.querySelector('.filter-field').value;
    if(!field) return;
    if(_NUMERIC_FIELDS.has(field)){
      const minEl=row.querySelector('.filter-min');
      const maxEl=row.querySelector('.filter-max');
      const min=minEl?minEl.value:'';
      const max=maxEl?maxEl.value:'';
      if(min!==''||max!=='') _filterRules.push({field,type:'numeric',min:min!==''?Number(min):'',max:max!==''?Number(max):''});
    } else {
      const checked=[...row.querySelectorAll('.filter-checkboxes input:checked')].map(c=>c.value);
      if(checked.length) _filterRules.push({field,type:'categorical',values:checked});
    }
  });
  _rebuildSegyohanLayer();
  const n=_filterRules.length;
  document.getElementById('filterStatus').textContent=n?`${n}件の条件を適用中`:'条件なし（全件表示）';
  if(n) _closeFilterModal();
};

document.getElementById('btnFilterClear').onclick=()=>{
  _filterRules=[];
  document.querySelectorAll('#filterModal .filter-row').forEach(row=>{
    row.querySelector('.filter-field').value='';
    row.querySelector('.filter-values').innerHTML='';
  });
  _rebuildSegyohanLayer();
  document.getElementById('filterStatus').textContent='';
};

/* --- Excel連携 --- */
const _LAYER_JOIN_CFG={
  rinpan:  {label:'林班',  keys:[{v:'RIN',       l:'RIN（林班番号）'}]},
  shohan:  {label:'小班',  keys:[{v:'SHO',       l:'SHO（小班記号）'}]},
  segyohan:{label:'施業班',keys:[{v:'KEY_02',    l:'KEY_02（施業班キー）'},{v:'SEGYOHANID',l:'SEGYOHANID（施業班ID）'}]},
};

let _xlsxRows=[];
let _xlsxJoinMap=null;
let _xlsxTargetLayer='rinpan';
let _xlsxKeyPmtField='RIN';
let _xlsxKeyXlsCol='';
let _xlsxIsCsv=false; // CSV=氏名非表示 / Excel=氏名表示

const xlsxInput      = document.getElementById('xlsxInput');
const xlsxModal      = document.getElementById('xlsxModal');
const xlsxLayerSel   = document.getElementById('xlsxLayerSel');
const xlsxKeyPmtSel  = document.getElementById('xlsxKeyPmt');
const xlsxKeyXlsSel  = document.getElementById('xlsxKeyXls');
const xlsxModalInfo  = document.getElementById('xlsxModalInfo');
const btnExcelLink   = document.getElementById('btnExcelLink');
const btnExcelClear  = document.getElementById('btnExcelClear');

function _updateXlsxKeyOptions(){
  const cfg=_LAYER_JOIN_CFG[xlsxLayerSel.value];
  xlsxKeyPmtSel.innerHTML=cfg.keys.map(k=>`<option value="${k.v}">${k.l}</option>`).join('');
}
xlsxLayerSel.onchange=_updateXlsxKeyOptions;
_updateXlsxKeyOptions();

btnExcelLink.onclick=()=>{ xlsxInput.value=''; xlsxInput.click(); closeSheet(); };

function _parseCsvLine(line){
  const result=[]; let inQ=false, field='';
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(inQ){ if(ch==='"'&&line[i+1]==='"'){field+='"';i++;} else if(ch==='"'){inQ=false;} else field+=ch; }
    else { if(ch==='"'){inQ=true;} else if(ch===','){result.push(field);field='';} else field+=ch; }
  }
  result.push(field); return result;
}
function _parseCsv(text){
  const lines=text.split(/\r?\n/);
  const headers=_parseCsvLine(lines[0]);
  const rows=[];
  for(let i=1;i<lines.length;i++){
    if(!lines[i].trim()) continue;
    const vals=_parseCsvLine(lines[i]);
    const obj={}; headers.forEach((h,j)=>{obj[h]=vals[j]??'';});
    rows.push(obj);
  }
  return rows;
}

xlsxInput.onchange=()=>{
  const f=xlsxInput.files[0]; if(!f) return;
  _xlsxRows=[];
  xlsxKeyXlsSel.innerHTML='';
  const isCsv=f.name.toLowerCase().endsWith('.csv');
  const rd=new FileReader();
  rd.onload=(e)=>{
    try{
      if(isCsv){
        const bytes=new Uint8Array(e.target.result);
        let text='';
        if(bytes[0]===0xEF&&bytes[1]===0xBB&&bytes[2]===0xBF){
          // UTF-8 BOM → BOMを除いてデコード
          text=new TextDecoder('utf-8').decode(bytes.slice(3));
        } else if(bytes[0]===0xFF&&bytes[1]===0xFE){
          // UTF-16 LE BOM
          text=new TextDecoder('utf-16le').decode(bytes.slice(2));
        } else {
          // Shift-JIS → UTF-8 の順で試みる
          for(const enc of ['shift_jis','utf-8']){
            try{ text=new TextDecoder(enc).decode(bytes); break; }catch(_){}
          }
        }
        _xlsxRows=_parseCsv(text);
      } else {
        const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
        const ws=wb.Sheets[wb.SheetNames[0]];
        _xlsxRows=XLSX.utils.sheet_to_json(ws,{defval:''});
      }
      if(!_xlsxRows.length){ toast('データが空です'); return; }
      const headers=Object.keys(_xlsxRows[0]);
      xlsxKeyXlsSel.innerHTML=headers.map(h=>`<option value="${h}">${h}</option>`).join('');
      xlsxModalInfo.textContent=`${_xlsxRows.length}行 / ${headers.length}列 読み込み完了`;
      _updateXlsxKeyOptions();
      xlsxModal.classList.add('show');
    } catch(err){
      toast('ファイルの読み込みに失敗しました: '+err.message);
    }
  };
  rd.readAsArrayBuffer(f);
};

document.getElementById('xlsxModalCancel').onclick=()=>{ xlsxModal.classList.remove('show'); };
document.getElementById('xlsxStatClose').onclick=()=>{ document.getElementById('xlsxStatCard').style.display='none'; };

document.getElementById('xlsxStatExportBtn').onclick=()=>{ _openExportModal(); };
document.getElementById('btnExportLayer').onclick=()=>{ _openExportModal(); closeSheet(); };

/* ===== PMTiles → GeoJSON/GPKG/SHP エクスポートエンジン ===== */

const _EXPORT_CFG = {
  rinpan:   { layer:'rinpan',   idField:'RIN',        label:'林班' },
  shohan:   { layer:'shohan',   idField:'SHO',        label:'小班' },
  segyohan: { layer:'segyohan', idField:'SEGYOHANID', label:'施業班' }
};
function _exportUrl(key){ return _muniUrl(_EXPORT_CFG[key].layer); }

/* ---- MVT / PBF デコード ---- */
const _zz = n => (n>>1)^-(n&1);

function _px2lng(px,ext,z,tx){ return ((px/ext+tx)/(1<<z))*360-180; }
function _px2lat(py,ext,z,ty){
  return Math.atan(Math.sinh(Math.PI*(1-2*(py/ext+ty)/(1<<z))))*180/Math.PI;
}

function _parseMVTLayer(buf, layerName){
  const pbf = new Pbf(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf);
  let found = null;
  pbf.readFields((tag,_,p)=>{
    if(tag!==3) return;
    const lyr = p.readMessage((t,l,p)=>{
      if(t===1) l.name=p.readString();
      else if(t===2){ (l.f||(l.f=[])).push(p.readMessage((t,f,p)=>{
        if(t===2)f.tags=p.readPackedVarint();
        else if(t===3)f.type=p.readVarint();
        else if(t===4)f.geom=p.readPackedVarint();
      },{}));}
      else if(t===3){(l.k||(l.k=[])).push(p.readString());}
      else if(t===4){(l.v||(l.v=[])).push(p.readMessage((t,v,p)=>{
        if(t===1)v.v=p.readString();
        else if(t===2)v.v=p.readFloat();
        else if(t===3)v.v=p.readDouble();
        else if(t===4)v.v=p.readVarint(true);
        else if(t===5)v.v=p.readVarint();
        else if(t===6)v.v=p.readSVarint();
        else if(t===7)v.v=p.readBoolean();
      },{}));}
      else if(t===5)l.ext=p.readVarint();
    },{name:'',f:[],k:[],v:[],ext:4096});
    if(lyr.name===layerName) found=lyr;
  },null);
  return found;
}

function _mvtProps(f,lyr){
  const p={},tags=f.tags||[];
  for(let i=0;i<tags.length;i+=2){
    const k=lyr.k[tags[i]],v=lyr.v[tags[i+1]];
    if(k!==undefined&&v!==undefined)p[k]=v.v;
  }
  return p;
}

function _ringSignedArea(r){
  let a=0;
  for(let i=0,j=r.length-1;i<r.length;j=i++)a+=r[j][0]*r[i][1]-r[i][0]*r[j][1];
  return a/2;
}

function _decodeRings(geom,ext,z,tx,ty){
  let x=0,y=0,i=0;
  const rings=[]; let pts=[];
  while(i<geom.length){
    const cmd=geom[i]&7,cnt=geom[i]>>3; i++;
    if(cmd===1||cmd===2){
      for(let j=0;j<cnt;j++,i+=2){
        x+=_zz(geom[i]); y+=_zz(geom[i+1]);
        const pt=[_px2lng(x,ext,z,tx),_px2lat(y,ext,z,ty)];
        if(cmd===1){
          if(pts.length>=3) rings.push([...pts,pts[0]]);
          pts=[pt];
        } else pts.push(pt);
      }
    } else if(cmd===7){
      if(pts.length>=3) rings.push([...pts,pts[0]]);
      pts=[];
    }
  }
  if(pts.length>=3) rings.push([...pts,pts[0]]);
  return rings;
}

// リングをpolygon-clipping形式のパーツに変換
function _ringsToParts(rings){
  const parts=[]; let cur=null;
  for(const r of rings){
    if(_ringSignedArea(r)<0){ // MVT exterior = CW in WGS84
      if(cur) parts.push(cur);
      cur=[r];
    } else if(cur) cur.push(r);
  }
  if(cur) parts.push(cur);
  return parts.length ? parts : rings.map(r=>[r]);
}

/* ---- 全フィーチャー取得 ---- */
async function _extractFeatures(cfgKey, onProg){
  const cfg = _EXPORT_CFG[cfgKey];
  const pm = new pmtiles.PMTiles(_exportUrl(cfgKey));
  const hdr = await pm.getHeader();
  const z = hdr.maxZoom;
  const N = 1<<z;

  const d2t = (lon,lat)=>{
    const tx=Math.floor((lon+180)/360*N);
    const lr=lat*Math.PI/180;
    const ty=Math.floor((1-Math.log(Math.tan(lr)+1/Math.cos(lr))/Math.PI)/2*N);
    return[tx,Math.max(0,Math.min(N-1,ty))];
  };
  const [txMin,tyMin]=d2t(hdr.minLon,hdr.maxLat);
  const [txMax,tyMax]=d2t(hdr.maxLon,hdr.minLat);

  const tiles=[];
  for(let tx=txMin;tx<=txMax;tx++) for(let ty=tyMin;ty<=tyMax;ty++) tiles.push([tx,ty]);
  let done=0;

  const feats=new Map();

  const fetchOne=async([tx,ty])=>{
    const tile=await pm.getZxy(z,tx,ty);
    done++;
    onProg(done/tiles.length*0.75,`タイル ${done}/${tiles.length} 読み込み中`);
    if(!tile?.data) return;
    const lyr=_parseMVTLayer(tile.data,cfg.layer);
    if(!lyr) return;
    for(const f of(lyr.f||[])){
      if(f.type!==3) continue;
      const props=_mvtProps(f,lyr);
      const id=String(props[cfg.idField]??'unknown');
      const rings=_decodeRings(f.geom||[],lyr.ext,z,tx,ty);
      const parts=_ringsToParts(rings);
      if(!feats.has(id)) feats.set(id,{props,parts:[]});
      feats.get(id).parts.push(...parts);
    }
  };

  // 並列 8本でタイルフェッチ
  const BATCH=8;
  for(let i=0;i<tiles.length;i+=BATCH) await Promise.all(tiles.slice(i,i+BATCH).map(fetchOne));

  // ポリゴン再結合 + Excel結合
  const geoFeats=[];
  let fi=0;
  for(const[,{props,parts}] of feats){
    fi++;
    if(fi%50===0) onProg(0.75+fi/feats.size*0.25,`ポリゴン再結合 ${fi}/${feats.size}`);
    let coords;
    if(parts.length===1){
      coords=[parts[0]];
    } else {
      try{ coords=polygonClipping.union(...parts); }
      catch(_){ coords=parts; }
    }
    const p={...props};
    if(_xlsxJoinMap){
      const key=String(p[_xlsxKeyPmtField]??'').trim();
      const row=_xlsxJoinMap.get(key);
      if(row) for(const[k,v] of Object.entries(row)) if(k!==_xlsxKeyXlsCol) p[k]=v;
    }
    geoFeats.push({type:'Feature',geometry:{type:'MultiPolygon',coordinates:coords},properties:p});
  }
  onProg(1,'完了');
  return{type:'FeatureCollection',features:geoFeats};
}

/* ---- ダウンロードヘルパー ---- */
function _dl(blob,fname){
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url; a.download=fname; document.body.appendChild(a); a.click();
  document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/* ---- GeoJSON ---- */
function _exportGeoJSON(fc,fname){
  _dl(new Blob([JSON.stringify(fc)],{type:'application/geo+json'}),fname+'.geojson');
}

/* ---- WKB / GPKG ---- */
function _multipolygonWKB(coords){
  let sz=9;
  for(const poly of coords){sz+=9;for(const ring of poly)sz+=4+ring.length*16;}
  const buf=new Uint8Array(sz),dv=new DataView(buf.buffer); let o=0;
  buf[o++]=1; dv.setInt32(o,6,true); o+=4; dv.setInt32(o,coords.length,true); o+=4;
  for(const poly of coords){
    buf[o++]=1; dv.setInt32(o,3,true); o+=4; dv.setInt32(o,poly.length,true); o+=4;
    for(const ring of poly){
      dv.setInt32(o,ring.length,true); o+=4;
      for(const[x,y] of ring){dv.setFloat64(o,x,true);o+=8;dv.setFloat64(o,y,true);o+=8;}
    }
  }
  return buf;
}
function _gpkgGeom(wkb,srid){
  const b=new Uint8Array(8+wkb.length),dv=new DataView(b.buffer);
  b[0]=0x47;b[1]=0x50;b[2]=0;b[3]=1;
  dv.setInt32(4,srid,false); b.set(wkb,8); return b;
}

async function _exportGPKG(fc,fname,onProg){
  if(!window.initSqlJs){
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js';
      s.onload=res;s.onerror=rej;document.head.appendChild(s);
    });
  }
  const SQL=await initSqlJs({locateFile:f=>`https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`});
  const db=new SQL.Database();
  db.run('PRAGMA application_id=0x47504B47');
  db.run('PRAGMA user_version=10200');
  db.run(`CREATE TABLE gpkg_spatial_ref_sys(srs_name TEXT NOT NULL,srs_id INTEGER NOT NULL PRIMARY KEY,organization TEXT NOT NULL,organization_coordsys_id INTEGER NOT NULL,definition TEXT NOT NULL,description TEXT)`);
  db.run(`INSERT INTO gpkg_spatial_ref_sys VALUES('WGS 84',4326,'EPSG',4326,'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',NULL)`);
  db.run(`INSERT INTO gpkg_spatial_ref_sys VALUES('Undefined',-1,'NONE',-1,'undefined',NULL)`);
  db.run(`INSERT INTO gpkg_spatial_ref_sys VALUES('Undefined geographic SRS',0,'NONE',0,'undefined',NULL)`);
  db.run(`CREATE TABLE gpkg_contents(table_name TEXT NOT NULL PRIMARY KEY,data_type TEXT NOT NULL,identifier TEXT,description TEXT,last_change DATETIME NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),min_x REAL,min_y REAL,max_x REAL,max_y REAL,srs_id INTEGER)`);
  db.run(`CREATE TABLE gpkg_geometry_columns(table_name TEXT NOT NULL,column_name TEXT NOT NULL,geometry_type_name TEXT NOT NULL,srs_id INTEGER NOT NULL,z TINYINT NOT NULL,m TINYINT NOT NULL,CONSTRAINT pk PRIMARY KEY(table_name,column_name))`);

  const tbl=fname.replace(/[^a-zA-Z0-9_]/g,'_');
  const fields=fc.features.length?Object.keys(fc.features[0].properties).slice(0,60):[];
  const cols=fields.map(f=>`"${f.replace(/"/g,'')}" TEXT`).join(',');
  db.run(`CREATE TABLE "${tbl}"(fid INTEGER PRIMARY KEY AUTOINCREMENT,geom BLOB${cols?','+cols:''})`);
  db.run(`INSERT INTO gpkg_contents VALUES('${tbl}','features','${tbl}','',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,NULL,NULL,NULL,4326)`);
  db.run(`INSERT INTO gpkg_geometry_columns VALUES('${tbl}','geom','MULTIPOLYGON',4326,0,0)`);

  const ph='?'+( fields.length?','+fields.map(()=>'?').join(','):'');
  const stmt=db.prepare(`INSERT INTO "${tbl}"(geom${fields.length?','+fields.map(f=>`"${f.replace(/"/g,'')}"`).join(','):''})\nVALUES(${ph})`);
  let fi=0;
  for(const feat of fc.features){
    if(++fi%200===0) onProg&&onProg(fi/fc.features.length,`GPKG書き込み ${fi}/${fc.features.length}`);
    try{
      const wkb=_multipolygonWKB(feat.geometry.coordinates);
      stmt.run([_gpkgGeom(wkb,4326),...fields.map(f=>String(feat.properties[f]??''))]);
    }catch(_){}
  }
  stmt.free();
  const data=db.export(); db.close();
  _dl(new Blob([data.buffer],{type:'application/geopackage+sqlite3'}),fname+'.gpkg');
}

/* ---- SHP (ZIP) ---- */
function _concat(arrays){
  const n=arrays.reduce((s,a)=>s+a.length,0),out=new Uint8Array(n); let o=0;
  for(const a of arrays){out.set(a,o);o+=a.length;} return out;
}

function _buildSHX(offsets,contentLens){
  const buf=new Uint8Array(100+offsets.length*8),dv=new DataView(buf.buffer);
  dv.setInt32(0,9994,false); dv.setInt32(24,(100+offsets.length*8)/2,false); dv.setInt32(28,1000,true); dv.setInt32(32,5,true);
  for(let i=0;i<offsets.length;i++){
    dv.setInt32(100+i*8,offsets[i]/2,false); dv.setInt32(104+i*8,contentLens[i]/2,false);
  }
  return buf;
}

function _buildSHPRecord(feat,recNo){
  const rings=feat.geometry.coordinates.flatMap(p=>p);
  let numPts=0; for(const r of rings)numPts+=r.length;
  const cLen=4+32+8+numPts*16+rings.length*4; // shape_type+bbox+numparts+numpts+parts+pts
  const buf=new Uint8Array(8+cLen),dv=new DataView(buf.buffer);
  dv.setInt32(0,recNo,false); dv.setInt32(4,cLen/2,false);

  let o=8,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const r of rings)for(const[x,y] of r){
    if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
  }
  dv.setInt32(o,5,true);o+=4;
  dv.setFloat64(o,minX,true);o+=8;dv.setFloat64(o,minY,true);o+=8;
  dv.setFloat64(o,maxX,true);o+=8;dv.setFloat64(o,maxY,true);o+=8;
  dv.setInt32(o,rings.length,true);o+=4;dv.setInt32(o,numPts,true);o+=4;
  let pStart=0;
  for(const r of rings){dv.setInt32(o,pStart,true);o+=4;pStart+=r.length;}
  for(const r of rings)for(const[x,y] of r){dv.setFloat64(o,x,true);o+=8;dv.setFloat64(o,y,true);o+=8;}
  return buf;
}

function _buildDBF(feats,fields){
  const recSize=1+fields.length*50,headerSize=32+fields.length*32+1;
  const buf=new Uint8Array(headerSize+feats.length*recSize+1),dv=new DataView(buf.buffer);
  const now=new Date();
  buf[0]=3;buf[1]=now.getFullYear()-1900;buf[2]=now.getMonth()+1;buf[3]=now.getDate();
  dv.setInt32(4,feats.length,true);dv.setInt16(8,headerSize,true);dv.setInt16(10,recSize,true);
  let o=32;
  for(const f of fields){
    const n=(f+'          ').substring(0,10);
    for(let i=0;i<10;i++)buf[o+i]=n.charCodeAt(i)&0xff;
    buf[o+11]=67;buf[o+16]=50;o+=32;
  }
  buf[o++]=0x0D;
  for(const feat of feats){
    buf[o++]=0x20;
    for(const f of fields){
      const v=(String(feat.properties[f]??'')+'                                                  ').substring(0,50);
      for(let i=0;i<50;i++)buf[o+i]=v.charCodeAt(i)&0xff;
      o+=50;
    }
  }
  buf[o]=0x1A; return buf;
}

async function _exportSHP(fc,fname,onProg){
  if(!window.JSZip){
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload=res;s.onerror=rej;document.head.appendChild(s);
    });
  }
  const feats=fc.features;
  const fields=feats.length?Object.keys(feats[0].properties).slice(0,20):[];
  const recs=[],offsets=[],contentLens=[];
  let shpOff=100,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;

  for(let i=0;i<feats.length;i++){
    if(i%500===0)onProg&&onProg(i/feats.length*0.7,`SHP生成 ${i}/${feats.length}`);
    const rec=_buildSHPRecord(feats[i],i+1);
    for(const r of feats[i].geometry.coordinates.flatMap(p=>p))
      for(const[x,y] of r){
        if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      }
    offsets.push(shpOff); contentLens.push(rec.length-8);
    shpOff+=rec.length; recs.push(rec);
  }

  const shpHead=new Uint8Array(100),shpHDV=new DataView(shpHead.buffer);
  shpHDV.setInt32(0,9994,false);shpHDV.setInt32(24,shpOff/2,false);shpHDV.setInt32(28,1000,true);shpHDV.setInt32(32,5,true);
  shpHDV.setFloat64(36,minX,true);shpHDV.setFloat64(44,minY,true);shpHDV.setFloat64(52,maxX,true);shpHDV.setFloat64(60,maxY,true);
  const shxHead=new Uint8Array(100),shxHDV=new DataView(shxHead.buffer);
  shxHDV.setInt32(0,9994,false);shxHDV.setInt32(24,(100+feats.length*8)/2,false);shxHDV.setInt32(28,1000,true);shxHDV.setInt32(32,5,true);
  shxHDV.setFloat64(36,minX,true);shxHDV.setFloat64(44,minY,true);shxHDV.setFloat64(52,maxX,true);shxHDV.setFloat64(60,maxY,true);

  const prj='GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  const zip=new JSZip();
  zip.file(fname+'.shp',_concat([shpHead,...recs]));
  zip.file(fname+'.shx',_buildSHX(offsets,contentLens));
  zip.file(fname+'.dbf',_buildDBF(feats,fields));
  zip.file(fname+'.prj',prj);
  const zb=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
  _dl(zb,fname+'.zip');
}

/* ---- エクスポートUI ---- */
document.querySelectorAll('.exportFmtBtn').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('.exportFmtBtn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
  };
});

function _openExportModal(){
  document.getElementById('exportProgress').style.display='none';
  document.getElementById('exportStart').disabled=false;
  document.getElementById('exportModal').classList.add('show');
}

document.getElementById('exportCancel').onclick=()=>{
  document.getElementById('exportModal').classList.remove('show');
};

document.getElementById('exportStart').onclick=async()=>{
  const layerKey=document.getElementById('exportLayerSel').value;
  const cfg=_EXPORT_CFG[layerKey];
  const fname=cfg.label+'_'+new Date().toISOString().slice(0,10).replace(/-/g,'');
  const progEl=document.getElementById('exportProgress');
  const barEl=document.getElementById('exportProgressBar');
  const txtEl=document.getElementById('exportProgressText');
  const btnEl=document.getElementById('exportStart');
  const fmt=(document.querySelector('.exportFmtBtn.active')||{}).dataset?.fmt||'geojson';

  const onProg=(pct,msg)=>{
    barEl.style.width=(pct*100)+'%';
    txtEl.textContent=msg||'処理中...';
  };

  btnEl.disabled=true;
  progEl.style.display='block';
  try{
    const fc=await _extractFeatures(layerKey,onProg);
    txtEl.textContent='ファイル生成中...';
    if(fmt==='geojson') _exportGeoJSON(fc,fname);
    else if(fmt==='gpkg') await _exportGPKG(fc,fname,onProg);
    else if(fmt==='shp') await _exportSHP(fc,fname,onProg);
    toast(`${cfg.label} をエクスポートしました（${fc.features.length}件）`);
    document.getElementById('exportModal').classList.remove('show');
  }catch(err){
    toast('エクスポート失敗: '+err.message);
    console.error(err);
  }finally{
    btnEl.disabled=false;
    progEl.style.display='none';
  }
};

function _rebuildActiveLayers(){
  if(_rinpanOn&&_rinpanLayer){ map.removeLayer(_rinpanLayer); _rinpanLayer=_buildRinpanLayer(); _rinpanLayer.addTo(map); }
  if(_shohanOn&&_shohanLayer){ map.removeLayer(_shohanLayer); _shohanLayer=_buildShohanLayer(); _shohanLayer.addTo(map); }
  if(_segyohanOn&&_segyohanLayer){ map.removeLayer(_segyohanLayer); _segyohanLayer=_buildSegyohanLayer(); _segyohanLayer.addTo(map); }
}

function _showXlsxStat(){
  const xlRows=_xlsxRows.length;
  const matched=_xlsxJoinMap?_xlsxJoinMap.size:0;
  const layerLabel=_LAYER_JOIN_CFG[_xlsxTargetLayer]?.label||_xlsxTargetLayer;
  const card=document.getElementById('xlsxStatCard');
  document.getElementById('xlsxStatText').textContent=
    `📊 Excel連携中 — ${layerLabel}/${_xlsxKeyPmtField}キー ${matched.toLocaleString()} / ${xlRows.toLocaleString()} 件`;
  card.style.display='flex';
}

document.getElementById('xlsxModalOk').onclick=()=>{
  _xlsxTargetLayer=xlsxLayerSel.value;
  _xlsxKeyPmtField=xlsxKeyPmtSel.value;
  _xlsxKeyXlsCol=xlsxKeyXlsSel.value;
  _xlsxJoinMap=new Map();
  for(const row of _xlsxRows){
    const k=String(row[_xlsxKeyXlsCol]??'').trim();
    if(k) _xlsxJoinMap.set(k,row);
  }
  xlsxModal.classList.remove('show');
  btnExcelLink.classList.add('active');
  btnExcelClear.style.display='';
  _showXlsxStat();
  _rebuildActiveLayers();
  const _layerOnMap={rinpan:()=>_rinpanOn, shohan:()=>_shohanOn, segyohan:()=>_segyohanOn};
  const _layerBtnMap={rinpan:_rinpanBtn, shohan:_shohanBtn, segyohan:_segyohanBtn};
  if(!_layerOnMap[_xlsxTargetLayer]()) _layerBtnMap[_xlsxTargetLayer].click();
};

btnExcelClear.onclick=()=>{
  _xlsxRows=[]; _xlsxJoinMap=null;
  btnExcelLink.classList.remove('active');
  btnExcelClear.style.display='none';
  document.getElementById('xlsxStatCard').style.display='none';
  map.closePopup();
  _rebuildActiveLayers();
  toast('Excel連携を解除しました');
  closeSheet();
};

/* 林班・施業班クリック → ポップアップ */
function _queryLayer(layer, layerName, latlng){
  try{
    const results=layer.queryTileFeaturesDebug(latlng.lng,latlng.lat);
    for(const [,feats] of results){
      for(const f of feats){
        if(f.layerName===layerName) return f.feature.props;
      }
    }
  } catch(_){}
  return null;
}

map.on('click',(e)=>{
  const hasPmt=(_rinpanOn&&_rinpanLayer)||(_shohanOn&&_shohanLayer)||(_segyohanOn&&_segyohanLayer);
  if(!hasPmt) return;

  let props=null, layerLabel='', layerColor='';
  if(_segyohanOn&&_segyohanLayer){
    props=_queryLayer(_segyohanLayer,'segyohan',e.latlng);
    layerLabel='施業班'; layerColor='#e65100';
  }
  if(!props&&_shohanOn&&_shohanLayer){
    props=_queryLayer(_shohanLayer,'shohan',e.latlng);
    layerLabel='小班'; layerColor='#1565c0';
  }
  if(!props&&_rinpanOn&&_rinpanLayer){
    props=_queryLayer(_rinpanLayer,'rinpan',e.latlng);
    layerLabel='林班'; layerColor='#2e7d32';
  }
  if(!props) return;

  let title='';
  if(layerLabel==='施業班'){
    title=`林班${props.RIN||'-'} ${props.SHO||''}-${props.SEGYO||''}${_edaToKana(props.EDA)}`;
  } else if(layerLabel==='小班'){
    title=`林班${props.RIN||'-'} ${props.SHO||'-'}`;
  } else {
    title=`林班 ${props.RIN||'-'}`;
  }

  // PMTiles内部フィールド（表示しない）
  const _PMT_SKIP=new Set(['KEY_02','KEY_02ORG','RIN','SHO','SEGYO','EDA','SEGYOHANID',
    'CITY','SHONIN','AREA_','GIS_SEGYOH','SHAPE_AREA','SHAPE_LEN','_S','SHOKEY']);

  let html=`<div class="rinpanPopup">`;
  html+=`<b style="color:${layerColor}">[${layerLabel}] ${title}</b>`;

  if(layerLabel==='施業班'){
    if(props.KEY_02) html+=`<br><span class="xlKey">施業キー:</span> ${props.KEY_02}`;
    // 森林簿データ（PMTilesに結合済みのフィールドを動的表示）
    const forestEntries=Object.entries(props).filter(([k,v])=>
      !_PMT_SKIP.has(k) && v!==''&&v!=null
    );
    if(forestEntries.length){
      html+='<hr>';
      for(const [k,v] of forestEntries){
        html+=`<span class="xlKey">${k}:</span> ${v}<br>`;
      }
    } else {
      if(props.CITY) html+=`<br><span class="xlKey">市町村コード:</span> ${props.CITY}`;
    }
  } else {
    if(props.CITY) html+=`<br><span class="xlKey">市町村コード:</span> ${props.CITY}`;
  }

  // Excel連携（氏名Excelを接続した場合に表示）
  if(_xlsxJoinMap){
    const key=String(props[_xlsxKeyPmtField]??'').trim();
    const row=_xlsxJoinMap.get(key);
    if(row){
      html+='<hr><b style="font-size:11px;color:#e65100">森林所有者名</b><br>';
      for(const [col,val] of Object.entries(row)){
        if(col===_xlsxKeyXlsCol) continue;
        if(val===''||val==null) continue;
        html+=`<span class="xlKey">${col}:</span> ${val}<br>`;
      }
    }
  }
  html+='</div>';

  L.popup({maxWidth:300}).setLatLng(e.latlng).setContent(html).openOn(map);
});

/* --- GeoJSON --- */
const geojsonInput=document.getElementById('geojsonInput');
document.getElementById('btnPickGeojson').onclick=()=>{ geojsonInput.value=''; geojsonInput.click(); closeSheet(); };
geojsonInput.onchange=()=>{
  const f=geojsonInput.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      gjGroup.addLayer(makeVectorLayer(JSON.parse(r.result)));
      map.fitBounds(gjGroup.getBounds().pad(0.1));
      toast('GeoJSON 読み込み完了');
    } catch{ toast('GeoJSONの読み込みに失敗しました'); }
  };
  r.readAsText(f);
};

/* =========================
   GPKG（GeoPackage）読み込み
========================= */
const SQLJS_CDN='https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/';
let _SQL=null;

async function getSqlJs(){
  if(_SQL) return _SQL;
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=SQLJS_CDN+'sql-wasm.js';
    s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
  _SQL=await initSqlJs({ locateFile:f=>SQLJS_CDN+f });
  return _SQL;
}

function gpkgGeomToWKB(u8){
  if(u8[0]!==0x47||u8[1]!==0x50) return u8;
  const flags=u8[3];
  const isEmpty=(flags>>4)&1;
  if(isEmpty) return null;
  const envType=(flags>>1)&7;
  const envBytes=[0,32,48,48,64][envType]||0;
  return u8.subarray(8+envBytes);
}

function parseWKB(u8, off=0){
  const v=new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const le=v.getUint8(off)===1; off++;
  const rawType=v.getUint32(off,le); off+=4;
  const base=rawType%1000 || rawType;
  const hasZ=(rawType>1000&&rawType<4000)||((rawType&0x80000000)!==0);
  const ptBytes=hasZ?24:16;

  function readPt(){
    const x=v.getFloat64(off,le), y=v.getFloat64(off+8,le);
    off+=ptBytes; return [x,y];
  }
  function readPts(n){ const a=[]; for(let i=0;i<n;i++) a.push(readPt()); return a; }
  function readRing(){ const n=v.getUint32(off,le); off+=4; return readPts(n); }

  switch(base){
    case 1:{ const c=readPt(); return {geom:{type:'Point',coordinates:c},off}; }
    case 2:{ const n=v.getUint32(off,le); off+=4; return {geom:{type:'LineString',coordinates:readPts(n)},off}; }
    case 3:{ const rc=v.getUint32(off,le); off+=4; const rings=[]; for(let r=0;r<rc;r++) rings.push(readRing()); return {geom:{type:'Polygon',coordinates:rings},off}; }
    case 4: case 5: case 6:{
      const tnames={4:'MultiPoint',5:'MultiLineString',6:'MultiPolygon'};
      const gc=v.getUint32(off,le); off+=4;
      const geoms=[];
      for(let i=0;i<gc;i++){ const r=parseWKB(u8,off); if(!r) break; geoms.push(r.geom); off=r.off; }
      return {geom:{type:tnames[base],coordinates:geoms.map(g=>g.coordinates)},off};
    }
    case 7:{
      const gc=v.getUint32(off,le); off+=4;
      const geoms=[];
      for(let i=0;i<gc;i++){ const r=parseWKB(u8,off); if(!r) break; geoms.push(r.geom); off=r.off; }
      return {geom:{type:'GeometryCollection',geometries:geoms},off};
    }
    default: return null;
  }
}

function reprojectGeom(geom, fromCrs, toCrs){
  function rePt(c){ const p=proj4(fromCrs,toCrs,[c[0],c[1]]); return [p[0],p[1]]; }
  function reArr(a, d){ return d===0?rePt(a):a.map(x=>reArr(x,d-1)); }
  const depths={Point:0,LineString:1,Polygon:2,MultiPoint:1,MultiLineString:2,MultiPolygon:3};
  if(geom.type==='GeometryCollection')
    return {...geom,geometries:geom.geometries.map(s=>reprojectGeom(s,fromCrs,toCrs))};
  const d=depths[geom.type];
  return d!==undefined?{...geom,coordinates:reArr(geom.coordinates,d)}:geom;
}

async function loadGPKG(file){
  toast('GPKG読み込み中（初回はsql.jsをDL）...', 20000);
  try{
    const SQL=await getSqlJs();
    const buf=await file.arrayBuffer();
    const db=new SQL.Database(new Uint8Array(buf));
    let res;
    try{ res=db.exec("SELECT table_name FROM gpkg_contents WHERE data_type='features'"); }
    catch(e){ toast(`GPKGフォーマットエラー: ${e.message}`,5000); db.close(); return; }
    if(!res.length||!res[0].values.length){ toast('フィーチャーテーブルが見つかりません'); db.close(); return; }
    let total=0;
    for(const [tbl] of res[0].values){
      try{
        const safe=tbl.replace(/'/g,"''");
        const gc=db.exec(`SELECT column_name, srs_id FROM gpkg_geometry_columns WHERE table_name='${safe}'`);
        if(!gc.length) continue;
        const geomCol=gc[0].values[0][0];
        const srsId=gc[0].values[0][1];

        // CRS変換が必要か判定
        let fromCrs=null;
        if(srsId && srsId!==4326 && srsId!==0){
          if(srsId===3857){
            fromCrs='EPSG:3857';
          } else {
            try{
              const srsRes=db.exec(`SELECT definition FROM gpkg_spatial_ref_sys WHERE srs_id=${srsId}`);
              if(srsRes.length&&srsRes[0].values.length){
                const def=srsRes[0].values[0][0];
                if(def&&def.length>10&&!/^undefined/i.test(def)){
                  proj4.defs(`EPSG:${srsId}`,def);
                  fromCrs=`EPSG:${srsId}`;
                }
              }
            }catch{}
          }
        }

        const rows=db.exec(`SELECT * FROM "${tbl}"`);
        if(!rows.length) continue;
        const {columns,values}=rows[0];
        const gi=columns.indexOf(geomCol);
        const features=[];
        for(const row of values){
          const raw=row[gi]; if(!raw) continue;
          const wkb=gpkgGeomToWKB(raw instanceof Uint8Array?raw:new Uint8Array(raw));
          if(!wkb) continue;
          let geom;
          try{ const r=parseWKB(wkb,0); geom=r&&r.geom; } catch{ continue; }
          if(!geom) continue;
          if(fromCrs){ try{ geom=reprojectGeom(geom,fromCrs,'EPSG:4326'); }catch{} }
          const props={}; columns.forEach((c,i)=>{ if(i!==gi) props[c]=row[i]; });
          features.push({type:'Feature',geometry:geom,properties:props});
        }
        if(features.length){ gjGroup.addLayer(makeVectorLayer({type:'FeatureCollection',features})); total+=features.length; }
      } catch(e){ console.warn(`GPKG table "${tbl}":`,e); }
    }
    db.close();
    if(total){ map.fitBounds(gjGroup.getBounds().pad(0.1)); toast(`GPKG読込完了（${total}フィーチャー）`,3000); }
    else{ toast('フィーチャーが見つかりませんでした'); }
  } catch(e){ toast(`GPKG読み込み失敗: ${e.message}`,5000); console.error(e); }
}

const gpkgInput=document.getElementById('gpkgInput');
document.getElementById('btnPickGpkg').onclick=()=>{ gpkgInput.value=''; gpkgInput.click(); closeSheet(); };
gpkgInput.addEventListener('change',()=>{ const f=gpkgInput.files[0]; if(!f) return; loadGPKG(f); });

/* =========================
   GeoTIFF
========================= */
const geotiffInput=document.getElementById('geotiffInput');
let geotiffLayer=null, geotiffBounds=null;

document.getElementById('btnPickGeotiff').onclick=()=>{ geotiffInput.value=''; geotiffInput.click(); closeSheet(); };
geotiffInput.addEventListener('change',async()=>{
  const file=geotiffInput.files[0]; if(!file) return;
  toast('GeoTIFF読み込み中...',15000);
  try{
    const georaster=await parseGeoraster(await file.arrayBuffer());
    if(geotiffLayer) map.removeLayer(geotiffLayer);
    geotiffLayer=new GeoRasterLayer({georaster,opacity:0.75,resolution:256});
    geotiffLayer.addTo(map);
    geotiffBounds=geotiffLayer.getBounds();
    map.fitBounds(geotiffBounds);
    toast(`GeoTIFF表示完了（${file.name}）`,3000);
  } catch(e){ toast('GeoTIFF読み込み失敗',3000); console.error(e); }
  updateGeotiffUI();
});
document.getElementById('btnClearGeotiff').onclick=()=>{
  if(geotiffLayer){ map.removeLayer(geotiffLayer); geotiffLayer=null; }
  geotiffBounds=null; updateGeotiffUI();
  toast('GeoTIFFクリア'); closeSheet();
};
function updateGeotiffUI(){
  const has=!!geotiffBounds;
  document.getElementById('btnClearGeotiff').style.display=has?'':'none';
  document.getElementById('btnCacheArea').style.display=has?'':'none';
}
updateGeotiffUI();

/* =========================
   タイルキャッシュ（オフライン化）
========================= */
const TILE_CACHE_NAME='map-20260807a-tiles';
const CACHE_MIN_Z=10, CACHE_MAX_Z=17;
const TILE_TPLS=[
  'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
  'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
  'https://tile.geospatial.jp/CS/VER2/{z}/{x}/{y}.png',
];
function toTile(lat,lng,z){ const n=1<<z; return {x:Math.floor((lng+180)/360*n),y:Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)}; }
function tileCount(b){ let n=0; for(let z=CACHE_MIN_Z;z<=CACHE_MAX_Z;z++){ const sw=toTile(b.getSouth(),b.getWest(),z),ne=toTile(b.getNorth(),b.getEast(),z); n+=(ne.x-sw.x+1)*(sw.y-ne.y+1); } return n*TILE_TPLS.length; }
function* tileUrls(b){ for(let z=CACHE_MIN_Z;z<=CACHE_MAX_Z;z++){ const sw=toTile(b.getSouth(),b.getWest(),z),ne=toTile(b.getNorth(),b.getEast(),z); for(let x=sw.x;x<=ne.x;x++) for(let y=ne.y;y<=sw.y;y++) for(const t of TILE_TPLS) yield t.replace('{z}',z).replace('{x}',x).replace('{y}',y); } }

document.getElementById('btnCacheArea').style.display='';

// ---- PWAインストール ----
let _deferredInstall=null;
const _isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
const _isStandalone=()=>navigator.standalone||window.matchMedia('(display-mode:standalone)').matches;

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  _deferredInstall=e;
});

function _showInstallBtn(){
  if(_isStandalone()) return;
  document.getElementById('btnInstallPwa').style.display='';
}

document.getElementById('btnInstallPwa').onclick=async()=>{
  if(_deferredInstall){
    _deferredInstall.prompt();
    await _deferredInstall.userChoice;
    _deferredInstall=null;
    document.getElementById('btnInstallPwa').style.display='none';
  } else if(_isIOS){
    toast('Safariの共有ボタン（↑）→「ホーム画面に追加」を選択してください',6000);
  } else {
    toast('ブラウザのメニューから「ホーム画面に追加」を選択してください',5000);
  }
};

// ---- 範囲選択（ドラッグで矩形描画）----
let _cacheSelectMode=false, _cacheSelectCleanup=null;
let _cacheRect=null, _cacheBounds=null;

function _getMapPt(e){
  const r=map.getContainer().getBoundingClientRect();
  const s=(e.touches&&e.touches[0])||(e.changedTouches&&e.changedTouches[0])||e;
  return L.point(s.clientX-r.left,s.clientY-r.top);
}
function _clearCacheRect(){
  if(_cacheRect){map.removeLayer(_cacheRect);_cacheRect=null;}
  _cacheBounds=null;
  document.getElementById('btnSelectCacheArea').classList.remove('on');
}

document.getElementById('btnSelectCacheArea').onclick=()=>{
  // 描画モード中 → キャンセル
  if(_cacheSelectMode){
    _cacheSelectMode=false;
    if(_cacheSelectCleanup){_cacheSelectCleanup();_cacheSelectCleanup=null;}
    map.dragging.enable();map.getContainer().style.cursor='';
    document.getElementById('btnSelectCacheArea').classList.remove('on');
    return;
  }
  // 矩形あり → クリア
  if(_cacheBounds){_clearCacheRect();return;}

  _cacheSelectMode=true;
  document.getElementById('btnSelectCacheArea').classList.add('on');
  toast('ドラッグで保存範囲を選択',3000);
  map.dragging.disable();
  map.getContainer().style.cursor='crosshair';

  let startPt=null;
  const c=map.getContainer();

  function onDown(e){
    e.preventDefault();
    startPt=_getMapPt(e);
    if(_cacheRect){map.removeLayer(_cacheRect);_cacheRect=null;}
  }
  function onMove(e){
    if(!startPt)return;
    const ep=_getMapPt(e);
    const sw=map.containerPointToLatLng(L.point(Math.min(startPt.x,ep.x),Math.max(startPt.y,ep.y)));
    const ne=map.containerPointToLatLng(L.point(Math.max(startPt.x,ep.x),Math.min(startPt.y,ep.y)));
    if(_cacheRect)map.removeLayer(_cacheRect);
    _cacheRect=L.rectangle([sw,ne],{color:'#0066ff',weight:2,dashArray:'6 4',fillColor:'#0066ff',fillOpacity:0.12}).addTo(map);
  }
  function onUp(){
    if(!startPt)return;
    startPt=null;
    if(_cacheRect){
      _cacheBounds=_cacheRect.getBounds();
      const cnt=tileCount(_cacheBounds);
      toast(`範囲選択完了（タイル約${cnt}枚）\n「タイル保存」で保存`,3000);
    }
    cleanup();
  }
  function cleanup(){
    _cacheSelectMode=false;
    document.getElementById('btnSelectCacheArea').classList.remove('on');
    map.dragging.enable();map.getContainer().style.cursor='';
    c.removeEventListener('mousedown',onDown);
    c.removeEventListener('mousemove',onMove);
    c.removeEventListener('mouseup',onUp);
    c.removeEventListener('touchstart',onDown);
    c.removeEventListener('touchmove',onMove);
    c.removeEventListener('touchend',onUp);
    _cacheSelectCleanup=null;
  }
  _cacheSelectCleanup=cleanup;
  c.addEventListener('mousedown',onDown);
  c.addEventListener('mousemove',onMove);
  c.addEventListener('mouseup',onUp);
  c.addEventListener('touchstart',onDown,{passive:false});
  c.addEventListener('touchmove',onMove,{passive:false});
  c.addEventListener('touchend',onUp);
};

document.getElementById('btnCacheArea').onclick=async()=>{
  if(!('caches' in window)){toast('このブラウザはキャッシュAPIに非対応');return;}
  const bounds=_cacheBounds||geotiffBounds||map.getBounds();
  const label=_cacheBounds?'選択範囲':geotiffBounds?'GeoTIFF範囲':'現在表示中のエリア';
  const total=tileCount(bounds);
  if(!await showConfirm(`${label}をオフライン化します\n地図タイル約${total}枚\n（約${Math.round(total*35/1024)}MB想定）\n続行しますか？`))return;
  closeSheet();
  const urls=[...tileUrls(bounds)];
  const cache=await caches.open(TILE_CACHE_NAME);
  const bar=document.getElementById('cacheBar');
  bar.style.display='block';bar.style.width='0%';
  let done=0;
  for(let i=0;i<urls.length;i+=10){
    await Promise.all(urls.slice(i,i+10).map(u=>fetch(u,{mode:'cors'}).then(r=>{if(r.ok)cache.put(u,r);}).catch(()=>{})));
    done=Math.min(i+10,urls.length);
    bar.style.width=`${Math.round(done/urls.length*100)}%`;
    if(done%200===0||done===urls.length)toast(`キャッシュ中 ${done}/${urls.length}`,1500);
  }
  bar.style.display='none';
  toast(`オフライン化完了（タイル${total}枚）`,4000);
  _showInstallBtn();
};

document.getElementById('btnClearCache').onclick=async()=>{
  if(!('caches' in window))return;
  if(!await showConfirm('オフラインキャッシュをすべて削除しますか？'))return;
  const keys=await caches.keys();
  await Promise.all(keys.map(k=>caches.delete(k)));
  _clearCacheRect();
  toast('キャッシュをすべて削除しました');closeSheet();
};

/* =========================
   計測共通（面積・距離）
========================= */
let measurePts=[];
const measureGroup=L.layerGroup().addTo(map);
let measurePoly=null;
const measureBadge=document.getElementById('measureBadge');

// ── 面積（球面余剰公式）────────────────────────
function sphericalArea(pts){
  const R=6378137, n=pts.length;
  if(n<3) return 0;
  let s=0;
  for(let i=0;i<n;i++){
    const a=pts[i], b=pts[(i+1)%n];
    s+=(b.lng-a.lng)*Math.PI/180*(2+Math.sin(a.lat*Math.PI/180)+Math.sin(b.lat*Math.PI/180));
  }
  return Math.abs(s*R*R/2);
}
function fmtArea(m2){
  if(m2>=1000000) return `${(m2/1000000).toFixed(3)} km²`;
  if(m2>=10000)   return `${(m2/10000).toFixed(2)} ha`;
  return `${Math.round(m2).toLocaleString()} m²`;
}

// ── 距離（Haversine）─────────────────────────
function haverDist(a,b){
  const R=6378137, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function totalDist(pts){
  let d=0; for(let i=1;i<pts.length;i++) d+=haverDist(pts[i-1],pts[i]); return d;
}
function fmtDist(m){
  if(m>=1000) return `${(m/1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

// ── 描画 ─────────────────────────────────────
function redrawMeasure(){
  if(measurePoly){ measureGroup.removeLayer(measurePoly); measurePoly=null; }
  if(measurePts.length<2) return;
  if(measuring==='area'&&measurePts.length>=3){
    measurePoly=L.polygon(measurePts,{color:'#0044cc',weight:2,fillColor:'#4488ff',fillOpacity:0.18}).addTo(measureGroup);
  } else {
    measurePoly=L.polyline(measurePts,{color:'#cc6600',weight:3}).addTo(measureGroup);
  }
}

// ── UI更新 ────────────────────────────────────
function updateMeasureUI(){
  const btnA=document.getElementById('btnMeasure');
  const btnD=document.getElementById('btnDistMeasure');
  const has=measurePts.length>0;
  const canConfirm=(measuring==='area'&&measurePts.length>=3)||(measuring==='dist'&&measurePts.length>=2);

  btnA.innerHTML=`<span class="ico">${measuring==='area'?'⏹️':'📐'}</span>${measuring==='area'?'計測終了':'面積計測'}`;
  btnA.classList.toggle('on',measuring==='area');
  btnD.innerHTML=`<span class="ico">${measuring==='dist'?'⏹️':'📏'}</span>${measuring==='dist'?'計測終了':'距離計測'}`;
  btnD.classList.toggle('on',measuring==='dist');

  document.getElementById('btnMeasureConfirm').style.display=canConfirm?'':'none';
  document.getElementById('btnMeasureClear').style.display=has?'':'none';

  if(measuring==='area'&&measurePts.length>=3){
    measureBadge.textContent='📐 '+fmtArea(sphericalArea(measurePts));
    measureBadge.style.display='block';
  } else if(measuring==='area'){
    measureBadge.textContent=`📐 ${measurePts.length}点目 (3点以上で計算)`;
    measureBadge.style.display='block';
  } else if(measuring==='dist'&&measurePts.length>=2){
    measureBadge.textContent='📏 '+fmtDist(totalDist(measurePts));
    measureBadge.style.display='block';
  } else if(measuring==='dist'){
    measureBadge.textContent=`📏 ${measurePts.length}点目 (2点以上で計算)`;
    measureBadge.style.display='block';
  } else {
    measureBadge.style.display='none';
  }
}

// ── マップクリック ────────────────────────────
map.on('click',e=>{
  if(sharing){
    _shareLL=e.latlng;
    const lat=e.latlng.lat.toFixed(6), lng=e.latlng.lng.toFixed(6);
    const url=`${location.origin}${location.pathname}?lat=${lat}&lng=${lng}&z=${map.getZoom()}`;
    const shareBtn=navigator.share
      ?`<button onclick="window._webShare()" style="flex:1;padding:5px 8px;background:#00aa44;color:white;border:none;border-radius:6px;cursor:pointer;font-size:11px">📤 共有</button>`
      :'';
    L.popup({closeOnClick:true,autoClose:true,maxWidth:290})
      .setLatLng(e.latlng)
      .setContent(`
        <div style="font-size:12px;font-weight:bold;margin-bottom:6px">📍 ${lat}, ${lng}</div>
        <input value="${url}" readonly style="width:100%;font-size:10px;padding:3px 5px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;margin-bottom:6px" onclick="this.select()">
        <div style="display:flex;gap:5px">
          <button onclick="window._copyShareUrl()" style="flex:1;padding:5px 8px;background:#0066ff;color:white;border:none;border-radius:6px;cursor:pointer;font-size:11px">📋 コピー</button>
          ${shareBtn}
        </div>`)
      .openOn(map);
    sharing=false;
    shareBadge.style.display='none';
    document.getElementById('btnShare').classList.remove('on');
    return;
  }
  if(!measuring) return;
  measurePts.push(e.latlng);
  const color=measuring==='dist'?'#cc6600':'#0044cc';
  const fill=measuring==='dist'?'#ff9900':'#4488ff';
  L.circleMarker(e.latlng,{radius:5,color,fillColor:fill,fillOpacity:1,weight:2}).addTo(measureGroup);
  redrawMeasure();
  updateMeasureUI();
});

// ── 面積計測ボタン ────────────────────────────
document.getElementById('btnMeasure').onclick=()=>{
  measuring=measuring==='area'?'':'area';
  if(measuring){
    measurePts=[]; measureGroup.clearLayers(); measurePoly=null;
    map.closePopup(); closeSheet();
    toast('地図をクリックして頂点を追加（3点以上で面積表示）',3000);
  }
  updateMeasureUI();
  if(!measuring) closeSheet();
};

// ── 距離計測ボタン ────────────────────────────
document.getElementById('btnDistMeasure').onclick=()=>{
  measuring=measuring==='dist'?'':'dist';
  if(measuring){
    measurePts=[]; measureGroup.clearLayers(); measurePoly=null;
    map.closePopup(); closeSheet();
    toast('地図をクリックして経路点を追加（2点以上で距離表示）',3000);
  }
  updateMeasureUI();
  if(!measuring) closeSheet();
};

// ── 確定 ──────────────────────────────────────
document.getElementById('btnMeasureConfirm').onclick=()=>{
  const mode=measuring;
  measuring='';
  redrawMeasure();
  if(mode==='area'){
    const aStr=fmtArea(sphericalArea(measurePts));
    const clat=measurePts.reduce((s,p)=>s+p.lat,0)/measurePts.length;
    const clng=measurePts.reduce((s,p)=>s+p.lng,0)/measurePts.length;
    L.popup({closeOnClick:false,autoClose:false})
      .setLatLng([clat,clng])
      .setContent(`<div style="text-align:center;font-size:16px;font-weight:bold;padding:4px 0">📐 ${aStr}</div><div style="text-align:center;font-size:11px;color:#666">${measurePts.length}頂点</div>`)
      .openOn(map);
    toast(`面積: ${aStr}`,4000);
  } else {
    const dStr=fmtDist(totalDist(measurePts));
    const mid=measurePts[Math.floor(measurePts.length/2)];
    L.popup({closeOnClick:false,autoClose:false})
      .setLatLng(mid)
      .setContent(`<div style="text-align:center;font-size:16px;font-weight:bold;padding:4px 0">📏 ${dStr}</div><div style="text-align:center;font-size:11px;color:#666">${measurePts.length-1}区間 / ${measurePts.length}点</div>`)
      .openOn(map);
    toast(`距離: ${dStr}`,4000);
  }
  updateMeasureUI();
  closeSheet();
};

// ── クリア ────────────────────────────────────
document.getElementById('btnMeasureClear').onclick=()=>{
  measuring='';
  measurePts=[]; measureGroup.clearLayers(); measurePoly=null;
  map.closePopup();
  updateMeasureUI();
  toast('計測をクリアしました');
  closeSheet();
};
updateMeasureUI();

/* =========================
   スケールバー
========================= */
L.control.scale({imperial:false, position:'bottomright'}).addTo(map);

/* =========================
   初期レイアウト適用
========================= */
applyLayout();

/* =========================
   天気ダッシュボード
========================= */
const WX_CODE={
  0:['☀️','快晴'],1:['🌤','晴れ'],2:['⛅','晴れ時々曇り'],3:['☁️','曇り'],
  45:['🌫','霧'],48:['🌫','霧'],51:['🌦','霧雨'],53:['🌦','霧雨'],55:['🌦','霧雨'],
  61:['🌧','雨'],63:['🌧','雨'],65:['🌧','大雨'],
  71:['🌨','雪'],73:['🌨','雪'],75:['🌨','大雪'],77:['🌨','霧雪'],
  80:['🌦','にわか雨'],81:['🌦','にわか雨'],82:['🌧','激しいにわか雨'],
  85:['🌨','にわか雪'],86:['🌨','にわか雪'],
  95:['⛈','雷雨'],96:['⛈','激しい雷雨'],99:['⛈','激しい雷雨']
};

const wxPanel=document.getElementById('wxPanel');
let wxOpen=false;

/* 都道府県コード → 気象庁予報オフィスコード */
const PREF_TO_JMA={
  '01':'016000','02':'020000','03':'030000','04':'040000','05':'050000',
  '06':'060000','07':'070000','08':'080000','09':'090000','10':'100000',
  '11':'110000','12':'120000','13':'130000','14':'140000','15':'150000',
  '16':'160000','17':'170000','18':'180000','19':'190000','20':'200000',
  '21':'210000','22':'220000','23':'230000','24':'240000','25':'250000',
  '26':'260000','27':'270000','28':'280000','29':'290000','30':'300000',
  '31':'310000','32':'320000','33':'330000','34':'340000','35':'350000',
  '36':'360000','37':'370000','38':'380000','39':'390000','40':'400000',
  '41':'410000','42':'420000','43':'430000','44':'440000','45':'450000',
  '46':'460100','47':'471000'
};
function jmaCodeIcon(code){
  const n=parseInt(code)||0;
  if(n>=100&&n<200) return '☀️';
  if(n>=200&&n<300) return '⛅';
  if(n>=300&&n<400) return '🌧';
  if(n>=400&&n<500) return '🌧';
  if(n>=500&&n<600) return '❄️';
  if(n>=600&&n<700) return '🌧';
  if(n>=700&&n<800) return '🌨';
  return '🌡';
}
async function getJMAAreaCode(lat,lng){
  const res=await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`);
  const data=await res.json();
  const muniCd=data.results?.muniCd;
  if(!muniCd) throw new Error('地域コード取得失敗');
  return PREF_TO_JMA[String(muniCd).padStart(5,'0').slice(0,2)]||'130000';
}
let _jmaForecast=null;
let _amedasCurrentTemp=null, _amedasCurrentTime=null, _amedasMorningTemp=null;

/* AMeDAS */
const WIND_DIR=['静穏','北北東','北東','東北東','東','東南東','南東','南南東','南','南南西','南西','西南西','西','西北西','北西','北北西','北'];
let _currentAmedasStation=null;

function showAmedasDetail(s){
  _currentAmedasStation=s;
  document.getElementById('wxAmedasLoading').style.display='none';
  const sec=document.getElementById('wxAmedasSection'); sec.style.display='flex';
  document.getElementById('amStationName').textContent=s.info.kjName||s.code;
  const dist=s.dist>=1000?`${(s.dist/1000).toFixed(1)}km`:`${Math.round(s.dist)}m`;
  document.getElementById('amDistBadge').textContent=`現在地から約 ${dist}`;
  const tv=s.d.temp?s.d.temp[0]:null;
  _amedasCurrentTemp=tv; _amedasCurrentTime=new Date();
  const tempEl=document.getElementById('amTemp');
  tempEl.textContent=tv!==null?`${tv}°C`:'--';
  tempEl.className='val'+(tv===null?'':tv>=30?' t-hot':tv>=25?' t-warm':tv<=5?' t-cold':tv<=15?' t-cool':'');
  document.getElementById('amHumid').textContent=s.d.humidity?`${s.d.humidity[0]}%`:'--';
  const r1h=s.d.precipitation1h?s.d.precipitation1h[0]:null;
  const rain1El=document.getElementById('amCellRain1h');
  document.getElementById('amRain1h').textContent=r1h!==null?`${r1h}mm`:'--';
  rain1El.className='am-cell'+(r1h!==null&&r1h>=10?' rain-alert':'');
  document.getElementById('amRain10m').textContent=s.d.precipitation10m?`${s.d.precipitation10m[0]}mm`:'--';
  document.getElementById('amRain24h').textContent=s.d.precipitation24h?`${s.d.precipitation24h[0]}mm`:'--';
  document.getElementById('amWind').textContent=s.d.wind?`${s.d.wind[0]}m/s`:'--';
  document.getElementById('amWindDir').textContent=s.d.windDirection?(WIND_DIR[s.d.windDirection[0]]||'--'):'--';
  document.getElementById('amSnow').textContent=s.d.snow?`${s.d.snow[0]}cm`:'--';
  document.getElementById('amCellTemp').onclick=()=>fetchAmedasChart('temp','過去24時間の気温');
  document.getElementById('amCellHumid').onclick=()=>fetchAmedasChart('humid','過去24時間の湿度');
  document.getElementById('amCellRain1h').onclick=()=>fetchAmedasChart('rain1h','過去24時間の時間雨量');
  document.getElementById('amCellRain10m').onclick=()=>fetchAmedasChart('rain10m','直近6時間の10分雨量');
  document.getElementById('amCellRain24h').onclick=()=>fetchAmedasChart('rain24h','過去24時間の累積雨量');
  document.getElementById('amCellWind').onclick=()=>fetchAmedasChart('wind','過去24時間の風速');
  document.getElementById('amCellWindDir').onclick=()=>fetchAmedasChart('winddir','過去24時間の風向（頻度）');
  document.getElementById('amCellSnow').onclick=()=>fetchAmedasChart('snow','過去24時間の積雪深');
  /* 今朝6時の気温を非同期取得→最低気温セルに反映 */
  (async()=>{
    const jst=new Date(new Date().getTime()+9*3600000);
    const p=n=>String(n).padStart(2,'0');
    const ymd=`${jst.getUTCFullYear()}${p(jst.getUTCMonth()+1)}${p(jst.getUTCDate())}`;
    try{
      const r=await fetch(`https://www.jma.go.jp/bosai/amedas/data/point/${s.code}/${ymd}_06.json`);
      if(!r.ok) return;
      const data=await r.json();
      const key=Object.keys(data).sort().find(k=>k.slice(8,10)==='06'&&parseInt(k.slice(10,12))<=10);
      const t=key&&data[key].temp?data[key].temp[0]:null;
      if(t===null) return;
      _amedasMorningTemp=t;
      const humEl=document.getElementById('wxHumid');
      /* JMAの最低気温がない(--表示)ときだけ朝6時で補完 */
      if(humEl&&humEl.textContent==='--'){
        humEl.textContent=`${t}°C`;
        humEl.className='val'+(t>=30?' t-hot':t>=25?' t-warm':t<=5?' t-cold':t<=15?' t-cool':'');
        const lbl=document.getElementById('wxCellHumid').querySelector('.lbl');
        if(lbl) lbl.textContent='🌅 今朝6時';
        /* wxTemp の最低部分も更新 */
        const tEl=document.getElementById('wxTemp');
        if(tEl) tEl.textContent=tEl.textContent.replace('↓--°','↓'+t+'°');
      }
    }catch{}
  })();
}

async function fetchAmedasForLocation(lat,lng){
  document.getElementById('wxAmedasLoading').style.display='block';
  document.getElementById('wxAmedasSection').style.display='none';
  try{
    const timeRes=await fetch('https://www.jma.go.jp/bosai/amedas/data/latest_time.txt');
    if(!timeRes.ok) throw new Error(`latest_time HTTP ${timeRes.status}`);
    const rawTime=(await timeRes.text()).trim();
    const tm=rawTime.match(/(\d{4})\D(\d{2})\D(\d{2})\D(\d{2}):(\d{2}):(\d{2})/);
    if(!tm) throw new Error('time parse failed');
    const timeStr=`${tm[1]}${tm[2]}${tm[3]}${tm[4]}${tm[5]}${tm[6]}`;
    if(!_amedasTable){
      const tRes=await fetch('https://www.jma.go.jp/bosai/amedas/const/amedastable.json');
      _amedasTable=await tRes.json();
    }
    const dataRes=await fetch(`https://www.jma.go.jp/bosai/amedas/data/map/${timeStr}.json`);
    if(!dataRes.ok) throw new Error(`map data HTTP ${dataRes.status}`);
    const data=await dataRes.json();
    const ref=L.latLng(lat,lng);
    const nearest=Object.entries(data).map(([code,d])=>{
      const info=_amedasTable[code];
      if(!info||!Array.isArray(info.lat)) return null;
      const slat=info.lat[0]+info.lat[1]/60, slng=info.lon[0]+info.lon[1]/60;
      if(isNaN(slat)||isNaN(slng)) return null;
      return {code,info,d,lat:slat,lng:slng,dist:map.distance(ref,L.latLng(slat,slng))};
    }).filter(s=>s).sort((a,b)=>a.dist-b.dist)[0];
    if(nearest) showAmedasDetail(nearest);
    else throw new Error('観測点が見つかりません');
  }catch(e){
    console.error('[AMeDAS loc]',e);
    document.getElementById('wxAmedasLoading').textContent=`❌ AMeDAS: ${e.message}`;
  }
}

const AM_CHART_VARS={
  rain1h:  {field:'precipitation10m',agg:'hourly', idx:0,col:'rgba(0,102,255,0.55)',type:'bar', files:8},
  rain10m: {field:'precipitation10m',agg:'raw10m', idx:0,col:'rgba(0,160,200,0.7)', type:'bar', files:2},
  rain24h: {field:'precipitation10m',agg:'cumsum', idx:0,col:'rgba(0,60,180,0.75)', type:'line',files:8},
  temp:    {field:'temp',            agg:'last',   idx:0,col:'rgba(255,100,0,0.8)', type:'line',files:8},
  humid:   {field:'humidity',        agg:'last',   idx:0,col:'rgba(0,160,200,0.8)',type:'line',files:8},
  wind:    {field:'wind',            agg:'avg',    idx:0,col:'rgba(80,180,0,0.8)', type:'line',files:8},
  winddir: {field:'windDirection',   agg:'dir_hist',idx:0,col:'rgba(150,100,220,0.7)',type:'bar',files:8},
  snow:    {field:'snow',            agg:'last',   idx:0,col:'rgba(150,200,255,0.7)',type:'bar',files:8},
};

function getFileList(count=8){
  const now=new Date(), jst=new Date(now.getTime()+9*3600000);
  const latestH3=Math.floor(jst.getUTCHours()/3)*3, files=[];
  for(let i=count-1;i>=0;i--){
    const d=new Date(Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth(),jst.getUTCDate(),latestH3-i*3,0,0));
    files.push({ymd:`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`,hh:String(d.getUTCHours()).padStart(2,'0')});
  }
  return files;
}

async function fetchAmedasChart(varKey,title){
  const cfg=AM_CHART_VARS[varKey];
  if(!cfg||!_currentAmedasStation) return;
  const w=openChartWindow(title);
  try{
    const code=_currentAmedasStation.code;
    const results=await Promise.all(getFileList(cfg.files).map(async({ymd,hh})=>{
      try{ const r=await fetch(`https://www.jma.go.jp/bosai/amedas/data/point/${code}/${ymd}_${hh}.json`); return r.ok?await r.json():null; }catch{ return null; }
    }));
    if(cfg.agg==='dir_hist'){
      const freq=new Array(17).fill(0);
      results.forEach(data=>{ if(!data) return; Object.values(data).forEach(d=>{ const raw=d[cfg.field]; const v=raw?raw[cfg.idx]:null; if(v!==null&&v!==undefined) freq[v]=(freq[v]||0)+1; }); });
      const freqLabels=WIND_DIR.slice(1).concat(['静穏']);
      const freqData=freq.slice(1).concat([freq[0]]);
      w.setChart(freqLabels,[{data:freqData,type:'bar',backgroundColor:cfg.col,borderColor:cfg.col,borderWidth:1}],'気象庁 AMeDAS');
      return;
    }
    if(cfg.agg==='raw10m'){
      const entries=[];
      results.forEach(data=>{ if(!data) return; Object.entries(data).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([ts,d])=>{ const raw=d[cfg.field]; const v=raw?raw[cfg.idx]:null; if(v===null||v===undefined||v<0) return; entries.push({label:`${ts.slice(8,10)}:${ts.slice(10,12)}`,v:Math.round(v*10)/10}); }); });
      w.setChart(entries.map(e=>e.label),[{data:entries.map(e=>e.v),type:'bar',backgroundColor:cfg.col,borderColor:cfg.col,borderWidth:1}],'気象庁 AMeDAS');
      return;
    }
    const hourly={},cnt={};
    results.forEach(data=>{ if(!data) return; Object.entries(data).forEach(([ts,d])=>{ const raw=d[cfg.field]; const v=raw?raw[cfg.idx]:null; if(v===null||v===undefined||v<0) return; const hh=ts.slice(8,10); if(cfg.agg==='hourly'||cfg.agg==='cumsum'){ hourly[hh]=(hourly[hh]||0)+v; } else if(cfg.agg==='avg'){ hourly[hh]=(hourly[hh]||0)+v; cnt[hh]=(cnt[hh]||0)+1; } else { hourly[hh]=v; } }); });
    if(cfg.agg==='avg') Object.keys(hourly).forEach(h=>{ if(cnt[h]) hourly[h]=Math.round(hourly[h]/cnt[h]*10)/10; });
    const jst=new Date(new Date().getTime()+9*3600000), curH=jst.getUTCHours();
    const labels=[],vals=[]; let cumul=0;
    for(let i=23;i>=0;i--){ const h=((curH-i)+24)%24; labels.push(`${h}時`); const v=hourly[String(h).padStart(2,'0')]; const rounded=v!==undefined?Math.round(v*10)/10:null; if(cfg.agg==='cumsum'){ if(rounded!==null) cumul=Math.round((cumul+rounded)*10)/10; vals.push(cumul); } else { vals.push(rounded); } }
    w.setChart(labels,[{data:vals,type:cfg.type,backgroundColor:cfg.col,borderColor:cfg.col,borderWidth:2,fill:cfg.agg==='cumsum',tension:0.3,pointRadius:2,spanGaps:true}],'気象庁 AMeDAS');
  }catch(e){ console.error('[AmedasChart]',e); w.setError(e.message); }
}

/* チャートボトムシート */
let _cwCounter=0;
const _charts=new Map();
let _activeChartId=null, _sheetChart=null;

/* PC/スマホ自動判定（768px未満をスマホ扱い） */
function openChartWindow(title){
  return window.innerWidth < 768 ? _openChartSheet(title) : _openChartFloat(title);
}

/* ── スマホ: ボトムシート＋チップ ── */
function _openChartSheet(title){
  _cwCounter++;
  const id=`c${_cwCounter}`;
  _charts.set(id,{title,labels:null,datasets:null,source:null,error:null});
  const chips=document.getElementById('chartChips');
  const chip=document.createElement('div');
  chip.className='chart-chip'; chip.id=`chip-${id}`;
  chip.innerHTML=`<span class="chip-lbl">${title}</span><button class="chip-cls">✕</button>`;
  chip.querySelector('.chip-lbl').onclick=()=>activateChart(id);
  chip.querySelector('.chip-cls').onclick=e=>{ e.stopPropagation(); removeChart(id); };
  chips.appendChild(chip); chips.style.display='flex';
  setTimeout(()=>chip.scrollIntoView({behavior:'smooth',block:'nearest',inline:'end'}),50);
  activateChart(id);
  return {
    setChart(labels,datasets,source,yOpts={}){ const c=_charts.get(id); if(!c) return; Object.assign(c,{labels,datasets,source,yOpts}); if(_activeChartId===id) renderSheet(); },
    setError(msg){ const c=_charts.get(id); if(!c) return; c.error=msg; if(_activeChartId===id) renderSheet(); }
  };
}

/* ── PC: フローティングウィンドウ ── */
function _openChartFloat(title){
  _cwCounter++;
  const offset=(_cwCounter-1)%6;
  const win=document.createElement('div');
  win.className='cw-win';
  const pr=wxPanel.getBoundingClientRect();
  const cx=Math.min(pr.right+10+offset*16, window.innerWidth-310);
  const cy=Math.max(pr.top+offset*26, 10);
  win.style.cssText=`top:${cy}px;left:${cx}px;z-index:${9200+_cwCounter};`;
  win.innerHTML=`<div class="cw-handle"><span class="cw-title">${title}</span><button class="cw-close">✕</button></div>`
    +`<div class="cw-body"><div class="cw-loading">取得中...</div><canvas class="cw-canvas" height="110" style="display:none;"></canvas><div class="cw-source"></div></div>`;
  document.body.appendChild(win);
  win.addEventListener('pointerdown',()=>{ win.style.zIndex=9200+(++_cwCounter); });
  win.querySelector('.cw-close').addEventListener('click',e=>{ e.stopPropagation(); if(chart) chart.destroy(); win.remove(); });
  let chart=null, drag=null;
  const handle=win.querySelector('.cw-handle');
  handle.addEventListener('mousedown',e=>{
    if(e.target===win.querySelector('.cw-close')) return;
    const r=win.getBoundingClientRect(); drag={ox:e.clientX-r.left,oy:e.clientY-r.top}; handle.style.cursor='grabbing';
  });
  document.addEventListener('mousemove',e=>{ if(!drag) return; let x=e.clientX-drag.ox,y=e.clientY-drag.oy; x=Math.max(0,Math.min(window.innerWidth-win.offsetWidth,x)); y=Math.max(0,Math.min(window.innerHeight-win.offsetHeight,y)); win.style.left=x+'px'; win.style.top=y+'px'; });
  document.addEventListener('mouseup',()=>{ drag=null; handle.style.cursor='grab'; });
  return {
    setChart(labels,datasets,source,yOpts={}){
      win.querySelector('.cw-loading').style.display='none';
      const canvas=win.querySelector('.cw-canvas'); canvas.style.display='block';
      if(source) win.querySelector('.cw-source').textContent=`出典: ${source}`;
      if(chart) chart.destroy();
      const type=datasets[0].type||'bar';
      const yAxis={beginAtZero:yOpts.beginAtZero!==false,ticks:{font:{size:9},maxTicksLimit:5},grid:{color:'rgba(0,0,0,0.06)'}};
      if(yOpts.min!==undefined) yAxis.min=yOpts.min; if(yOpts.max!==undefined) yAxis.max=yOpts.max;
      chart=new Chart(canvas,{type,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:datasets.length>1}},scales:{x:{ticks:{font:{size:8},maxTicksLimit:8},grid:{display:false}},y:yAxis}}});
    },
    setError(msg){ win.querySelector('.cw-loading').textContent=`❌ ${msg}`; }
  };
}
function activateChart(id){
  _activeChartId=id;
  document.querySelectorAll('.chart-chip').forEach(c=>c.classList.remove('active'));
  const chip=document.getElementById(`chip-${id}`); if(chip) chip.classList.add('active');
  document.getElementById('chartSheet').classList.add('open');
  document.getElementById('chartChips').classList.add('sheet-open');
  renderSheet();
}
function renderSheet(){
  const c=_charts.get(_activeChartId); if(!c) return;
  document.getElementById('chartSheetTitle').textContent=c.title;
  const loading=document.getElementById('chartSheetLoading'), canvas=document.getElementById('chartSheetCanvas'), src=document.getElementById('chartSheetSrc');
  if(c.error){ loading.textContent=`❌ ${c.error}`; loading.style.display='block'; canvas.style.display='none'; }
  else if(!c.labels){ loading.textContent='取得中...'; loading.style.display='block'; canvas.style.display='none'; }
  else{
    loading.style.display='none'; canvas.style.display='block';
    src.textContent=c.source?`出典: ${c.source}`:'';
    if(_sheetChart){ _sheetChart.destroy(); _sheetChart=null; }
    const type=c.datasets[0].type||'bar';
    const yo=c.yOpts||{}; const yAxis={beginAtZero:yo.beginAtZero!==false,ticks:{font:{size:10},maxTicksLimit:5},grid:{color:'rgba(0,0,0,0.06)'}};
    if(yo.min!==undefined) yAxis.min=yo.min; if(yo.max!==undefined) yAxis.max=yo.max;
    _sheetChart=new Chart(canvas,{type,data:{labels:c.labels,datasets:c.datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:c.datasets.length>1,labels:{font:{size:10}}}},scales:{x:{ticks:{font:{size:9},maxTicksLimit:12},grid:{display:false}},y:yAxis}}});
  }
}
function removeChart(id){
  if(_sheetChart&&_activeChartId===id){ _sheetChart.destroy(); _sheetChart=null; }
  _charts.delete(id);
  const chip=document.getElementById(`chip-${id}`); if(chip) chip.remove();
  if(_activeChartId===id){ const r=[..._charts.keys()]; if(r.length>0) activateChart(r[r.length-1]); else{ document.getElementById('chartSheet').classList.remove('open'); _activeChartId=null; } }
  if(_charts.size===0){ const ch=document.getElementById('chartChips'); ch.style.display='none'; ch.classList.remove('sheet-open'); }
}
function closeChartSheet(){
  document.getElementById('chartSheet').classList.remove('open');
  document.getElementById('chartChips').classList.remove('sheet-open');
  _activeChartId=null;
  document.querySelectorAll('.chart-chip').forEach(c=>c.classList.remove('active'));
}
document.getElementById('chartSheetClose').onclick=closeChartSheet;
(()=>{
  const sheet=document.getElementById('chartSheet'), handle=document.getElementById('chartSheetHandle');
  let startY=null;
  handle.addEventListener('touchstart',e=>{ startY=e.touches[0].clientY; sheet.style.transition='none'; },{passive:true});
  handle.addEventListener('touchmove',e=>{ if(startY===null) return; const dy=e.touches[0].clientY-startY; if(dy>0) sheet.style.transform=`translateY(${dy}px)`; },{passive:true});
  handle.addEventListener('touchend',e=>{ const dy=e.changedTouches[0].clientY-startY; sheet.style.transition=''; sheet.style.transform=''; if(dy>80) closeChartSheet(); startY=null; },{passive:true});
})();

function showJmaPOPChart(title){
  const w=openChartWindow(title||'降水確率');
  if(!_jmaForecast){ w.setError('データなし'); return; }
  try{
    const ts1=_jmaForecast[0].timeSeries[1];
    const labels=ts1.timeDefines.map(t=>{ const d=new Date(t); const jh=d.getUTCHours()+9; const jd=new Date(d.getTime()+9*3600000); return `${jd.getUTCMonth()+1}/${jd.getUTCDate()} ${String(jh%24).padStart(2,'0')}時`; });
    w.setChart(labels,[{data:ts1.areas[0].pops.map(p=>p===''?null:Number(p)),type:'bar',backgroundColor:'rgba(0,102,255,0.55)',borderColor:'rgba(0,102,255,0.8)',borderWidth:1}],'気象庁');
  }catch(e){ w.setError(e.message); }
}
function _jmaTempLabels(timeDefines){
  const DOW=['日','月','火','水','木','金','土'];
  return timeDefines.map(t=>{ const jd=new Date(new Date(t).getTime()+9*3600000); const h=jd.getUTCHours(); return `${jd.getUTCMonth()+1}/${jd.getUTCDate()}(${DOW[jd.getUTCDay()]})${h>0?' '+h+'時':''}`; });
}
function _compColors(arr,upCol,downCol,baseCol){
  return arr.map((v,i)=>{ if(v===null) return 'rgba(200,200,200,0.3)'; if(i===0) return baseCol; const prev=arr.slice(0,i).reverse().find(x=>x!==null); return prev===undefined?baseCol:v>prev?upCol:v<prev?downCol:baseCol; });
}
function _prependCurrent(labels,data){
  if(_amedasCurrentTemp===null) return {labels,data};
  const now=_amedasCurrentTime||new Date(); const p=n=>String(n).padStart(2,'0');
  return {labels:[`現在\n${p(now.getHours())}:${p(now.getMinutes())}`,...labels], data:[_amedasCurrentTemp,...data]};
}
function showJmaMaxTempChart(){
  const w=openChartWindow('最高気温の今後の推移');
  if(!_jmaForecast){ w.setError('データなし'); return; }
  try{
    const ts2=_jmaForecast[0].timeSeries[2], area=ts2.areas[0];
    const r=_prependCurrent(_jmaTempLabels(ts2.timeDefines),(area.tempsMax||area.temps||[]).map(v=>v===''?null:Number(v)));
    const bg=_compColors(r.data,'rgba(220,50,0,0.7)','rgba(0,80,220,0.7)','rgba(180,100,0,0.6)');
    const bd=_compColors(r.data,'rgba(220,50,0,1)','rgba(0,80,220,1)','rgba(180,100,0,1)');
    w.setChart(r.labels,[{label:'最高気温(°C)',data:r.data,type:'bar',backgroundColor:bg,borderColor:bd,borderWidth:1}],'気象庁',{beginAtZero:false});
  }catch(e){ w.setError(e.message); }
}
function showJmaMinTempChart(){
  const hasMin=_jmaForecast&&(_jmaForecast[0].timeSeries[2].areas[0].tempsMin||[]).some(v=>v!=='');
  if(hasMin){
    const w=openChartWindow('最低気温の今後の推移');
    try{
      const ts2=_jmaForecast[0].timeSeries[2], area=ts2.areas[0];
      const r=_prependCurrent(_jmaTempLabels(ts2.timeDefines),(area.tempsMin||[]).map(v=>v===''?null:Number(v)));
      const bg=_compColors(r.data,'rgba(220,50,0,0.7)','rgba(0,80,220,0.7)','rgba(0,100,200,0.6)');
      const bd=_compColors(r.data,'rgba(220,50,0,1)','rgba(0,80,220,1)','rgba(0,100,200,1)');
      w.setChart(r.labels,[{label:'最低気温(°C)',data:r.data,type:'bar',backgroundColor:bg,borderColor:bd,borderWidth:1}],'気象庁',{beginAtZero:false});
    }catch(e){ w.setError(e.message); }
  } else {
    showMorning6AMChart();
  }
}
async function showMorning6AMChart(){
  const w=openChartWindow('朝6時の気温（最低気温の参考）');
  if(!_currentAmedasStation){ w.setError('AMeDASデータなし'); return; }
  const code=_currentAmedasStation.code;
  const p=n=>String(n).padStart(2,'0');
  const DOW=['日','月','火','水','木','金','土'];
  const labels=[], temps=[];
  for(let i=2;i>=0;i--){
    const jst=new Date(new Date().getTime()+9*3600000-i*86400000);
    const ymd=`${jst.getUTCFullYear()}${p(jst.getUTCMonth()+1)}${p(jst.getUTCDate())}`;
    labels.push(`${jst.getUTCMonth()+1}/${jst.getUTCDate()}(${DOW[jst.getUTCDay()]}) 6時`);
    try{
      const r=await fetch(`https://www.jma.go.jp/bosai/amedas/data/point/${code}/${ymd}_06.json`);
      if(!r.ok){ temps.push(null); continue; }
      const data=await r.json();
      const key=Object.keys(data).sort().find(k=>k.slice(8,10)==='06'&&parseInt(k.slice(10,12))<=10);
      temps.push(key&&data[key].temp?data[key].temp[0]:null);
    }catch{ temps.push(null); }
  }
  const bg=_compColors(temps,'rgba(220,50,0,0.7)','rgba(0,80,220,0.7)','rgba(0,100,200,0.6)');
  const bd=_compColors(temps,'rgba(220,50,0,1)','rgba(0,80,220,1)','rgba(0,100,200,1)');
  w.setChart(labels,[{label:'朝6時の気温(°C)',data:temps,type:'bar',backgroundColor:bg,borderColor:bd,borderWidth:1}],'気象庁 AMeDAS',{beginAtZero:false});
}
function showForecastChart(field,title){
  if(field==='pop') showJmaPOPChart(title);
  else if(field==='tempmax') showJmaMaxTempChart();
  else if(field==='tempmin') showJmaMinTempChart();
  else{ showJmaMaxTempChart(); showJmaMinTempChart(); }
}

function jmaTime(intervalMin=5,lagMin=5){
  const now=new Date(), jst=new Date(now.getTime()+9*3600000);
  const total=jst.getUTCHours()*60+jst.getUTCMinutes();
  const floored=Math.floor(total/intervalMin)*intervalMin-lagMin;
  const d=new Date(Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth(),jst.getUTCDate(),0,floored,0));
  const p=n=>String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}

const WX_LAYER_DEFS={
  rain: {type:'nowc',zoom:10,tf:['targetTimes_N1.json'],url:(bt,vt)=>`https://www.jma.go.jp/bosai/jmatile/data/nowc/${bt}/none/${vt}/surf/hrpns/{z}/{x}/{y}.png`},
};
const wxLayerState={};
Object.keys(WX_LAYER_DEFS).forEach(k=>{ wxLayerState[k]={on:false,layer:null,timer:null,errCount:0}; });
const WX_CHK_MAP={rain:'chkLRain'};
const WX_LBL_MAP={rain:'lblLRain'};

async function getJmaValidTime(type,candidates){
  for(const file of (candidates||['targetTimes_N1.json'])){
    try{
      const res=await fetch(`https://www.jma.go.jp/bosai/jmatile/data/${type}/${file}`,{cache:'no-store'});
      if(!res.ok) continue;
      const arr=await res.json();
      if(!Array.isArray(arr)||!arr.length) continue;
      const last=arr[arr.length-1];
      if(typeof last==='string') return {basetime:last,validtime:last};
      const bt=last.basetime||last.time||'';
      const vt=last.validtime||bt;
      if(bt) return {basetime:bt,validtime:vt};
    }catch(e){}
  }
  return null;
}

async function wxUpdateLayer(key){
  const def=WX_LAYER_DEFS[key], st=wxLayerState[key];
  if(!st.on) return;
  const times=await getJmaValidTime(def.type,def.tf);
  const t=jmaTime(5,10);
  const urlTpl=times?def.url(times.basetime,times.validtime):def.url(t,t);
  if(st.layer) map.removeLayer(st.layer);
  st.errCount=0;
  const lbl=document.getElementById(WX_LBL_MAP[key]);
  const lyr=L.tileLayer(urlTpl,{opacity:0.6,maxNativeZoom:def.zoom,maxZoom:25,attribution:'© 気象庁'});
  lyr.on('tileerror',()=>{
    st.errCount++;
    if(st.errCount===3&&lbl) lbl.style.borderColor='#ff3b30';
  });
  lyr.on('tileload',()=>{ st.errCount=0; if(lbl) lbl.style.borderColor=''; });
  st.layer=lyr.addTo(map);
}

async function wxApplyLayerState(key){
  const st=wxLayerState[key];
  const lbl=document.getElementById(WX_LBL_MAP[key]);
  if(lbl) lbl.classList.toggle('active',st.on);
  if(st.on){
    await wxUpdateLayer(key);
    if(!st.timer) st.timer=setInterval(()=>wxUpdateLayer(key),5*60*1000);
  } else {
    clearInterval(st.timer); st.timer=null;
    if(st.layer){ map.removeLayer(st.layer); st.layer=null; }
  }
}

Object.keys(WX_CHK_MAP).forEach(key=>{
  document.getElementById(WX_CHK_MAP[key]).addEventListener('change',function(){
    wxLayerState[key].on=this.checked;
    wxApplyLayerState(key);
  });
});

/* ─── 雨雲アニメーション（降水ナウキャスト 5分×13コマ） ─── */
const _rainAnim={on:false,basetime:'',frames:[],idx:0,layer:null,frameTimer:null,refreshTimer:null};

function _parseJmaTime(t){
  if(!t||t.length<12) return 0;
  return Date.UTC(+t.slice(0,4),+t.slice(4,6)-1,+t.slice(6,8),+t.slice(8,10),+t.slice(10,12));
}
function _fmtJmaTime(ms){
  const d=new Date(ms), p=n=>String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}

async function _startRainAnim(){
  const status=document.getElementById('rainAnimStatus');
  const lbl=document.getElementById('lblLRainAnim');
  status.textContent='🌀 取得中...'; status.style.display='block';
  try{
    /* targetTimes_N1.json で最新 basetime を取得し、+5min×12コマの forecast を生成 */
    const res=await fetch('https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json',{cache:'no-store'});
    if(!res.ok) throw new Error(`targetTimes HTTP ${res.status}`);
    const arr=await res.json();
    if(!Array.isArray(arr)||!arr.length) throw new Error('フレームなし');
    /* arr は新→旧順。最新 basetime を取得 */
    const latest=arr[0];
    const latestBt=typeof latest==='string'?latest:(latest.basetime||latest.validtime);
    const btMs=_parseJmaTime(latestBt);
    /* 過去コマ（旧→新の時系列、最大12コマ=60min分）*/
    const obsFrames=arr.slice(0,12).map(e=>{
      const t=typeof e==='string'?e:(e.basetime||e.validtime);
      return {bt:t,vt:t};
    }).reverse();
    /* 予測コマ（+5min〜+60min）*/
    const fcFrames=Array.from({length:12},(_,i)=>({bt:latestBt,vt:_fmtJmaTime(btMs+(i+1)*5*60000)}));
    _rainAnim.frames=[...obsFrames,...fcFrames];
    _rainAnim.idx=0;
    if(_rainAnim.frameTimer) clearInterval(_rainAnim.frameTimer);
    _rainAnim.frameTimer=setInterval(_stepRainAnim,1500);
    _stepRainAnim();
    if(lbl) lbl.style.borderColor='';
  }catch(e){
    console.error('[RainAnim]',e);
    status.textContent='❌ 雨雲取得失敗';
    if(lbl) lbl.style.borderColor='#ff3b30';
  }
}

function _stepRainAnim(){
  if(!_rainAnim.on||!_rainAnim.frames.length) return;
  const {bt,vt}=_rainAnim.frames[_rainAnim.idx];
  const url=`https://www.jma.go.jp/bosai/jmatile/data/nowc/${bt}/none/${vt}/surf/hrpns/{z}/{x}/{y}.png`;
  const newLayer=L.tileLayer(url,{opacity:0.65,maxNativeZoom:10,maxZoom:25,attribution:'© 気象庁'});
  newLayer.addTo(map);
  if(_rainAnim.layer) map.removeLayer(_rainAnim.layer);
  _rainAnim.layer=newLayer;
  const status=document.getElementById('rainAnimStatus');
  const bar=document.getElementById('rainAnimBar');
  const diffMin=Math.round((_parseJmaTime(vt)-_parseJmaTime(bt))/60000);
  const jstMs=_parseJmaTime(vt)+9*3600000;
  const jd=new Date(jstMs), p2=n=>String(n).padStart(2,'0');
  const hhmm=`${p2(jd.getUTCHours())}:${p2(jd.getUTCMinutes())}`;
  const txt=diffMin===0?`🌀 ${hhmm} 観測`:`🌀 ${hhmm} (+${diffMin}分 予測)`;
  if(status){ status.textContent=txt; status.style.color=diffMin===0?'#aaa':'#7ec8e3'; }
  if(bar){ bar.textContent=txt; bar.style.color=diffMin===0?'#fff':'#7ec8e3'; bar.style.display='block'; }
  _rainAnim.idx=(_rainAnim.idx+1)%_rainAnim.frames.length;
}

function _stopRainAnim(){
  clearInterval(_rainAnim.frameTimer); _rainAnim.frameTimer=null;
  clearInterval(_rainAnim.refreshTimer); _rainAnim.refreshTimer=null;
  if(_rainAnim.layer){ map.removeLayer(_rainAnim.layer); _rainAnim.layer=null; }
  _rainAnim.frames=[]; _rainAnim.idx=0;
  const status=document.getElementById('rainAnimStatus');
  if(status) status.style.display='none';
  const bar=document.getElementById('rainAnimBar');
  if(bar) bar.style.display='none';
}

document.getElementById('chkLRainAnim').addEventListener('change',function(){
  _rainAnim.on=this.checked;
  document.getElementById('lblLRainAnim').classList.toggle('active',_rainAnim.on);
  if(_rainAnim.on){
    _startRainAnim();
    if(!_rainAnim.refreshTimer) _rainAnim.refreshTimer=setInterval(_startRainAnim,10*60*1000);
  } else {
    _stopRainAnim();
  }
});

/* ─── 危険度メッシュ（長野県 河川砂防情報ステーション KikendoMesh） ─── */
let _kikendoOverlays=[], _kikendoOn=false, _kikendoTimer=null;

async function _loadKikendoMesh(){
  _kikendoOverlays.forEach(ov=>map.removeLayer(ov)); _kikendoOverlays=[];
  const lbl=document.getElementById('lblLKikendo');
  const statusDiv=document.getElementById('wxKikendo');
  statusDiv.style.display='block';
  statusDiv.style.color='#aaa';
  statusDiv.textContent='⚠ 危険度取得中...';
  try{
    const idx=await fetch(`${SABO_GIS}/gisdata/mesh/KikendoMesh.json`,{cache:'no-store'}).then(r=>r.json());
    const latest=idx.latest; /* "2026-06-30-23-40" */
    const parts=latest.split('-'); /* ["2026","06","30","23","40"] */
    const ymd=parts[0]+parts[1]+parts[2];
    const hhmm=parts[3]+parts[4];
    const tilesUrl=`${SABO_GIS}/gisdata/mesh/kikendo/${ymd}/${hhmm}/mesh_tiles.json`;
    const tilesRes=await fetch(tilesUrl,{cache:'no-store'});
    if(!tilesRes.ok){
      statusDiv.textContent='⚠ 危険域なし（平常）';
      if(lbl) lbl.style.borderColor='';
      return;
    }
    const tilesJson=await tilesRes.json();
    const baseUrl=`${SABO_GIS}/gisdata/mesh/kikendo/${ymd}/${hhmm}/`;
    for(const tile of (tilesJson.tiles||[])){
      const {north,south,east,west}=tile.latLon;
      const ov=L.imageOverlay(baseUrl+tile.file,[[south,west],[north,east]],{opacity:0.7,interactive:false});
      ov.addTo(map);
      _kikendoOverlays.push(ov);
    }
    statusDiv.textContent=`⚠ 危険度メッシュ ${parts[3]}:${parts[4]} 更新 (${_kikendoOverlays.length}タイル)`;
    if(lbl) lbl.style.borderColor='';
  }catch(e){
    console.error('[Kikendo]',e);
    statusDiv.style.color='#ff6b6b';
    statusDiv.textContent='❌ 危険度取得失敗';
    if(lbl) lbl.style.borderColor='#ff3b30';
  }
}

document.getElementById('chkLKikendo').addEventListener('change',function(){
  _kikendoOn=this.checked;
  document.getElementById('lblLKikendo').classList.toggle('active',_kikendoOn);
  if(_kikendoOn){
    _loadKikendoMesh();
    if(!_kikendoTimer) _kikendoTimer=setInterval(_loadKikendoMesh,10*60*1000);
  } else {
    clearInterval(_kikendoTimer); _kikendoTimer=null;
    _kikendoOverlays.forEach(ov=>map.removeLayer(ov)); _kikendoOverlays=[];
    document.getElementById('wxKikendo').style.display='none';
    document.getElementById('lblLKikendo').style.borderColor='';
  }
});

/* アメダス */
let amedasOn=false, amedasMarkers=[], amedasTimer=null, _amedasTable=null;

async function fetchAmedas(){
  const amDiv=document.getElementById('wxAmedas');
  try{
    const timeRes=await fetch('https://www.jma.go.jp/bosai/amedas/data/latest_time.txt');
    if(!timeRes.ok) throw new Error(`latest_time HTTP ${timeRes.status}`);
    const rawTime=(await timeRes.text()).trim();
    const m=rawTime.match(/(\d{4})\D(\d{2})\D(\d{2})\D(\d{2}):(\d{2}):(\d{2})/);
    if(!m) throw new Error(`time parse failed: "${rawTime}"`);
    const timeStr=`${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`;
    if(!_amedasTable){
      const tRes=await fetch('https://www.jma.go.jp/bosai/amedas/const/amedastable.json');
      if(!tRes.ok) throw new Error(`amedastable HTTP ${tRes.status}`);
      _amedasTable=await tRes.json();
    }
    const dataRes=await fetch(`https://www.jma.go.jp/bosai/amedas/data/map/${timeStr}.json`);
    if(!dataRes.ok) throw new Error(`map data HTTP ${dataRes.status}`);
    const data=await dataRes.json();
    amedasMarkers.forEach(mk=>map.removeLayer(mk)); amedasMarkers=[];
    const center=me?me.getLatLng():map.getCenter();
    const stations=Object.entries(data).map(([code,d])=>{
      const info=_amedasTable[code];
      if(!info||!info.lat||!info.lon||!Array.isArray(info.lat)) return null;
      const lat=info.lat[0]+info.lat[1]/60, lng=info.lon[0]+info.lon[1]/60;
      if(isNaN(lat)||isNaN(lng)) return null;
      return {code,info,d,lat,lng,dist:map.distance(center,L.latLng(lat,lng))};
    }).filter(s=>s&&s.dist<60000).sort((a,b)=>a.dist-b.dist).slice(0,15);
    if(!stations.length){ toast('周辺60km以内にアメダス観測点なし',3000); return; }
    stations.forEach(s=>{
      const tv=s.d.temp?s.d.temp[0]:null;
      const temp=tv!==null?`${tv}°C`:'--';
      const rain=s.d.precipitation1h?`${s.d.precipitation1h[0]}mm/h`:(s.d.precipitation10m?`${s.d.precipitation10m[0]}mm/10m`:'--');
      const wind=s.d.wind?`${s.d.wind[0]}m/s`:'--';
      const col=tv===null?'#888':tv>=30?'#c62828':tv>=25?'#e65100':tv>=15?'#1565c0':tv>=5?'#0277bd':'#4a148c';
      const mk=L.marker([s.lat,s.lng],{icon:L.divIcon({
        html:`<div style="background:#fff;color:${col};border:2px solid ${col};border-radius:6px;padding:2px 7px;font-size:13px;font-family:sans-serif;font-weight:bold;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.25)">${temp}</div>`,
        className:'',iconAnchor:[22,12]
      })}).addTo(map);
      mk.bindPopup(`<div style="font-size:12px;font-family:sans-serif"><b>📡 ${s.info.kjName||s.code}</b><br>🌡 ${temp}　🌧 ${rain}　💨 ${wind}</div>`);
      amedasMarkers.push(mk);
    });
    const p=n=>String(n).padStart(2,'0'), now=new Date();
    amDiv.textContent=`📡 アメダス ${stations.length}地点 (${p(now.getHours())}:${p(now.getMinutes())} 更新)`;
    amDiv.style.display='block';
    document.getElementById('lblLAmedas').style.borderColor='';
  }catch(e){
    console.error('[AMeDAS]',e);
    toast(`アメダス取得失敗: ${e.message}`,3500);
    document.getElementById('wxAmedas').textContent=`❌ ${e.message}`;
    document.getElementById('wxAmedas').style.display='block';
    document.getElementById('lblLAmedas').style.borderColor='#ff3b30';
  }
}

document.getElementById('chkLAmedas').addEventListener('change',function(){
  amedasOn=this.checked;
  document.getElementById('lblLAmedas').classList.toggle('active',amedasOn);
  if(amedasOn){ fetchAmedas(); amedasTimer=setInterval(fetchAmedas,10*60*1000); }
  else{ clearInterval(amedasTimer); amedasTimer=null; amedasMarkers.forEach(mk=>map.removeLayer(mk)); amedasMarkers=[]; document.getElementById('wxAmedas').style.display='none'; }
});

/* 天気取得（気象庁API） */
let wxChart=null;
async function fetchWeather(lat,lng){
  document.getElementById('wxLoading').style.display='block';
  document.getElementById('wxLoading').textContent='取得中...';
  document.getElementById('wxContent').style.display='none';
  try{
    const officeCode=await getJMAAreaCode(lat,lng);
    const res=await fetch(`https://www.jma.go.jp/bosai/forecast/data/forecast/${officeCode}.json`);
    if(!res.ok) throw new Error(`気象庁API HTTP ${res.status}`);
    const fc=await res.json();
    _jmaForecast=fc;
    const shortTerm=fc[0];
    const ts0=shortTerm.timeSeries[0], ts1=shortTerm.timeSeries[1], ts2=shortTerm.timeSeries[2];
    const area0=ts0.areas[0];
    const todayCode=area0.weatherCodes?.[0]||'100';
    const _wx=(area0.weathers?.[0]||'').replace(/\s+/g,' ').trim();
    const todayWeather=_wx.length>12?_wx.slice(0,12)+'…':_wx;
    const pops=ts1.areas[0].pops||[];
    const maxPop=pops.filter(p=>p!=='').map(Number).reduce((m,v)=>Math.max(m,v),-1);
    const tempArea=ts2.areas[0];
    const maxArr=tempArea.tempsMax||tempArea.temps||[], minArr=tempArea.tempsMin||[];
    const todayMax=maxArr.find(v=>v!=='')||null, todayMin=minArr.find(v=>v!=='')||null;
    document.getElementById('wxIcon').textContent=jmaCodeIcon(todayCode);
    document.getElementById('wxDesc').textContent=todayWeather||'--';
    document.getElementById('wxTemp').textContent=`↑${todayMax||'--'}° / ↓${todayMin||'--'}°`;
    document.getElementById('wxRain').textContent=maxPop>=0?`${maxPop}%`:'--';
    document.getElementById('wxWind').textContent=todayMax?`${todayMax}°C`:'--';
    document.getElementById('wxHumid').textContent=todayMin?`${todayMin}°C`:'--';
    /* 最低気温ラベルをリセット（再取得時のため） */
    const _lbl=document.getElementById('wxCellHumid').querySelector('.lbl');
    if(_lbl) _lbl.textContent='🌡 最低気温';
    /* 3日間カード */
    const dayCards=document.getElementById('wxDayCards'); dayCards.innerHTML='';
    ['今日','明日','明後日'].forEach((name,i)=>{
      if(i>=(area0.weatherCodes||[]).length) return;
      const code=area0.weatherCodes[i]||'';
      const pop=pops.filter((_,j)=>Math.floor(j/2)===i).filter(p=>p!=='').map(Number);
      const dayMaxPop=pop.length?Math.max(...pop):-1;
      const dMax=maxArr[i]||'', dMin=minArr[i]||'';
      const card=document.createElement('div'); card.className='wx-day-card';
      card.innerHTML=`<div class="dc-day">${name}</div><div class="dc-ico">${jmaCodeIcon(code)}</div>`+(dayMaxPop>=0?`<div class="dc-pop">☔${dayMaxPop}%</div>`:'')+((dMax||dMin)?`<div class="dc-tmp">${dMax?dMax+'°':''} / ${dMin?dMin+'°':''}</div>`:'');
      dayCards.appendChild(card);
    });
    /* タップ → グラフ */
    document.getElementById('wxMain').onclick=()=>{ showJmaMaxTempChart(); showJmaMinTempChart(); };
    document.getElementById('wxCellRain').onclick=()=>showForecastChart('pop','降水確率（3日間）');
    document.getElementById('wxCellWind').onclick=()=>showJmaMaxTempChart();
    document.getElementById('wxCellHumid').onclick=()=>showJmaMinTempChart();
    /* 降水確率ミニチャート */
    const labels=ts1.timeDefines.map(t=>{ const d=new Date(t); return `${String((d.getUTCHours()+9)%24).padStart(2,'0')}時`; });
    if(wxChart) wxChart.destroy();
    wxChart=new Chart(document.getElementById('wxChart'),{type:'bar',data:{labels,datasets:[{label:'降水確率(%)',data:pops.map(p=>p===''?null:Number(p)),backgroundColor:'rgba(0,102,255,0.5)',borderColor:'rgba(0,102,255,0.8)',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:8},maxTicksLimit:8},grid:{display:false}},y:{beginAtZero:true,max:100,ticks:{font:{size:9},maxTicksLimit:4,callback:v=>v+'%'},grid:{color:'rgba(0,0,0,0.06)'}}}}});
    const now=new Date(), p=n=>String(n).padStart(2,'0');
    document.getElementById('wxUpdated').textContent=`${p(now.getHours())}:${p(now.getMinutes())} 更新`;
    document.getElementById('wxLoading').style.display='none';
    document.getElementById('wxContent').style.display='flex';
    fetchAmedasForLocation(lat,lng);
  }catch(e){ console.error('[fetchWeather]',e); document.getElementById('wxLoading').textContent='取得に失敗しました'; }
}

let wxPanelTimer=null;
function openWxPanel(){
  wxOpen=true; wxPanel.style.display='flex';
  document.getElementById('btnWx').classList.add('hi');
  const ll=me?me.getLatLng():map.getCenter();
  fetchWeather(ll.lat,ll.lng);
  closeSheet();
  clearInterval(wxPanelTimer);
  wxPanelTimer=setInterval(()=>{ const l=me?me.getLatLng():map.getCenter(); fetchWeather(l.lat,l.lng); },10*60*1000);
}
function closeWxPanel(){
  wxOpen=false; wxPanel.style.display='none';
  document.getElementById('btnWx').classList.remove('hi');
  clearInterval(wxPanelTimer); wxPanelTimer=null;
}

document.getElementById('btnWx').onclick=()=>{ wxOpen?closeWxPanel():openWxPanel(); };


document.getElementById('wxClose').onclick=closeWxPanel;
document.getElementById('wxRefresh').onclick=()=>{
  const ll=me?me.getLatLng():map.getCenter();
  fetchWeather(ll.lat,ll.lng);
  if(amedasOn) fetchAmedas();
  if(riverOn) fetchRiverData();
  Object.keys(WX_LAYER_DEFS).forEach(k=>{ if(wxLayerState[k].on) wxUpdateLayer(k); });
};

/* ─── 河川水位観測（長野県 河川砂防情報ステーション） ─── */
const SABO_BASE='https://www.sabo-nagano.jp';
const SABO_GIS='https://www.gis.sabo-nagano.jp'; /* GeoJSONはこちら（CORS: * で直接取得可） */
/* CORSプロキシ（複数プロキシを順次試行、429/403はスキップ） */
async function rpFetch(url,opts){
  const proxies=[
    u=>`https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u=>`https://corsproxy.io/?${encodeURIComponent(u)}`,
  ];
  for(const px of proxies){
    try{
      const r=await fetch(px(url),opts||{});
      if(r.status!==429&&r.status!==403) return r;
    }catch{}
  }
  throw new Error('プロキシ接続失敗');
}
let riverOn=false, riverMarkers=[], riverTimer=null;
let _riverGeoLayer=null, _riverGeoJson=null, _riverGeoFetch=null, _riverStageMap={};

async function _loadRiverGeo(){
  if(_riverGeoJson) return _riverGeoJson;
  if(!_riverGeoFetch) _riverGeoFetch=fetch('data/rivers_nagano.geojson').then(r=>{if(!r.ok)throw new Error(`河川GeoJSON ${r.status}`);return r.json();});
  _riverGeoJson=await _riverGeoFetch;
  return _riverGeoJson;
}

function _renderRiverLines(){
  if(_riverGeoLayer){ map.removeLayer(_riverGeoLayer); _riverGeoLayer=null; }
  if(!riverOn) return;
  _loadRiverGeo().then(gj=>{
    _riverGeoLayer=L.geoJSON(gj,{
      style:feat=>{
        const name=feat.properties.name;
        const stage=_riverStageMap[name];
        if(stage==null||stage<0) return {color:'#2e7d32',weight:2,opacity:0.45};
        return {color:_stageColor(stage),weight:stage>=2?4:3,opacity:0.65};
      }
    }).addTo(map);
    _riverGeoLayer.bringToBack();
  }).catch(e=>console.error('[RiverLines]',e));
}
const STAGE_COL={'-3':'#888','-2':'#888','-1':'#888','0':'#2e7d32','1':'#f9a825','2':'#e65100','3':'#c62828','4':'#6a0080'};

function _stageColor(level){ return STAGE_COL[String(level)]||'#888'; }
function _stageLabel(level){ return(['平水','待機','注意','避難','危険'][level]||''); }

async function fetchRiverData(){
  riverMarkers.forEach(mk=>map.removeLayer(mk)); riverMarkers=[];
  const div=document.getElementById('wxRiver');
  const lbl=document.getElementById('lblLRiverLevel');
  div.style.color='#aaa';
  div.textContent='💧 水位データ取得中...';
  div.style.display='block';
  try{
    /* 座標・観測所名・現在水位がすべて1ファイルに含まれる（CORS: * で直接取得） */
    const r=await fetch(`${SABO_GIS}/gisdata/river/SuiiPoint.geo.json`,{cache:'no-store'});
    if(!r.ok) throw new Error(`GeoJSON HTTP ${r.status}`);
    const gj=await r.json();

    /* 全ステーションから河川ステージマップを構築（表示範囲外も含む） */
    _riverStageMap={};
    for(const feat of (gj.features||[])){
      const rv=feat.properties?.rv;
      const level=feat.properties?.data?.item_10?.level??-1;
      if(!rv) continue;
      if(_riverStageMap[rv]==null||level>_riverStageMap[rv]) _riverStageMap[rv]=level;
    }
    _renderRiverLines();

    const b=map.getBounds();
    let count=0;
    for(const feat of (gj.features||[])){
      const c=feat.geometry?.coordinates;
      if(!c) continue;
      const lng=c[0], lat=c[1];
      if(!b.contains([lat,lng])) continue;
      const props=feat.properties||{};
      const key=props.id;
      if(!key) continue;
      const sd=props.data;                   /* 現在水位データ（GeoJSON内に埋め込み） */
      const level=sd?.item_10?.level??-1;
      const value=sd?.item_10?.value;
      const obsTime=sd?.time;                /* "2026-06-30-20-40" */
      const col=_stageColor(level);
      const levelStr=value!=null?`${Number(value).toFixed(2)}m`:'--';
      const name=props.nm||key;
      const river=props.rv||'';
      const timeStr=obsTime?`${obsTime.slice(11,13)}:${obsTime.slice(14,16)}`:'';

      const mk=L.marker([lat,lng],{icon:L.divIcon({
        html:`<div style="background:#fff;color:${col};border:2px solid ${col};border-radius:6px;padding:2px 6px;font-size:11px;font-family:sans-serif;font-weight:bold;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.25)">${levelStr}</div>`,
        className:'',iconAnchor:[20,12]
      })}).addTo(map);

      const pDiv=document.createElement('div');
      pDiv.style.cssText='font-size:12px;font-family:sans-serif;min-width:190px';
      const riverHtml=river?`<span style="font-size:10px;color:#888"> (${river})</span>`:'';
      const timeHtml=timeStr?`<span style="font-size:9px;color:#aaa"> (${timeStr}観測)</span>`:'';
      const lvLabel=level>=0?`<span style="color:${col}"> ${_stageLabel(level)}</span>`:'';
      const encKey=encodeURIComponent(key), encName=encodeURIComponent(name);
      pDiv.innerHTML=`<b>💧 ${name}</b>${riverHtml}${timeHtml}<br><div style="font-size:14px;font-weight:bold;color:${col};margin:3px 0">水位: ${levelStr}${lvLabel}</div><div style="display:flex;gap:4px;margin-top:5px"><button data-key="${encKey}" data-nm="${encName}" data-h="6" class="rv-btn">📈 6時間</button><button data-key="${encKey}" data-nm="${encName}" data-h="24" class="rv-btn">📈 24時間</button></div><div style="font-size:9px;color:#aaa;margin-top:3px">出典: 長野県 河川砂防情報ステーション</div>`;
      pDiv.querySelectorAll('.rv-btn').forEach(btn=>{
        btn.style.cssText='flex:1;padding:3px 5px;font-size:11px;border:1px solid #0066ff;background:#fff;border-radius:4px;cursor:pointer;color:#0066ff';
        btn.onclick=()=>showRiverChart(decodeURIComponent(btn.dataset.key),Number(btn.dataset.h),decodeURIComponent(btn.dataset.nm));
      });
      mk.bindPopup(pDiv);
      riverMarkers.push(mk); count++;
    }

    const now=new Date(), pn=v=>String(v).padStart(2,'0');
    div.style.color=count?'#aaa':'#888';
    div.textContent=count
      ?`💧 水位観測 ${count}地点 (${pn(now.getHours())}:${pn(now.getMinutes())} 更新)`
      :'⚠ 表示エリアに水位観測所なし';
    div.style.display='block'; lbl.style.borderColor='';
  }catch(e){
    console.error('[River]',e);
    div.style.color='#ff6b6b';
    div.innerHTML=`❌ 水位取得失敗: ${e.message}`;
    div.style.display='block'; document.getElementById('lblLRiverLevel').style.borderColor='#ff3b30';
  }
}

async function showRiverChart(stationKey,hours,stationName){
  const w=openChartWindow(`${stationName} 水位(過去${hours}h)`);
  try{
    const pad=n=>String(n).padStart(2,'0');
    /* JST現在時刻（epoch ms に +9h を加算して UTC関数でJST値を読み出す） */
    const nowMs=Date.now()+9*3600000;
    const cutMs=nowMs-hours*3600000;

    /* 必要な4時間ブロックを収集（重複はSetで排除） */
    const blocks=new Set();
    for(let h=0;h<=hours+4;h+=4){
      const t=new Date(nowMs-h*3600000);
      const d=`${t.getUTCFullYear()}${pad(t.getUTCMonth()+1)}${pad(t.getUTCDate())}`;
      const n=Math.floor(t.getUTCHours()/4)+1;
      blocks.add(`${d}/${d}_${n}_stage_10.json`);
    }

    /* 並列取得 */
    const responses=await Promise.allSettled([...blocks].map(bp=>
      rpFetch(`${SABO_BASE}/dyn/json/dat/pc/${bp}`,{cache:'no-store'})
    ));

    /* 時系列データ収集（time形式: "2026-06-30-20-40"） */
    const pts=[];
    for(const res of responses){
      if(res.status!=='fulfilled') continue;
      const r=res.value;
      if(!r.ok) continue;
      const json=await r.json();
      const stn=json[stationKey];
      if(!stn?.data10) continue;
      for(const pt of stn.data10){
        const t=pt.time;
        if(!t||t.length<16) continue;
        /* "YYYY-MM-DD-HH-mm" → epoch ms（JSTフレーム） */
        const ms=Date.UTC(+t.slice(0,4),+t.slice(5,7)-1,+t.slice(8,10),+t.slice(11,13),+t.slice(14,16));
        if(ms<cutMs) continue;
        pts.push({ms,label:`${t.slice(11,13)}:${t.slice(14,16)}`,value:pt.item_10?.value});
      }
    }
    pts.sort((a,b)=>a.ms-b.ms);
    /* 重複除去 */
    const seen=new Set(), uniq=[];
    for(const pt of pts){ if(!seen.has(pt.ms)){seen.add(pt.ms);uniq.push(pt);} }

    if(!uniq.length){w.setError('時系列データなし');return;}
    w.setChart(
      uniq.map(pt=>pt.label),
      [{label:'水位(m)',data:uniq.map(pt=>pt.value!=null&&pt.value!==''?Number(pt.value):null),
        type:'line',backgroundColor:'rgba(0,102,255,0.12)',borderColor:'rgba(0,102,255,0.8)',
        borderWidth:2,fill:true,tension:0.3,pointRadius:2,spanGaps:true}],
      '長野県 河川砂防情報ステーション',{beginAtZero:false}
    );
  }catch(e){ w.setError(`取得失敗: ${e.message}`); }
}

document.getElementById('chkLRiverLevel').addEventListener('change',function(){
  riverOn=this.checked;
  document.getElementById('lblLRiverLevel').classList.toggle('active',riverOn);
  if(riverOn){ fetchRiverData(); if(!riverTimer) riverTimer=setInterval(fetchRiverData,10*60*1000); }
  else{ clearInterval(riverTimer); riverTimer=null; riverMarkers.forEach(mk=>map.removeLayer(mk)); riverMarkers=[]; document.getElementById('wxRiver').style.display='none'; if(_riverGeoLayer){ map.removeLayer(_riverGeoLayer); _riverGeoLayer=null; } _riverStageMap={}; }
});
map.on('moveend',()=>{ if(riverOn) fetchRiverData(); });

/* パネルドラッグ */
(()=>{
  const handle=document.getElementById('wxHandle');
  let drag=null;
  function startDrag(cx,cy){ const r=wxPanel.getBoundingClientRect(); drag={ox:cx-r.left,oy:cy-r.top}; }
  function moveDrag(cx,cy){
    if(!drag) return;
    let x=cx-drag.ox, y=cy-drag.oy;
    x=Math.max(0,Math.min(window.innerWidth-wxPanel.offsetWidth,x));
    y=Math.max(0,Math.min(window.innerHeight-wxPanel.offsetHeight,y));
    wxPanel.style.left=x+'px'; wxPanel.style.top=y+'px';
  }
  function endDrag(){ drag=null; }
  handle.addEventListener('touchstart',e=>{ if(e.target.closest('button')) return; startDrag(e.touches[0].clientX,e.touches[0].clientY); },{passive:true});
  handle.addEventListener('touchmove',e=>{ if(!drag)return; e.preventDefault(); moveDrag(e.touches[0].clientX,e.touches[0].clientY); },{passive:false});
  handle.addEventListener('touchend',endDrag,{passive:true});
  handle.addEventListener('mousedown',e=>{ if(e.target.closest('button')) return; startDrag(e.clientX,e.clientY); handle.style.cursor='grabbing'; });
  document.addEventListener('mousemove',e=>{ if(drag) moveDrag(e.clientX,e.clientY); });
  document.addEventListener('mouseup',()=>{ endDrag(); handle.style.cursor='grab'; });
})();
document.getElementById('wxCollapseBtn').addEventListener('click',()=>{
  wxPanel.classList.toggle('collapsed');
});

/* =========================
   現場掲示板 (BBS)
========================= */
const _GH_FILE_URL = 'https://api.github.com/repos/akahanenoriaki/akahanenoriaki.github.io/contents/bbs/posts.json';
function _bbsGetPat(){ return localStorage.getItem('bbsPat')||''; }
function _bbsSetPat(v){ localStorage.setItem('bbsPat',v.trim()); }

let _bbsPosts=[], _bbsSha=null, _bbsMarkers=[], _bbsTimer=null;
let _bbsPhotoB64=null, _bbsLat=null, _bbsLng=null;
let _bbsPhotoMap={};

function _bbsGetUserName(){ return localStorage.getItem('bbsUserName')||''; }
function _bbsUpdateAuthorBar(){
  const name=_bbsGetUserName();
  document.getElementById('bbsAuthorBarName').textContent=name||'未登録';
  const patOk=!!_bbsGetPat();
  const ind=document.getElementById('bbsPatIndicator');
  if(ind){ ind.textContent=patOk?'🔑✓':'🔑未設定'; ind.style.color=patOk?'#2e7d32':'#c62828'; }
}

function _bbsShowPatDialog(){
  const cur=_bbsGetPat();
  const val=prompt('GitHub Personal Access Token を入力してください\n（Contents: Read and write 権限が必要）\n\n設定済みの場合は変更またはそのままOK:',cur);
  if(val===null) return;
  _bbsSetPat(val);
  _bbsUpdateAuthorBar();
  if(val) toast('トークンを保存しました',2000);
}

async function _bbsFetchPosts(){
  try{
    const res=await fetch(_GH_FILE_URL,{
      headers:{'Authorization':'Bearer '+_bbsGetPat(),'Accept':'application/vnd.github+json'}
    });
    if(res.status===404){ _bbsPosts=[]; _bbsSha=null; _bbsCheckNew(); return true; }
    if(!res.ok) throw new Error('GitHub API '+res.status);
    const data=await res.json();
    _bbsSha=data.sha;
    const raw=await fetch(data.download_url+'?_='+Date.now());
    const txt=await raw.text();
    _bbsPosts=JSON.parse(txt)||[];
    _bbsCheckNew();
    return true;
  }catch(e){ console.error('[BBS fetch]',e); toast('掲示板の読込失敗 — 既存の投稿はそのまま表示中',3000); return false; }
}

async function _bbsSavePosts(posts, _depth=0){
  const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(posts,null,2))));
  const body={message:'BBS: update posts',content:encoded,committer:{name:'Field Map',email:'map@field'}};
  if(_bbsSha) body.sha=_bbsSha;
  const res=await fetch(_GH_FILE_URL,{
    method:'PUT',
    headers:{'Authorization':'Bearer '+_bbsGetPat(),'Content-Type':'application/json','Accept':'application/vnd.github+json'},
    body:JSON.stringify(body)
  });
  if(res.status===409&&_depth<2){
    const r=await fetch(_GH_FILE_URL,{headers:{'Authorization':'Bearer '+_bbsGetPat(),'Accept':'application/vnd.github+json'}});
    const d=await r.json();
    _bbsSha=d.sha;
    const raw=await fetch(d.download_url+'?_='+Date.now());
    const remotePosts=JSON.parse(await raw.text())||[];
    const remoteIds=new Set(remotePosts.map(p=>p.id));
    const newOnly=posts.filter(p=>!remoteIds.has(p.id));
    const merged=newOnly.length>0?[...remotePosts,...newOnly]:remotePosts;
    _bbsPosts=merged;
    return _bbsSavePosts(merged,_depth+1);
  }
  if(!res.ok){
    const err=await res.json().catch(()=>({}));
    throw new Error(err.message||'GitHub PUT '+res.status);
  }
  const data=await res.json();
  _bbsSha=data.content.sha;
}

function _bbsCatEmoji(cat){
  return {'道路':'🛣','河川':'💧','土砂':'⛰','施設':'🏢','その他':'📌'}[cat]||'📌';
}

function _bbsFmtTime(iso){
  const d=new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function _bbsRenderMarkers(){
  _bbsMarkers.forEach(m=>map.removeLayer(m));
  _bbsMarkers=[]; _bbsPhotoMap={};
  const catCol={'道路':'#e65100','河川':'#0277bd','土砂':'#4e342e','施設':'#2e7d32','その他':'#37474f'};
  for(const p of _bbsPosts){
    if(p.lat==null||p.lng==null) continue;
    const col=catCol[p.cat]||'#555';
    const ico=L.divIcon({
      html:`<div style="background:${col};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);margin:-16px 0 0 -16px">${_bbsCatEmoji(p.cat)}</div>`,
      iconSize:[32,32],className:''
    });
    let pop=`<div style="font-size:12px;max-width:230px"><b>${escapeHtml(p.cat)}</b> <span style="color:#aaa">${_bbsFmtTime(p.ts)}</span>${p.author?` <span style="color:#888">👤${escapeHtml(p.author)}</span>`:''}<br><div style="margin-top:4px">${escapeHtml(p.comment||'')}</div>`;
    if(p.photo){
      _bbsPhotoMap[p.id]=p.photo;
      pop+=`<img src="${p.photo}" style="max-width:210px;max-height:130px;border-radius:6px;margin-top:6px;cursor:pointer;display:block" onclick="_bbsOpenPhoto('${p.id}')">`;
    }
    pop+='</div>';
    const mk=L.marker([p.lat,p.lng],{icon:ico}).addTo(map).bindPopup(pop,{maxWidth:240});
    _bbsMarkers.push(mk);
  }
}
window._bbsOpenPhoto=id=>{ if(_bbsPhotoMap[id]) openPhoto(_bbsPhotoMap[id]); };

function _bbsRenderList(){
  const listEl=document.getElementById('bbsList');
  const loadMsg=document.getElementById('bbsLoadingMsg');
  const emptyMsg=document.getElementById('bbsEmptyMsg');
  loadMsg.style.display='none';
  if(!_bbsPosts.length){ emptyMsg.style.display='block'; listEl.innerHTML=''; return; }
  emptyMsg.style.display='none';
  const sorted=[..._bbsPosts].sort((a,b)=>new Date(b.ts)-new Date(a.ts));
  listEl.innerHTML='';
  sorted.forEach(p=>{
    const card=document.createElement('div');
    card.className='bbs-card';
    // ヘッダー
    const hdr=document.createElement('div');
    hdr.className='bbs-card-header';
    const badge=document.createElement('span');
    badge.className='bbs-cat-badge';
    badge.textContent=`${_bbsCatEmoji(p.cat)} ${p.cat}`;
    const ts=document.createElement('span');
    ts.className='bbs-time';
    ts.textContent=_bbsFmtTime(p.ts);
    hdr.appendChild(badge); hdr.appendChild(ts);
    if(p.author){ const au=document.createElement('span'); au.className='bbs-author'; au.textContent='👤 '+p.author; hdr.appendChild(au); }
    if(p.lat!=null){
      const jb=document.createElement('button');
      jb.className='bbs-icon-btn'; jb.textContent='🗺 地図';
      jb.addEventListener('click',()=>{ map.setView([p.lat,p.lng],16); closeBbsPanel(); });
      hdr.appendChild(jb);
    }
    const db=document.createElement('button');
    db.className='bbs-icon-btn'; db.textContent='🗑';
    db.style.color='#c00';
    db.addEventListener('click',()=>_bbsDeleteById(p.id));
    hdr.appendChild(db);
    card.appendChild(hdr);
    // コメント
    const cm=document.createElement('div');
    cm.className='bbs-comment'; cm.textContent=p.comment||'';
    card.appendChild(cm);
    // 写真
    if(p.photo){
      const img=document.createElement('img');
      img.src=p.photo; img.className='bbs-photo';
      img.addEventListener('click',()=>openPhoto(p.photo));
      card.appendChild(img);
    }
    // 位置
    if(p.lat!=null){
      const loc=document.createElement('div');
      loc.className='bbs-loc';
      loc.textContent=`📍 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
      card.appendChild(loc);
    }
    listEl.appendChild(card);
  });
}

async function _bbsDeleteById(id){
  if(!await showConfirm('この投稿を削除しますか？')) return;
  const newPosts=_bbsPosts.filter(p=>p.id!==id);
  toast('削除中...',3000);
  try{
    await _bbsSavePosts(newPosts);
    _bbsPosts=newPosts;
    _bbsRenderMarkers();
    _bbsRenderList();
    toast('削除しました',2000);
  }catch(e){ toast('削除失敗: '+e.message,4000); }
}

function _bbsCompressPhoto(file){
  return new Promise(resolve=>{
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{
      const MAX=900; let w=img.width,h=img.height;
      if(w>MAX||h>MAX){ if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;} }
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg',0.72));
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); resolve(null); };
    img.src=url;
  });
}

const bbsPanel=document.getElementById('bbsPanel');
const bbsFloatBtn=document.getElementById('bbsFloatBtn');
const bbsBadge=document.getElementById('bbsBadge');

function _bbsCheckNew(){
  const last=localStorage.getItem('bbsLastSeen')||'';
  const hasNew=_bbsPosts.some(p=>p.ts>last);
  bbsBadge.style.display=hasNew?'block':'none';
}
function _bbsMarkSeen(){
  const latest=_bbsPosts.reduce((m,p)=>p.ts>m?p.ts:m,'');
  if(latest) localStorage.setItem('bbsLastSeen',latest);
  bbsBadge.style.display='none';
}

async function openBbsPanel(){
  _bbsUpdateAuthorBar();
  bbsPanel.style.display='flex';
  bbsPanel.classList.remove('collapsed');
  bbsFloatBtn.classList.add('active');
  _bbsMarkSeen();
  // リストタブに戻す
  document.querySelectorAll('.bbs-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById('bbsTabList').classList.add('active');
  document.getElementById('bbsListPane').style.display='';
  document.getElementById('bbsNewPane').style.display='none';
  document.getElementById('bbsLoadingMsg').style.display='block';
  document.getElementById('bbsEmptyMsg').style.display='none';
  document.getElementById('bbsList').innerHTML='';
  await _bbsFetchPosts();
  _bbsRenderMarkers();
  _bbsRenderList();
  if(!_bbsTimer) _bbsTimer=setInterval(async()=>{
    await _bbsFetchPosts(); _bbsRenderMarkers(); _bbsRenderList();
  },30000);
}

function closeBbsPanel(){
  bbsPanel.style.display='none';
  bbsFloatBtn.classList.remove('active');
  clearInterval(_bbsTimer); _bbsTimer=null;
}

// タブ切替
document.querySelectorAll('.bbs-tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.bbs-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab=btn.dataset.tab;
    document.getElementById('bbsListPane').style.display=tab==='list'?'':'none';
    document.getElementById('bbsNewPane').style.display=tab==='new'?'':'none';
  });
});

bbsFloatBtn.addEventListener('click',()=>{
  if(bbsPanel.style.display==='flex') closeBbsPanel();
  else openBbsPanel();
});

// 投稿者名
document.getElementById('bbsAuthorEditBtn').addEventListener('click',()=>{
  const editor=document.getElementById('bbsAuthorEditor');
  const input=document.getElementById('bbsAuthorInput');
  const open=editor.style.display==='none'||editor.style.display==='';
  editor.style.display=open?'flex':'none';
  if(open){ input.value=_bbsGetUserName(); input.focus(); }
});
function _bbsSaveAuthor(){
  const name=document.getElementById('bbsAuthorInput').value.trim().slice(0,20);
  if(name) localStorage.setItem('bbsUserName',name);
  document.getElementById('bbsAuthorEditor').style.display='none';
  _bbsUpdateAuthorBar();
}
document.getElementById('bbsAuthorSaveBtn').addEventListener('click',_bbsSaveAuthor);
document.getElementById('bbsAuthorInput').addEventListener('keydown',e=>{ if(e.key==='Enter') _bbsSaveAuthor(); });

// 掲示板一時無効化中
// (async()=>{
//   await _bbsFetchPosts();
//   setInterval(async()=>{
//     if(bbsPanel.style.display!=='flex') await _bbsFetchPosts();
//   },60000);
// })();
document.getElementById('bbsClose').addEventListener('click',closeBbsPanel);
document.getElementById('bbsCollapseBtn').addEventListener('click',()=>{ bbsPanel.classList.toggle('collapsed'); });
document.getElementById('bbsRefreshBtn').addEventListener('click',async()=>{
  document.getElementById('bbsLoadingMsg').style.display='block';
  document.getElementById('bbsList').innerHTML='';
  await _bbsFetchPosts(); _bbsRenderMarkers(); _bbsRenderList();
  toast('更新しました',1500);
});

// ドラッグ
(()=>{
  const handle=document.getElementById('bbsHandle');
  let drag=null;
  function startDrag(cx,cy){ const r=bbsPanel.getBoundingClientRect(); drag={ox:cx-r.left,oy:cy-r.top}; }
  function moveDrag(cx,cy){
    if(!drag) return;
    let x=cx-drag.ox, y=cy-drag.oy;
    x=Math.max(0,Math.min(window.innerWidth-bbsPanel.offsetWidth,x));
    y=Math.max(0,Math.min(window.innerHeight-bbsPanel.offsetHeight,y));
    bbsPanel.style.left=x+'px'; bbsPanel.style.top=y+'px';
    bbsPanel.style.right='auto';
  }
  function endDrag(){ drag=null; }
  handle.addEventListener('touchstart',e=>{ if(e.target.closest('button')) return; startDrag(e.touches[0].clientX,e.touches[0].clientY); },{passive:true});
  handle.addEventListener('touchmove',e=>{ if(!drag)return; e.preventDefault(); moveDrag(e.touches[0].clientX,e.touches[0].clientY); },{passive:false});
  handle.addEventListener('touchend',endDrag,{passive:true});
  handle.addEventListener('mousedown',e=>{ if(e.target.closest('button')) return; startDrag(e.clientX,e.clientY); handle.style.cursor='grabbing'; });
  document.addEventListener('mousemove',e=>{ if(drag) moveDrag(e.clientX,e.clientY); });
  document.addEventListener('mouseup',()=>{ endDrag(); handle.style.cursor='grab'; });
})();

// 現在地取得
document.getElementById('bbsGetLocBtn').addEventListener('click',()=>{
  document.getElementById('bbsLocStatus').textContent='取得中...';
  navigator.geolocation.getCurrentPosition(
    pos=>{ _bbsLat=pos.coords.latitude; _bbsLng=pos.coords.longitude;
      document.getElementById('bbsLocStatus').textContent=`${_bbsLat.toFixed(5)}, ${_bbsLng.toFixed(5)}`; },
    ()=>{ document.getElementById('bbsLocStatus').textContent='取得失敗'; },
    {enableHighAccuracy:true,timeout:15000}
  );
});

// 写真（撮影/ギャラリー）
async function _bbsHandlePhoto(file, fromCamera=false){
  if(!file) return;
  if(fromCamera){
    if(typeof _me!=='undefined'&&_me){ _bbsLat=_me.lat; _bbsLng=_me.lng; document.getElementById('bbsLocStatus').textContent=`📍 ${_bbsLat.toFixed(5)}, ${_bbsLng.toFixed(5)}`; }
  } else {
    if(window.exifr){ try{ const gps=await exifr.gps(file); if(gps&&gps.latitude&&gps.longitude){ _bbsLat=gps.latitude; _bbsLng=gps.longitude; document.getElementById('bbsLocStatus').textContent=`📷 ${_bbsLat.toFixed(5)}, ${_bbsLng.toFixed(5)}`; } }catch(_){} }
  }
  document.getElementById('bbsTakePhotoBtn').textContent='圧縮中...';
  document.getElementById('bbsPickPhotoBtn').textContent='圧縮中...';
  _bbsPhotoB64=await _bbsCompressPhoto(file);
  if(_bbsPhotoB64){ const prev=document.getElementById('bbsPhotoPreview'); prev.src=_bbsPhotoB64; prev.style.display='block'; }
  document.getElementById('bbsTakePhotoBtn').textContent='📷 撮影する';
  document.getElementById('bbsPickPhotoBtn').textContent='🖼 ギャラリー';
}
function _bbsOpenFileInput(useCamera){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
  if(useCamera) inp.setAttribute('capture','environment');
  inp.style.cssText='position:fixed;top:0;left:0;opacity:0;width:0;height:0;pointer-events:none;';
  document.body.appendChild(inp);
  inp.onchange=e=>{ const f=e.target.files[0]; if(f) _bbsHandlePhoto(f,useCamera); document.body.removeChild(inp); };
  inp.click();
}
document.getElementById('bbsTakePhotoBtn').addEventListener('click',()=>_bbsOpenFileInput(true));
document.getElementById('bbsPickPhotoBtn').addEventListener('click',()=>_bbsOpenFileInput(false));
document.getElementById('bbsPhotoPreview').addEventListener('click',()=>{ if(_bbsPhotoB64) openPhoto(_bbsPhotoB64); });

// 投稿送信
document.getElementById('bbsSubmitBtn').addEventListener('click',async()=>{
  const comment=document.getElementById('bbsComment').value.trim();
  const cat=document.getElementById('bbsCatSel').value;
  if(!comment){ toast('コメントを入力してください',2000); return; }
  const btn=document.getElementById('bbsSubmitBtn');
  const status=document.getElementById('bbsFormStatus');
  btn.disabled=true; status.textContent='投稿中...';
  const post={
    id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    ts:new Date().toISOString(), cat, comment,
    author:_bbsGetUserName(),
    lat:_bbsLat, lng:_bbsLng,
    photo:_bbsPhotoB64||null
  };
  try{
    await _bbsSavePosts([..._bbsPosts,post]);
    _bbsPosts.push(post);
    _bbsRenderMarkers();
    // フォームリセット
    document.getElementById('bbsComment').value='';
    _bbsPhotoB64=null; _bbsLat=null; _bbsLng=null;
    document.getElementById('bbsPhotoPreview').style.display='none';
    document.getElementById('bbsLocStatus').textContent='未設定';
    document.getElementById('bbsTakePhotoBtn').textContent='📷 撮影する';
    document.getElementById('bbsPickPhotoBtn').textContent='🖼 ギャラリー';
    // 一覧タブへ
    document.querySelectorAll('.bbs-tab').forEach(b=>b.classList.remove('active'));
    document.getElementById('bbsTabList').classList.add('active');
    document.getElementById('bbsListPane').style.display='';
    document.getElementById('bbsNewPane').style.display='none';
    _bbsRenderList();
    toast('投稿しました！',2500);
    status.textContent='';
  }catch(e){
    status.textContent='投稿失敗: '+e.message;
    toast('投稿に失敗しました',3000);
  }
  btn.disabled=false;
});

/* =========================
   ドラッグ＆ドロップ読み込み
========================= */
const _dropOverlay = document.getElementById('dropOverlay');
let _dragDepth = 0;

const _TOGEOJSON_CDN = 'https://unpkg.com/@mapbox/togeojson@0.16.0/togeojson.js';
const _SHPJS_CDN     = 'https://unpkg.com/shpjs@3.6.3/dist/shp.js';
let _togeojson = null;
let _shpjs     = null;

async function _loadScript(src){
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=src; s.onload=res; s.onerror=()=>rej(new Error('スクリプト読込失敗: '+src));
    document.head.appendChild(s);
  });
}

async function _getToGeoJSON(){
  if(_togeojson) return _togeojson;
  await _loadScript(_TOGEOJSON_CDN);
  _togeojson = window.toGeoJSON;
  return _togeojson;
}

async function _getShpjs(){
  if(_shpjs) return _shpjs;
  await _loadScript(_SHPJS_CDN);
  _shpjs = window.shp;
  return _shpjs;
}

function _addGeoJSONToMap(gj, label){
  try{
    gjGroup.addLayer(makeVectorLayer(gj));
    if(gjGroup.getLayers().length) map.fitBounds(gjGroup.getBounds().pad(0.1));
    toast(`${label} 読み込み完了`);
  } catch(e){ toast(`${label} 表示失敗: ${e.message}`, 4000); console.error(e); }
}

async function _handleDroppedFile(file){
  const name = file.name.toLowerCase();
  const ext  = name.split('.').pop();

  if(ext === 'geojson' || ext === 'json'){
    const r = new FileReader();
    r.onload = ()=>{
      try{ _addGeoJSONToMap(JSON.parse(r.result), file.name); }
      catch{ toast('GeoJSONの解析に失敗しました', 3000); }
    };
    r.readAsText(file);
    return;
  }

  if(ext === 'gpkg'){
    await loadGPKG(file);
    return;
  }

  if(ext === 'zip'){
    toast('SHPを読み込み中...', 8000);
    try{
      const shp = await _getShpjs();
      const buf = await file.arrayBuffer();
      const gj  = await shp(buf);
      const fc  = (gj.type==='FeatureCollection') ? gj
                : {type:'FeatureCollection', features: Array.isArray(gj)?gj:[gj]};
      _addGeoJSONToMap(fc, file.name);
    } catch(e){ toast('SHP(ZIP)の読み込みに失敗しました: '+e.message, 5000); console.error(e); }
    return;
  }

  if(ext === 'shp'){
    toast('SHPはZIPにまとめてドロップしてください（.shp, .dbf, .prj を含む）', 4000);
    return;
  }

  if(ext === 'gpx'){
    toast('GPXを読み込み中...', 5000);
    try{
      const tgj = await _getToGeoJSON();
      const text = await file.text();
      const dom  = new DOMParser().parseFromString(text, 'text/xml');
      const gj   = tgj.gpx(dom);
      _addGeoJSONToMap(gj, file.name);
    } catch(e){ toast('GPXの読み込みに失敗しました', 3000); console.error(e); }
    return;
  }

  if(ext === 'kml'){
    toast('KMLを読み込み中...', 5000);
    try{
      const tgj = await _getToGeoJSON();
      const text = await file.text();
      const dom  = new DOMParser().parseFromString(text, 'text/xml');
      const gj   = tgj.kml(dom);
      _addGeoJSONToMap(gj, file.name);
    } catch(e){ toast('KMLの読み込みに失敗しました', 3000); console.error(e); }
    return;
  }

  toast(`非対応の形式です: .${ext}`, 3000);
}

document.addEventListener('dragenter', e=>{
  e.preventDefault();
  _dragDepth++;
  if(_dragDepth===1) _dropOverlay.classList.add('active');
});
document.addEventListener('dragleave', ()=>{
  _dragDepth--;
  if(_dragDepth<=0){ _dragDepth=0; _dropOverlay.classList.remove('active'); }
});
document.addEventListener('dragover', e=>{ e.preventDefault(); });
document.addEventListener('drop', e=>{
  e.preventDefault();
  _dragDepth=0;
  _dropOverlay.classList.remove('active');
  const files = Array.from(e.dataTransfer.files);
  if(!files.length) return;
  files.forEach(f=>_handleDroppedFile(f));
});

/* =========================
   共有URLパラメータ読み込み
========================= */
(()=>{
  const p=new URLSearchParams(location.search);
  const lat=parseFloat(p.get('lat')), lng=parseFloat(p.get('lng')), z=parseInt(p.get('z'));
  if(!isNaN(lat)&&!isNaN(lng)){
    const zoom=isNaN(z)?16:z;
    map.setView([lat,lng],zoom,{animate:false});
    follow=false;
    document.getElementById('btnFollow').innerHTML='<span class="ico">🚶</span>追従 OFF';
    document.getElementById('btnFollow').classList.add('on');
    L.marker([lat,lng],{
      icon:L.divIcon({
        html:'<div style="font-size:26px;line-height:1;margin:-24px 0 0 -13px">📍</div>',
        iconSize:[26,26],iconAnchor:[13,26],className:''
      })
    }).addTo(map)
     .bindPopup(`<div style="font-size:12px;text-align:center">📍 共有ポイント<br><b>${lat.toFixed(6)}, ${lng.toFixed(6)}</b></div>`)
     .openPopup();
  }
})();

/* =========================
   印刷機能
========================= */
(()=>{
  const BBS_CAT_COL = {'道路':'#e65100','河川':'#0277bd','土砂':'#4e342e','施設':'#2e7d32','その他':'#37474f'};
  const BBS_CAT_EMO = {'道路':'🛣','河川':'💧','土砂':'⛰','施設':'🏢','その他':'📌'};

  function _buildPrintLegend(){
    const el = document.getElementById('printLegend');
    el.innerHTML = '';
    if(typeof _rinpanLayer !== 'undefined' && _rinpanLayer && map.hasLayer(_rinpanLayer)){
      const d = document.createElement('div'); d.className = 'print-legend-item';
      d.innerHTML = '<div class="print-legend-line" style="background:#2e7d32;border:1.5px solid #2e7d32;"></div><span>林班</span>';
      el.appendChild(d);
    }
    if(typeof _segyohanLayer !== 'undefined' && _segyohanLayer && map.hasLayer(_segyohanLayer)){
      const d = document.createElement('div'); d.className = 'print-legend-item';
      d.innerHTML = '<div class="print-legend-line" style="background:#e65100;border:1.5px solid #e65100;"></div><span>施業班</span>';
      el.appendChild(d);
    }
    const usedCats = new Set((_bbsPosts||[]).map(p=>p.cat));
    for(const [cat, col] of Object.entries(BBS_CAT_COL)){
      if(!usedCats.has(cat)) continue;
      const d = document.createElement('div'); d.className = 'print-legend-item';
      d.innerHTML = `<div class="print-legend-dot" style="background:${col};"></div><span>${BBS_CAT_EMO[cat]} ${cat}</span>`;
      el.appendChild(d);
    }
    if(typeof gjGroup !== 'undefined' && gjGroup && gjGroup.getLayers().length){
      const d = document.createElement('div'); d.className = 'print-legend-item';
      d.innerHTML = '<div class="print-legend-dot" style="background:#0066ff;border-radius:0;"></div><span>ベクタデータ</span>';
      el.appendChild(d);
    }
  }

  function _buildPrintMeta(title){
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const center = map.getCenter();
    const zoom   = map.getZoom();
    document.getElementById('printHeaderMapTitle').textContent = title || '現場確認マップ';
    document.getElementById('printHeaderMeta').textContent = `${dateStr} | 緯度 ${center.lat.toFixed(5)} 経度 ${center.lng.toFixed(5)} | Zoom ${zoom}`;
    const scaleRaw = parseInt(document.getElementById('printScaleInput').value, 10);
    const scaleDom  = document.getElementById('printHeaderScale');
    const mapScale  = document.getElementById('printMapScale');
    if(scaleRaw > 0){
      const txt = `縮尺 1/${scaleRaw.toLocaleString()}`;
      scaleDom.textContent = txt;
      scaleDom.style.display = '';
      mapScale.textContent  = txt;
      mapScale.style.display = '';
    } else {
      scaleDom.textContent = ''; scaleDom.style.display = 'none';
      mapScale.textContent = ''; mapScale.style.display = 'none';
    }
  }

  // ── 印刷範囲フレーム ──
  let _pfLandscape = false;
  let _pfCenter    = null;
  let _pfBounds    = null;

  // A4 in CSS px at 96 DPI (1in = 96px)
  const A4_W = 794, A4_H = 1123;
  const PRINT_HEADER_H = 64;

  function _pfUpdateFrame(){
    const box = document.getElementById('printFrameBox');
    const vw = window.innerWidth, vh = window.innerHeight;
    const barH = 70, margin = 36;
    const aw = vw - margin * 2, ah = vh - barH - margin * 2;
    const ratio = 297 / 210;
    let fw, fh;
    if(_pfLandscape){
      if(aw / ratio <= ah){ fw = aw; fh = fw / ratio; }
      else { fh = ah; fw = fh * ratio; }
    } else {
      if(aw * ratio <= ah){ fw = aw; fh = fw * ratio; }
      else { fh = ah; fw = fh / ratio; }
    }
    box.style.width  = fw + 'px';
    box.style.height = fh + 'px';
    box.style.left   = ((vw - fw) / 2) + 'px';
    box.style.top    = margin + 'px';
  }

  document.getElementById('printFrameOrient').addEventListener('click', ()=>{
    _pfLandscape = !_pfLandscape;
    document.getElementById('printFrameOrient').textContent = _pfLandscape ? '縦向き' : '横向き';
    _pfUpdateFrame();
  });

  document.getElementById('printFrameCancel').addEventListener('click', ()=>{
    document.getElementById('printFrame').classList.remove('show');
  });

  document.getElementById('printFrameNext').addEventListener('click', ()=>{
    // フレームボックスの地理的範囲を確定する
    const box   = document.getElementById('printFrameBox');
    const mapEl = map.getContainer();
    const bRect = box.getBoundingClientRect();
    const mRect = mapEl.getBoundingClientRect();

    // フレームの四隅を地理座標に変換
    const tl = map.containerPointToLatLng(L.point(bRect.left - mRect.left, bRect.top  - mRect.top));
    const br = map.containerPointToLatLng(L.point(bRect.right - mRect.left, bRect.bottom - mRect.top));
    _pfBounds = L.latLngBounds(tl, br);
    _pfCenter = _pfBounds.getCenter();

    document.getElementById('printFrame').classList.remove('show');
    document.getElementById('printMapTitle').value   = '';
    document.getElementById('printScaleInput').value = '';
    document.getElementById('printModal').classList.add('show');
    setTimeout(()=>document.getElementById('printMapTitle').focus(), 100);
  });

  window.addEventListener('resize', ()=>{
    if(document.getElementById('printFrame').classList.contains('show')) _pfUpdateFrame();
  });

  // ── 印刷モーダル ──
  document.getElementById('btnPrint').addEventListener('click', ()=>{
    closeSheet();
    _pfLandscape = false;
    _pfCenter = null; _pfBounds = null;
    document.getElementById('printFrameOrient').textContent = '横向き';
    document.getElementById('printFrame').classList.add('show');
    _pfUpdateFrame();
  });

  document.getElementById('printCancel').addEventListener('click', ()=>{
    document.getElementById('printModal').classList.remove('show');
  });

  document.getElementById('printOk').addEventListener('click', ()=>{
    const title = document.getElementById('printMapTitle').value.trim();
    document.getElementById('printModal').classList.remove('show');
    _buildPrintMeta(title);
    _buildPrintLegend();

    // ヘッダーの実際の高さを測定（コンテンツが入った状態で）
    const hdr = document.getElementById('printHeader');
    hdr.style.display = 'flex';
    const hdrH = hdr.offsetHeight;
    hdr.style.display = '';

    // 方位記号をヘッダー下端 + 余白に動的配置
    document.getElementById('printNorthOnMap').style.top = (hdrH + 6) + 'px';

    // @media print の地図 top もヘッダー高さに合わせて上書き
    let ds = document.getElementById('_pfDynStyle');
    if(!ds){ ds = document.createElement('style'); ds.id = '_pfDynStyle'; document.head.appendChild(ds); }
    ds.textContent = `@media print{#map{top:${hdrH}px !important;height:calc(100vh - ${hdrH}px) !important;}}`;

    // @page サイズ指定
    let s = document.getElementById('_pfOrientStyle');
    if(!s){ s = document.createElement('style'); s.id = '_pfOrientStyle'; document.head.appendChild(s); }
    s.textContent = _pfLandscape ? '@page{size:A4 landscape;}' : '@page{size:A4 portrait;}';

    if(_pfBounds && _pfCenter){
      const paperW = _pfLandscape ? A4_H : A4_W;
      const paperH = (_pfLandscape ? A4_W : A4_H) - hdrH;

      const origCenter = map.getCenter();
      const origZoom   = map.getZoom();
      const mapEl      = map.getContainer();
      const origW      = mapEl.style.width;
      const origH      = mapEl.style.height;
      const origSnap   = map.options.zoomSnap;

      mapEl.style.width  = paperW + 'px';
      mapEl.style.height = paperH + 'px';
      map.invalidateSize({animate: false});
      map.options.zoomSnap = 0;
      map.fitBounds(_pfBounds, {animate: false, padding: [0, 0]});

      setTimeout(()=>{
        window.print();
        window.addEventListener('afterprint', ()=>{
          mapEl.style.width  = origW;
          mapEl.style.height = origH;
          map.options.zoomSnap = origSnap;
          map.invalidateSize({animate: false});
          map.setView(origCenter, origZoom, {animate: false});
          document.getElementById('printNorthOnMap').style.top = '';
          ds.textContent = '';
        }, {once: true});
      }, 600);
    } else {
      setTimeout(()=>window.print(), 80);
    }
  });

  document.getElementById('printMapTitle').addEventListener('keydown', e=>{
    if(e.key==='Enter')  document.getElementById('printOk').click();
    if(e.key==='Escape') document.getElementById('printCancel').click();
  });
})();
