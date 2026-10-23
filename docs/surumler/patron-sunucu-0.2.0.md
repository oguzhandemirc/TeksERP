# Patron bulut sunucusu `0.2.0`

**Durum:** TASLAK — canlıya alma kullanıcı kararı (VDS yazımı yalnız kullanıcının "uygula" cümlesiyle;
`docs/ops/PATRON-BULUTU-KURULUM.md` §4, §8). Bu belge `test_surum_belgesi` kapsamı dışındadır (yalnız `backend-*.md`).
**İmaj etiketi:** _(imaj derlemesi doldurur — `deploy/patron/imaj-derle.sh --platform linux/amd64`, temiz main'den)_
**Arşiv SHA256:** _(imaj derlemesi doldurur)_
**Önceki saha sürümü:** 0.1.x — VDS'te çalışan imaj etiketi yükseltmeden önce `.env`'den okunur (son kayıt runbook
§15a: `e847c7a55f3e`); tahmin edilmez.

## 1. Özet

Patron uygulaması v2'nin bulut tarafı: veri değişti sinyali (uzun yoklama) ve liste süzgeçleri/sipariş araması.
Fabrika backend'inden (2.15.13) ve uygulamadan (1.1.0) bağımsız yükseltilebilir.

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
- Web: imajla gelen web uygulaması 1.1.0 (v2 görünümü).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR. Yeni uç, opsiyonel yanıt alanı ve yeni sorgu parametreleri; var olan uçların alan kümesi aynı
  (`/api/oturum` yalnız `liste` eklendi; `/v1/esitle` aynı — bekçi `test_degisim_sayaci` §6).
- **N/N−1:**
  - Eski uygulama (1.0.x) → yeni bulut: hiçbir yanıt gövdesinde fark görmez; `liste` alanını tanımaz ve yok sayar.
  - Yeni uygulama (1.1.0) → eski bulut: `/api/degisim` 404 → 60 sn yoklama kipine düşer; `/oturum`da `liste` yok →
    eski liste görünümü (durum süzgeci, kalem özeti), kimlik süzgeci gönderilmez.
  - Fabrika 2.15.13 → eski bulut: yeni ad alanlı paketi KABUL eder (ölçüldü). Fabrika ≤ 2.15.12 → yeni bulut: ad
    alanları yok, uygulama "—" yazar; arama yalnız sipariş no ile bulur.
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
- **Bu sürüme özel:** `docker-compose.yml`, `ornek.env`, `Dockerfile` değişikliği beyanı imaj derlemesi anında
  `git diff` ile ölçülür ve runbook kaydına yazılır. Yeni zorunlu değişken/sır yok.
- **Sınırlar:** VDS'e her yazım kullanıcının "uygula" cümlesiyle · `docker compose down -v` YOK · DB drop YOK ·
  satıcıya dokunulmaz · göç adımından sonra hata → DUR, insana rapor et.

## 6. Geri alma

`.env`'e önceki imaj etiketleri geri yazılır + `docker compose up -d` (eski imaj VDS'te bir sürüm boyunca kalır).
Göç geri alınmaz; iki kolon DEFAULT'lu ve eski sunucu onları okumadığı için eski imaj aynı DB ile çalışır. Veri
gerekirse yükseltme öncesi yedekten (§7). Yeni uygulama eski buluta düşünce yoklama kipine ve eski liste görünümüne
kendiliğinden geçer.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- `docker ps`: `patron` ve `yedek` yeni etikette, sağlıklı; günlükte hata yok.
- Göç: `20261022120000_degisim_sayaci` bitmiş.
- `GET /api/oturum` (oturumlu) yanıtında `liste` alanı var.
- `GET /api/degisim?since=0&bekle=0` 200 ve `sayac` sayısal.
- Uygulama 1.1.0 ile: sipariş listesinde arama alanı ve çipler görünüyor; fabrika eşitlemesi sonrası liste kendiliğinden
  tazeleniyor.
- Eski uygulama (1.0.x) ile giriş ve pano bugünkü gibi.
