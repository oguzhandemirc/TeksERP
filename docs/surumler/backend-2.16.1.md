# Backend `2.16.1`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk ve tek hedef `test` grubu (grubun tek kurulumu `deneme-bulut`,
BARINDIRILAN, Linux, ONAYLI kip — 2.16.0 turunda satıcıda ölçüldü, 2026-11-13). Öncü/genel gruba çıkış ayrı karar
(terfi etiketi). Kullanıcı onayı (deneme dağıtımı): 2026-11-14 "devam edebilirsin".
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki ve denemede kurulu sürüm 2.16.0 (etiket `backend-v2.16.0` →
`a12affbfd`).

Sürüm numarası: YAMA hanesi, otomatik (`node scripts/backend-surum.mjs`).

## 1. Özet

Patron telefonuna bildirim sesi seçimi (TeksERP sesleri, ses × sınıf başına Android kanalı), satış ve planlama
bildirimleri (17 yeni tür, saatlik/vardiya/gün sonu özetleri), patron uygulaması için açılış panosu kutuları ucu.
1 göç, yalnız ekleme (varsayılanlı iki kolon). Davranış yeni bildirim türlerinde, mevcut bildirim bayraklarının
arkasında.

## 2. Ne değişti

Ölçüm: `backend-v2.16.0` (`a12affbfd`) → `origin/main` @ `143003333`, ilk ebeveyn hattında 7 PR (#701–#707).
Alt proje farkı: `Teks-Erp/src` · `Electron/src` (yalnız bildirim biçimi/gruplama, web paneli imaja girer) ·
`patron/` (bulut 2026-11-14'te `143003333f51`e yükseltildi — "bulut önce") · `scripts/deneme-veri`.

**Bildirim sesi (S0, #703)** — `POST /api/bildirim/cihaz` gövdesine isteğe bağlı `sesBildirim` / `sesAlarm`
(`tekserp_zil` · `tekserp_alarm` · `tekserp_mekik` · `tekserp_dokuma` · `tekserp_kisa` · `varsayilan` · `sessiz`);
yoksa zil/alarm. Ses değişince buluttaki bağ yeniden `kaydet`lenir (BEKLIYOR). Buluta giden `kaydet` teli sesleri
taşır (bulut bunu `143003333f51`ten itibaren kabul eder).

**Bildirim kataloğu S1 (#706)** — satış ve planlama alanında 17 tür (sipariş/teklif olayları, iş emri olayları),
özet türleri için zamanlayıcı `notification-digest.job` (pencere başına tek satır, 8040 kilidi, ilk tur yalnız damga
kurar); patron eşlemesi `notification-patron-map`; katalog yanıtına `onemli` ve `ozet` alanları.

**Patron panosu (#707)** — `GET /api/patron/v1/pano/kutular` ve `GET /api/patron/v1/pano?kutular=&donem=` (panelin
açılış panosu kutularıyla aynı kaynak; `patron-app:login` + pano izinleri); `/api/auth/me` `patronPano: 1`.

**Diğer** — patron uygulaması düzeltmeleri (#701, #702, #705; backend imajına girmez), deneme verisi betiği (#704).

`tekserp-guncelleyici`, `tekserp-hizmet`, `deploy/`, `Teks-Erp/native`, `Teks-Erp/docker`, `Dockerfile`
DEĞİŞMEDİ. Yeni bağımlılık yok.

Tam döküm: Ek A.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (`backend-v2.16.0..143003333`).
  - Uç kaldırma/yeniden adlandırma yok; yeni uçlar yalnız `/api/patron/v1/pano*`.
  - `POST /api/bildirim/cihaz`: iki alan İSTEĞE BAĞLI eklendi (katı şema, eski gövde aynen geçer).
  - Buluta giden `kaydet` teli yeni alan taşır ve bulut gövdeleri katıdır → bulut ÖNCE yükseltildi
    (`143003333f51`, 2026-11-14 09:45Z).
- **Eski istemci ne yapar:**
  - Masaüstü panel / tablet: etkilenmez (yeni türler bildirim listesinde görünür; biçim web panelinde imajla gelir).
  - Patron uygulaması (yayındaki 1.2.0 vc3, ses alanı yok): ses göndermez → varsayılan zil/alarm; pano alanını
    okumazsa yerel özet panosu.
  - Patron bulutu: güncel.
- **`minVersion` dokunuldu mu:** hayır.
- **Yeni bayraklar:** yok. Yeni türler mevcut `bildirim.gelenKutusuEnabled` / `bildirim.patronPushEnabled`
  bayraklarının arkasında; patron push tercihi tüm türlerde varsayılan AÇIK (kullanıcı kararı 2026-11-14, K-planı).

## 4. Migration

- **Var mı:** EVET — 1 adet `20261114120000_patron_push_ses`.
- **Toplam migration:** 518 (2.16.0'da 517). Değiştirilen/silinen eski göç yok.
- **Ne yapar:** `patron_push_tokens`a varsayılanlı iki kolon (`soundNotification` `tekserp_zil`, `soundAlarm`
  `tekserp_alarm`) + iki CHECK. Yalnız EKLER; mevcut satırları değiştiren UPDATE/backfill YOK.
- **Geri alınabilir mi:** HAYIR (bu depoda migration geri alınamaz); 2.16.0 imajı ek kolonlarla açılır (kolonları
  okumaz).

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + 1 göç + yeniden başlatma; deneme ölçeğinde bir dakikadan az.
- **Sıra:** patron bulutu önce (yapıldı) → backend → patron uygulaması (ses ekranı olan derleme).
- **Bu sürüme özel:** yok. Bayraklar denemede zaten açık (2.16.0 turu).
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış: bildirim bayrakları panelden kapatılır. Sürüm: güncelleyiciyle kurulan sürüm açılmazsa önceki imaja ve
güncelleme öncesi yedeğe kendiliğinden dönülür (`GERI_DONDU`). Kurulduktan sonra dönmek gerekirse 2.16.0 imajı ek
kolonlu şemayla açılır; yine de grupta geri inme yok, düzeltme ileri sürümle. Etiket `backend-v2.16.1` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.16.1; güncelleyici durumu `BASARILI`.
- Veritabanı: 518 migration bitmiş, yarım 0; `patron_push_tokens.soundNotification` var.
- `GET /api/client-policy/patron` 200.
- `POST /api/bildirim/cihaz` `sesBildirim`/`sesAlarm` alanlarını kabul eder (geçersiz değer 400).
- Patron bulutu eşitlemesi (`POST /v1/esitle`) kurulumdan sonra 200 sürüyor.
- Konteyner günlüğünde yeni hata yok.

## Ek A — commit dökümü (ilk ebeveyn, eskiden yeniye, 7)

- `1cced51b3` #701 fix(patron-app): stop push token re-registration loop
- `2dda0d2b9` #702 fix(patron): safe-area rail, collapsible side nav, lateral rail navigation without stack animation
- `297ed2163` #705 fix(patron): tighten empty states, balanced KPI grid, auth safe area
- `fcc3c6b56` #704 fix(deneme-veri): partial tambur stage stays partial on rerun
- `bf58ed373` #703 feat(bildirim): phone notification sound, per-sound channels and quick toggles (S0)
- `fce67f404` #707 feat(patron): pano kutuları okuma ucu /api/patron/v1/pano
- `143003333` #706 feat(bildirim): broad notification catalog skeleton + sales/quote/work-order kinds (S1)

## Ek B — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel turunda `surum-notlari.json`a girer. Metin terfide
kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-14a",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Patron telefonuna yeni bildirimler ve bildirim sesi seçimi",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Satış ve planlama olayları (yeni sipariş, teklif, iş emri değişiklikleri) bildirim olarak gelir; sık olaylar saatlik, vardiya ya da gün sonu özeti olarak toplanır." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Patron telefon uygulamasında bildirim ve alarm sesi seçilebilir (TeksERP sesleri, telefonun sesi ya da sessiz)." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Patron telefon uygulamasının panosu, paneldeki açılış panosu kutularından seçilerek düzenlenebilir." }
  ]
}
```
