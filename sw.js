const CACHE_VER = 'map-20260830j';
const APP_CACHE  = CACHE_VER + '-app';
const CDN_CACHE  = CACHE_VER + '-cdn';
const TILE_CACHE = CACHE_VER + '-tiles';
const PMT_CACHE  = CACHE_VER + '-pmt';

const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/data/municipalities.json',
];

const CDN_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/piexifjs@1.0.6/piexif.js',
  'https://unpkg.com/proj4/dist/proj4.js',
  'https://unpkg.com/georaster',
  'https://unpkg.com/georaster-layer-for-leaflet/dist/georaster-layer-for-leaflet.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://unpkg.com/protomaps-leaflet@4.0.1/dist/protomaps-leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://unpkg.com/pmtiles@3.0.6/dist/pmtiles.js',
  'https://unpkg.com/pbf@3.3.0/dist/pbf.js',
  'https://unpkg.com/polygon-clipping@0.15.7/dist/polygon-clipping.umd.js',
  'https://unpkg.com/exifr/dist/mini.legacy.umd.js',
];

// インストール：アプリシェルとCDNをキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(APP_CACHE).then(c =>
        Promise.allSettled(APP_SHELL.map(u => c.add(u).catch(() => {})))
      ),
      caches.open(CDN_CACHE).then(c =>
        Promise.allSettled(CDN_URLS.map(u => c.add(u).catch(() => {})))
      ),
    ]).then(() => self.skipWaiting())
  );
});

// アクティベート：古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => !k.startsWith(CACHE_VER)).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// キャッシュファースト（ヒットしなければネットワーク→キャッシュ保存）
async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// ネットワークファースト（失敗したらキャッシュ）
async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

// PMTiles Rangeリクエスト処理
async function pmtilesHandler(request) {
  const cache = await caches.open(PMT_CACHE);
  // RangeヘッダーをURLに付加してキャッシュキーを作成
  const range = request.headers.get('Range') || '';
  const cacheKey = new Request(request.url + (range ? '#' + range : ''));
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.status === 200 || res.status === 206) {
      cache.put(cacheKey, res.clone());
    }
    return res;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// フェッチイベント振り分け
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // main.jsはバージョンクエリ付きでもキャッシュ
  if (url.origin === self.location.origin && url.pathname === '/main.js') {
    event.respondWith(cacheFirst(APP_CACHE, event.request));
    return;
  }

  // PMTiles（同一オリジン）
  if (url.origin === self.location.origin && url.pathname.endsWith('.pmtiles')) {
    event.respondWith(pmtilesHandler(event.request));
    return;
  }

  // index.html はネットワークファースト（常に最新版を取得）
  if (url.origin === self.location.origin &&
      (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(networkFirst(APP_CACHE, event.request));
    return;
  }

  // アプリシェル（同一オリジン）
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(APP_CACHE, event.request));
    return;
  }

  // CDNライブラリ
  if (['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'].includes(url.hostname)) {
    event.respondWith(cacheFirst(CDN_CACHE, event.request));
    return;
  }

  // 地理院・標高タイル（ネットワークファーストでキャッシュ）
  if (url.hostname.includes('gsi.go.jp') || url.hostname.includes('geospatial.jp')) {
    event.respondWith(networkFirst(TILE_CACHE, event.request));
    return;
  }
});

// エリアオフライン化：メインスレッドからメッセージで受け取る
self.addEventListener('message', async event => {
  if (event.data.type !== 'CACHE_AREA') return;
  const { bounds, minZoom, maxZoom, tileUrls } = event.data;
  const cache = await caches.open(TILE_CACHE);
  let done = 0, total = tileUrls.length;

  // 10並列でダウンロード
  const CONCURRENCY = 10;
  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = tileUrls.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(async url => {
      try {
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      } catch {}
      done++;
    }));
    // 進捗通知
    event.source.postMessage({ type: 'CACHE_PROGRESS', done, total });
  }
  event.source.postMessage({ type: 'CACHE_DONE', total });
});
