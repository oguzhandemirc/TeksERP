# Patron bulut sunucusu `0.2.0`

**Durum:** VDS'TE (2026-10-26) — kullanıcının "uygula" cümlesi 2026-10-26 12:40 (Y3); kayıt
`docs/ops/PATRON-BULUTU-KURULUM.md` §13e. Bu belge `test_surum_belgesi` kapsamı dışındadır (yalnız `backend-*.md`).
Önceki 0.2.0 taslağı (2026-10-24, aday `2bd3d7b0855e`) hiç çıkmadı; kapsam AYNI numarayla çalışan etiketten HEAD'e
genişletildi.
**İmaj etiketi:** `tekserp-patron:5156f26d2259` · `tekserp-patron-yedek:5156f26d2259` (linux/amd64; kaynak `origin/main` @ `5156f26d2`, temiz worktree; imaj kimliği `sha256:a03917e1…` · yedek `sha256:37625313…`)
**Arşiv SHA256:** `dcd92cfd3b29929cbca216405a6c7acd9c0900e533fda95b78d1dd0f821ab3ae` (`~/.tekserp/patron-imaj/tekserp-patron-5156f26d2259.tar.gz`, 325 295 612 bayt)
**Önceki saha sürümü:** `tekserp-patron:e847c7a55f3e` (VDS `.env`'den okundu 2026-10-26 17:02Z; runbook §15a) — merkez
ve tesis DB'si 9 göç, tek tesis (`8716286a…`, fabrika 2.15.12).

## 1. Özet

Patron uygulaması v2'nin bulut tarafı: veri değişti sinyali (uzun yoklama), liste süzgeçleri/sipariş araması, v2 web
ekranları, raporlar v2'nin bulut sunumu (R1-BULUT), teklif/standart-maliyet projeksiyonları (MAL-8) ve bildirim N5
telefon-push hazırlığı (bayrak arkasında, kapalı). Fabrika backend'inden (2.15.13) ve uygulamadan (1.1.0/1.2.0)
bağımsız yükseltilebilir. Kapsam: `git log e847c7a55..HEAD -- patron/ deploy/patron` (21 commit; sunucu 31 dosya
+1387/−37, uygulama 177 dosya +12768/−1032).

## 2. Ne değişti

**Değişim sayacı ve uzun yoklama — P3** (PR #88; commit `d64764d30`)

- `GET /api/degisim?since=<n>&bekle=<0..25>`: `sayac > since` olunca ya da süre dolunca döner; içerik taşımaz.
  Yanıt `{ sayac, degisenler, fabrikaDamgasi }` — `degisenler` hesabın okuyabildiği projeksiyon adlarıdır (halka
  eskiyse hepsi). Sayaç yalnız fabrikadan veri KABUL edildiğinde artar (tesis başına monoton).
- Rapor sonucu ve gelen kutusu sonucu sayaç artırmaz (bilinçli; gerekçe arşiv notunda).

**Liste kimlik süzgeçleri ve sipariş araması — P6** (PR #96; commit `21bb4a298`)

- `LIST_ID_FILTERS` (`wire/api.ts`, TEK beyan): `cariKartId` · `cariHesapId` · `siparisId` → alanı taşıyan
  projeksiyonlar; `GET /api/veri/:projeksiyon?<anahtar>=<uuid>`. Beyansız çift **400** (fail-closed). Önceden
  `cariKartId` her projeksiyonda kabul edilip boş dönüyordu; eski uygulama onu yalnız `siparis` ve `cari-hesap`ta
  kullanır, ikisi de beyanlı.
- `LIST_SEARCH.siparis`: `?ara=` `siparisNo` + `musteriAdi` (fabrika 2.15.13 alanı; eski satır yalnız no ile bulunur);
  `?suzgec=` çipleri Gecikmiş + beş durum.
- `GET /api/oturum` yanıtına OPSİYONEL `liste` alanı: `{ kimlikSuzgecleri, aranabilir }`. Uygulama yeni listeleri
  (kimlik süzgeci, arama, çipler) yalnız bu alan varsa açar.
- Web: imajla gelen web uygulaması v2 görünümü (uygulama 1.2.0 kaynağıyla aynı kod; `app.json` sürümü).

**v2 ekranları — P1/E1–E4** (PR #89, #92, #93, #94, #95, #98; ikon fontu CSP düzeltmesi #100)

- Tema belirteçleri + bileşen kiti + sekme gezinmesi; pano/üretim/stok/sevkiyat, sipariş/cari, finans/rapor/kayıt
  detayı, daha fazla/gelen kutusu/bildirim/hesap/profil/giriş ekranları. Veri katmanı stale-while-revalidate, ön plana
  dönüşte tazeleme, değişim akışı istemcisi (#86, #91). Web'de ikon fontu `insertRule` ile CSSOM'a yazılır — CSP
  gevşetilmedi (#100; tarayıcı dumanı CSP 0 · konsol 0).
- UX-4 (#224): ad/grup/boş durum tutarlılığı + bildirim izni akışı (telefonda yalnız native push kapısı açıkken çıkar).

**Raporlar v2 bulut sunumu — R1-BULUT** (PR #160, #166, #169, #173)

- `catalog/reports.ts`: 13 v2 rapor anahtarı (`sales/*` · `quality/*` · `inventory/depo` · `subcontract/fasoncular` ·
  `dokuma/*` · `finance/alacaklar`) kendi bulut izniyle; `REPORTS_NOT_IN_CLOUD` (`audit/*` · operatör performansı ·
  üretim akışı) buluta HİÇ gitmez. Sonuç fabrikada kurulmuş `RaporSunumu`dur (tel tipi `wire/api.ts`); bulut hesap
  yapmaz. Fiyat izni olmayan hesapta para birimli HER alan düşürülür (#169; K-BULUT). Eski 8 uzak rapor fabrika-günü
  aralığı kabul eder (#166). Varyant/çok dönem/kayıt menüsü uygulama tarafında (#173).

**Teklif ve standart maliyet projeksiyonları — MAL-8** (PR #229)

- Projeksiyon kataloğuna `teklif` · `teklif-kalemi` (ebeveyn `teklif`) · `standart-maliyet` (OLGU). İzin kataloğuna iki
  kod: `bulut:teklif:oku` (satır) + `bulut:maliyet:oku` (`.finans` alt satırı: tutar · kur · maliyet · marj; fiyat izni
  AÇMAZ). SATIS şablonu teklifi görür, maliyeti görmez. İzin kataloğu KODDADIR; göç yok.
- **Eski fabrika ne yapar:** 2.15.12 bu projeksiyonları GÖNDERMEZ → bulut tarafında etkisiz (katalog satırı boş kalır);
  2.15.13+ gönderince saklanır.

**Bildirim N5 — telefon push hazırlığı** (PR #203; bayrak arkasında, bu sürümde KAPALI)

- `BILDIRIM_NATIVE_PUSH` (`kapali`|`acik`, varsayılan `kapali`) + `EXPO_ERISIM_BELIRTECI` (isteğe bağlı sır, compose'a
  henüz bağlı DEĞİL). Kapı fail-closed: `acik` ∧ `BILDIRIM_KIPI=gercek` ∧ belirteç yoksa KAPALI + tek satır günlük
  (`PATRON_BILDIRIM native=kapali (<neden>)`). Tür eşleme + içeriksiz yük. `.env`'e yeni ZORUNLU değişken yok.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR. Yeni uç, opsiyonel yanıt alanı, yeni sorgu parametreleri, yeni projeksiyon/rapor/izin
  kataloğu satırları; var olan uçların alan kümesi aynı (`/api/oturum` yalnız `liste` eklendi; `/v1/esitle` aynı —
  bekçi `test_degisim_sayaci` §6; `wire/esitleme.ts` farkı yalnız `teklif-kalemi` ebeveyn beyanı).
- **N/N−1:**
  - Eski uygulama (1.0.x) → yeni bulut: hiçbir yanıt gövdesinde fark görmez; `liste` alanını tanımaz ve yok sayar.
  - Yeni uygulama (1.1.0) → eski bulut: `/api/degisim` 404 → 60 sn yoklama kipine düşer; `/oturum`da `liste` yok →
    eski liste görünümü (durum süzgeci, kalem özeti), kimlik süzgeci gönderilmez.
  - Fabrika 2.15.13 → eski bulut: yeni ad alanlı paketi KABUL eder (ölçüldü). Fabrika ≤ 2.15.12 → yeni bulut: ad
    alanları yok, uygulama "—" yazar; arama yalnız sipariş no ile bulur; teklif/standart-maliyet projeksiyonları ve
    v2 rapor sunumları gelmez (ekranlar boş durum gösterir) — eski fabrika YENİ projeksiyon göndermez, etkisiz.
  - Sonuç: **dağıtım sırası serbest.**
- **`minVersion`:** gerekmez.

## 4. Migration

- **Var mı:** EVET — 1 göç: `20261022120000_degisim_sayaci` — `sync_state` tablosuna iki DEFAULT'lu kolon:
  `change_counter BIGINT NOT NULL DEFAULT 0` ve `changed_projections JSONB NOT NULL DEFAULT '[]'`. Yeni tablo YOK
  (RLS/`CLOUD_TABLES`/yetki aynı satırda); veri yazmaz, mevcut satırlar 0 ve `[]` ile doğar.
- **Uygulama:** `sudo docker compose --profile goc run --rm patron-goc` — merkez `migrate deploy` → roller → `tesis-db.js goc` ile her HAZIR tesis DB'sine eksik göç (roller idempotent).
- **Toplam göç:** önceki sürüm + 1. Göç sonrası `_prisma_migrations`ta `20261022120000_degisim_sayaci` bitmiş olmalı.
- **Geri alınabilir mi:** göç geri alınmaz; kolonlar DEFAULT'lu olduğundan eski imaj onlarla çalışır (okumaz).

## 5. Kurulum notu

- **Beklenen kesinti:** `docker compose up -d` yeniden başlatması kadar (saniyeler); uygulama yeniden bağlanır.
- **Sıra:** serbest (bkz. §3). Runbook §8 kalıbı: yeni imaj → `exec patron-yedek … tek` (önce yedek) → `.env`'de iki
  imaj etiketi → `--profile goc run --rm patron-goc` → `docker compose up -d`.
- **Bu sürüme özel:** `git diff e847c7a55 HEAD -- deploy/patron patron/sunucu/prisma` → `docker-compose.yml` ve
  `Dockerfile` AYNI (VDS compose sha `b972070a…` = repo); `ornek.env` farkı tek yorum satırı (telefon push henüz
  bağlı değil). Yeni zorunlu değişken/sır yok; `.env`'de yalnız iki imaj etiketi değişir.
- **Sınırlar:** VDS'e her yazım kullanıcının "uygula" cümlesiyle · `docker compose down -v` YOK · DB drop YOK ·
  satıcıya dokunulmaz · göç adımından sonra hata → DUR, insana rapor et.

## 6. Geri alma

`.env`'e önceki imaj etiketleri geri yazılır + `docker compose up -d` (eski imaj VDS'te bir sürüm boyunca kalır).
Göç geri alınmaz; iki kolon DEFAULT'lu ve eski sunucu onları okumadığı için eski imaj aynı DB ile çalışır. Veri
gerekirse yükseltme öncesi yedekten (§7). Yeni uygulama eski buluta düşünce yoklama kipine ve eski liste görünümüne
kendiliğinden geçer.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- `docker ps`: `patron` ve `yedek` yeni etikette, sağlıklı; günlükte hata yok.
- Göç: `20261022120000_degisim_sayaci` bitmiş (merkez + her tesis DB'si 10 göç, yarım 0).
- `GET /api/oturum` (oturumlu) yanıtında `liste` alanı var.
- `GET /api/degisim?since=0&bekle=0` 200 ve `sayac` sayısal.
- Uygulama 1.1.0 ile: sipariş listesinde arama alanı ve çipler görünüyor; fabrika eşitlemesi sonrası liste kendiliğinden
  tazeleniyor.
- Eski uygulama (1.0.x) ile giriş ve pano bugünkü gibi.
