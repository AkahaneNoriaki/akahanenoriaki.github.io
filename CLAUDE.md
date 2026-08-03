# Field Survey Web GIS — 作業メモ

## ブランチ
`claude/enhance-map-features-XGw7H`

## 技術構成
- **protomaps-leaflet v4.0.1** (CDN: unpkg.com)
- **PMTiles** フォーマットでベクタタイル配信
- `main.js?v=YYYYMMDD{letter}` でキャッシュバスト（デプロイごとに末尾を変える）
- `data/municipalities.json` で市町村リスト管理

## 市町村データ構成
`data/{id}_rinpan.pmtiles` / `data/{id}_shohan.pmtiles` / `data/{id}_segyohan.pmtiles`

| id | 名称 | 状態 |
|----|------|------|
| tatsuno | 辰野町 | 森林簿結合済み |
| ina | 伊那市 | 森林簿結合済み |

## 新市町村追加手順

### 1. GeoJSON → WGS84変換（EPSG:2450 → 4326）
```bash
python3 /tmp/reproject.py {入力}.geojson {出力}_wgs84.geojson
```
`/tmp/reproject.py` スクリプト（pyproj使用）は前回セッションで作成済み。なければ再作成：
```python
import json, sys
from pyproj import Transformer
transformer = Transformer.from_crs("EPSG:2450", "EPSG:4326", always_xy=True)
def reproject_coords(coords):
    if isinstance(coords[0], list): return [reproject_coords(c) for c in coords]
    lon, lat = transformer.transform(coords[0], coords[1])
    return [lon, lat]
with open(sys.argv[1]) as f: gj = json.load(f)
gj.pop('crs', None)
for feat in gj['features']: feat['geometry']['coordinates'] = reproject_coords(feat['geometry']['coordinates'])
with open(sys.argv[2], 'w') as f: json.dump(gj, f)
print(f"Done: {len(gj['features'])} features")
```

### 2. 林班 PMTiles生成
```bash
tippecanoe -o data/{id}_rinpan.pmtiles -l rinpan \
  --minimum-zoom=10 --maximum-zoom=16 --force --no-tile-compression \
  -y RIN -y CITY {wgs84}.geojson
```

### 3. 小班 PMTiles生成
```bash
tippecanoe -o data/{id}_shohan.pmtiles -l shohan \
  --minimum-zoom=10 --maximum-zoom=16 --force --no-tile-compression \
  -y RIN -y SHO -y SHOKEY {wgs84}.geojson
```

### 4. 施業班 CSV結合＋PMTiles生成

#### 4-1. SEGYO=000を除外
```python
gj['features'] = [f for f in gj['features'] if str(f['properties'].get('SEGYO','')).strip() != '000']
```

#### 4-2. 森林簿CSVを結合（氏名は除外してPMTilesに入れない）
```python
EXCLUDE = {'施業キー','整理キー','氏名','林班','小班','小班コード',
           '市町村コード','施業番号','枝番','整理番号'}
# 整理番号=1の行を代表行として結合
# CSVはutf-8-sig。タイトル行がある場合は1行スキップしてから読む
```

#### 4-3. tippecanoe（フィールドを絞って生成）
```bash
tippecanoe -o data/{id}_segyohan.pmtiles -l segyohan \
  --minimum-zoom=10 --maximum-zoom=16 --force --no-tile-compression \
  -y KEY_02 -y RIN -y SHO -y SEGYO -y EDA -y SEGYOHANID \
  -y 市町村名 -y 大字名 -y 小字名 -y 推進方向 -y 地利級 \
  -y 保安林1 -y 施業方法_保安林1 -y 特定施業森林 \
  -y 林種 -y 育成区分 -y 施業区分 -y 層区分 -y 樹種 \
  -y 面積 -y 混交率 -y 混交面積 -y 林齢 -y 疎密度 \
  -y 地位 -y 樹高 -y 材積 -y HA材積 -y 成長量 \
  -y 木材生産機能 -y 施業種 -y 効率的施業区域 \
  -y 森林経営計画 -y 森林経営計画_年度 \
  -y 標高 -y 傾斜 -y 齢級 \
  {joined}.geojson
```

### 5. municipalities.jsonに追加
```json
[
  {"id": "tatsuno", "name": "辰野町"},
  {"id": "ina",     "name": "伊那市"},
  {"id": "{id}",   "name": "{市町村名}"}
]
```

## ポップアップ仕様
- **施業班クリック**: PMTilesの森林簿フィールドを動的表示（氏名なし）
- **Excel連携**（施業キー＋氏名のExcel）を接続すると「森林所有者名」セクションに氏名追加表示
- PMTiles内部フィールド（非表示）: `KEY_02, KEY_02ORG, RIN, SHO, SEGYO, EDA, SEGYOHANID, CITY, SHONIN, AREA_, GIS_SEGYOH, SHAPE_AREA, SHAPE_LEN, _S, SHOKEY`

## Excel連携の結合キー設定
| レイヤ | PMTilesキー | CSVキー例 |
|--------|------------|---------|
| 林班 | RIN | 林班番号 |
| 小班 | SHO | 小班記号 |
| 施業班 | KEY_02 | 施業キー |

## CSV読み込み対応エンコーディング
- UTF-8 BOM（`0xEF 0xBB 0xBF`）→ BOM除去してUTF-8デコード
- Shift-JIS → `TextDecoder('shift_jis')`
- UTF-16 LE BOM → `TextDecoder('utf-16le')`

## 上伊那地区 8市町村（予定）
辰野町・伊那市 完了。残り6市町村はGeoJSONができ次第追加。
