# DEVİR — Tezgah Salonu (dokuma canlı izleme, MOCK) · dal `gece/dokuma-ekran`

**Durum (2026-10-09):** tamamlandı, commit + push edildi. Bu dal **MAIN'E İNMEZ** (mock sayfa sahaya çıkmamalı) — yalnız `git push origin gece/dokuma-ekran`.

- Tasarım belgesi: `docs/design/DOKUMA-CANLI-EKRAN.md` (anatomi, sözlük, uyarı zinciri, mock→gerçek eşlemesi, açık sorular).
- Kod: `Electron/src/pages/Operations/WeavingFloor/` (bütün bildirim adları İngilizce; ekran metni/yorum Türkçe). Route `operations/weaving-orders/salon`, karo `weaving-floor`.
- Testler: `metrics.test.ts` (sayaç biçimi, kademe, iletim payı), `mock/floorMock.test.ts` (deterministiklik, saf adım), `useLoomFloorLive.test.ts` (zamanlayıcı ilerler/temizlenir).
- Ekran görüntüleri: `ONIZLEME/01-salon-acik.png`, `02-salon-koyu.png`, `03-duran-detay-acik.png`, `04-dar-pencere.png` (1100×800), `05-tam-ekran-koyu.png` (1920×1080).
- Görüntü turu: `cd Electron && npx vite --config ../ONIZLEME/arac/vite.onizleme.config.mjs` (port 5391, arka planda) → `node ONIZLEME/arac/shot.mjs ONIZLEME` → `kill $(lsof -ti tcp:5391 -sTCP:LISTEN)`.
- İletim payı mock ayarı `ESCALATION_SETTINGS.graceMin = 0` (kullanıcı senaryosu: hedef 5 dk, aşılınca patrona).
- TV kipi önizlemesi: `preview-weaving-floor.html?kip=tv` → `ONIZLEME/06-tv-kipi-koyu.png`.

## Kararlar (kullanıcı 2026-10-09 sabah) — belgeye işlendi (§8)
Hedef süre panelden sebep satırında · TV ayrı bağlantı, menüsüz, açılışta tam ekran · hol + numara ızgarası (kat planı yok) · kartta "bugün %", üst şeritte "şu an %" · ayrı "dokuma canlı izleme" izni + salt-okur TV hesabı. Mock 2 ve 4'e uyduruldu.

## Açık kalan (kullanıcı kararı bekler)
Modül anahtarı (`dokumaEnabled` mı `tezgahEnabled` mı) · iletim payı tek mi sebep başına mı. Gerçek uygulama parçaları: belge §9 (sebep kataloğu hedef süre kolonu, izin, TV bağlantısı + hesabı).
