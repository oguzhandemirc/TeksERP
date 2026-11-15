# Backend `2.16.6`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk ve tek hedef `test` grubu (grubun tek kurulumu `deneme-bulut`,
BARINDIRILAN, Linux, ONAYLI kip). Öncü/genel gruba çıkış ayrı karar (terfi etiketi). Kullanıcı onayı (deneme
dağıtımı): 2026-11-15.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki ve denemede kurulu sürüm 2.16.5 (etiket `backend-v2.16.5` →
`487ac40d5`).

Sürüm numarası: YAMA hanesi, otomatik (`node scripts/backend-surum.mjs`).

## 1. Özet

Bildirim tercih profilleri (hazır + kişisel kayıtlı; panel şeridi ve "Patron telefonu" sütunu), bildirim kataloğuna
yeni türler (fason fire farkı, yeniden işlem, disk dolu, acil işareti, brode özeti, büyük sipariş, mesai dışı giriş,
renk/reçete), koşul türlerinin varsayılan alıcısı "türü görebilen herkes", "Patron — tam okuma" rol şablonu, patron
push cihaz satırlarına 180 günlük budama ve paneldeki Switch/kenarlık çizim düzeltmesi. **1 göç** (yalnız ekleme).

## 2. Ne değişti

Ölçüm: `backend-v2.16.5` (`487ac40d5`) → `origin/main` @ `c8ca00c62`, ilk ebeveyn hattında 8 PR (#730–#737).
Alt proje farkı: `Teks-Erp/src` · `Teks-Erp/prisma` (1 göç) · `Teks-Erp/scripts` (bekçiler) · `Electron` (web paneli
imajın `/app/dist-web` dizinine girer) · `patron/sunucu` (bulut; ayrı dağıtım) · `patron/uygulama` · belge ve
gizlilik sayfası.

**Bildirim tercih profilleri (#731, #736)** — Bildirim tercihleri ekranının üstünde profil çipleri:
- Hazır profiller: Her şey · Yalnız önemliler · Özetler · Üretim · Satış ve sevkiyat · Finans · Güvenlik · Sessiz.
  Tür listesi yerine katalog grubundan / önem işaretinden türer; yeni tür kendiliğinden doğru profile girer. Her
  profil ALARM sınıfını içerir.
- Kişisel profiller: o anki seçim adla kaydedilir (kişi başına en çok 20, ad tekil); sil = arşiv.
- Profil bir kanala uygulanır; kilitli türlere ve öteki kanallara dokunmaz. Etkin profil adı ya da "Özel" görünür.
- Tür satırında yeni **"Patron telefonu"** sütunu. Sistem → Bildirim profilleri matrisinde "Hazır profilden doldur".
- Uçlar: `GET|POST /api/bildirim/tercihler/profiller`, `PATCH|DELETE /api/bildirim/tercihler/profiller/:id`,
  `POST /api/bildirim/tercihler/profil-uygula`, `GET /api/bildirim/profiller/hazir` (yönetici).

**Yeni bildirim türleri (#734, #735):** `fason.fire-farki` (giden/dönen metre farkı eşiği, varsayılan %3) ·
`fason.yeniden-islem` · `sistem.disk-dolu` (koşul, varsayılan %90) · `isemri.acil-isaretlendi` · `brode.gunluk-ozet`
(özet) · `siparis.buyuk-siparis` (varsayılan 5000 m) · `kimlik.mesai-disi-giris` · `anaveri.renk-olusturuldu` ·
`anaveri.recete-degisti`. Fason dokuma çıkışı/dönüşü artık `fason.cikis` / `fason.donus` yazar; sipariş, sevkiyat,
fason ve gelen belge metinlerine metre/adet eklendi (tutar yok). `cari.degisti` finans terimi değişikliklerini alan
adıyla yazar. `stok.yaslanan` deposu boş topları "Depo atanmamış" grubunda sayar.

**Mesai dışı giriş (#735):** web / yönetim paneli / patron uygulaması girişi mesai dışındaysa `admin:users`
izinlilere bildirim. Vardiya tanımlıysa süren vardiya esas; değilse katalog eşiği 07:00–19:00 (Bildirim profilleri →
Fabrika varsayılanları). Tablet girişi bildirmez; yükte IP/tarayıcı yok.

**Alıcısı değişen koşul türleri (#735) — varsayılan artık türü GÖREBİLEN herkes** (önceden yazma izni taşıyanlar):
`siparis.termin-yaklasti`, `siparis.termin-gecti` (önce `order:write`) · `isemri.gecikti` (`workorder:write`) ·
`kalite.kk1-oran-dusuk` (`quality:write`) · `kalite.sertifika-suresi-doluyor` (`certificate:write`) ·
`sevkiyat.onay-bekliyor`, `sevkiyat.sevke-hazir` (`shipping:write`) · `dokuma.levent-bitiyor` (`warpbeam:write`) ·
`cari.risk-limiti-asildi` (`finance:read`, davranış aynı). **`dokuma.levent-bitiyor` artık görme izni olan tablet
operatörlerine de gider.** OLAY türleri değişmedi. Daraltmak isteyen fabrika Bildirim profillerinden alıcıyı seçer.

**"Patron — tam okuma" rol şablonu (#735):** `WEB_PATRON_READ_ALL` — web okuma izinleri + `patron-app:login`
(mal kabul okuma dışında). Mevcut rollere dokunulmaz.

**Patron push (#732, #733):** bildirime dokununca kayda git — sipariş / cari kartı / sevkiyat / teklif / iş emri
türlerinde `data.rota` kayıt kimliğini taşır (tel değişmedi; eski uygulama listeye düşer). Gece bakımı fabrika
DB'sindeki `BIRAKILDI` durumlu ve 180 günden uzun görülmemiş push cihaz satırlarını siler (canlı ve bırakılacak satır
kalır; defter değil).

**Panel çizim düzeltmesi (#736):** tema geçiş kuralı CSS'teki `@property` kayıtlarını yutuyordu; her Switch'in topuzu
solda kalıyor, kenarlık yardımcıları çizgisiz çiziliyordu. Düzeltildi.

`tekserp-guncelleyici`, `tekserp-hizmet`, `Teks-Erp/native`, `Teks-Erp/docker`, `deploy/pg`, `Dockerfile`
DEĞİŞMEDİ. Yeni bağımlılık yok.

Tam döküm: Ek A.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (`backend-v2.16.5..c8ca00c62`).
  - Uçlar yalnız EKLENDİ (profil uçları); kaldırılan/değişen uç yok.
  - Push yükünde `data.rota` iki parçalı olabilir (bölüm + kayıt kimliği); `PushRouteSchema` buna zaten izin veriyordu.
  - Buluta giden tel ve projeksiyonlar değişmedi. Bulutun yeni ucu `POST /api/cihazlar/birak` uygulama içindir; bulut
    bu sürümden ÖNCE yükseltildi.
- **Eski istemci ne yapar:**
  - Masaüstü panel (eski sürüm): profil uçlarını bilmez; bugünkü tercih düğmeleri ve `PUT /tercihler` aynen çalışır.
    Web paneli imajla birlikte yenilenir.
  - Tablet: etkilenmez; `dokuma.levent-bitiyor` görme izni olan operatörlere de düşer.
  - Patron uygulaması (eski): profil çipleri yerine bugünkü üç düğme; yeni rotaları tanımazsa bildirim listesine düşer.
- **`minVersion` dokunuldu mu:** hayır.
- **Yeni bayraklar:** yok. Yeni türler mevcut `bildirim.gelenKutusuEnabled` / `bildirim.patronPushEnabled`
  bayraklarının arkasında.

## 4. Migration

- **Var mı:** EVET, 1: `20261115120000_bildirim_tercih_profilleri` — yeni tablo `notification_preference_profiles`
  (CHECK: açık/kapalı kümeler ayrık; kişi başına canlı ad tekil). YALNIZ EKLEME: mevcut tabloya dokunmaz, backfill
  yok, idempotent (`IF NOT EXISTS` / `duplicate_object`).
- **Toplam migration:** 519 (2.16.5: 518). Değiştirilen/silinen eski göç yok; veri değiştiren betik yok.
- **Geri alınabilir mi:** göç geri alınmaz; 2.16.5 imajı yeni tabloyu okumaz, aynı şemayla açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + yeniden başlatma; deneme ölçeğinde bir dakikadan az.
- **Sıra:** patron bulutu ÖNCE (yapıldı) → backend (web paneli imajla birlikte) → masaüstü panel ve patron uygulaması
  bağımsız.
- **Bu sürüme özel:** yayından sonra deneme panelinde "Şimdi yokla" (runbook §16.4 adım 4b). Kurulum hiçbir ayar ya da
  tercih satırı yazmaz. Test grubunda koşul türlerinin alıcı sayısı artabilir (§2).
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış: alıcısı değişen koşul türü Bildirim profillerinden daraltılır; istenmeyen yeni tür kapatılır. Sürüm:
güncelleyiciyle kurulan sürüm açılmazsa önceki imaja ve güncelleme öncesi yedeğe kendiliğinden dönülür
(`GERI_DONDU`). Göç yalnız ekleme olduğundan 2.16.5 imajı aynı şemayla açılır; yine de grupta geri inme yok, düzeltme
ileri sürümle. Etiket `backend-v2.16.6` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.16.6; güncelleyici durumu `BASARILI`.
- Veritabanı: 519 migration bitmiş, yarım/geri alınmış 0; `notification_preference_profiles` var.
- `GET /api/client-policy/patron` 200.
- Bildirim kataloğu yeni türleri taşır; hazır profil listesi (`GET /api/bildirim/profiller/hazir`) 200.
- Kurulum sırasında/sonrasında `notification_conditions`ta yeni `sistem.lisans-uyarisi` kaydı yok.
- Konteyner günlüğünde koşul tarayıcısı / `bildirim-ozet` / budama hatası yok.
- Web panelinde Ayarlar → Bildirim tercihleri: profil çipleri ve "Patron telefonu" sütunu; Switch'ler düzgün çizilir.
- Patron bulutu eşitlemesi kurulumdan sonra 200 sürüyor.

## Ek A — commit dökümü (ilk ebeveyn, eskiden yeniye, 8)

- `f44e3bfcc` #730 docs(patron): gizlilik politikası YONETIM-GP-2026.5 — telefon push
- `3ff7bd846` #732 fix(patron-app): denetim düzeltmeleri — kanal, tablet seçici, kapalı modül, ikon, kayda git, ray
- `351cfe612` #733 fix(patron): bulutta çıkışta push bağı bırakılır, fabrika cihaz satırı 180 gün
- `1f69d16de` #734 feat(bildirim): S6a fason fire farkı, yeniden işlem, disk dolu, acil işareti, brode özeti, büyük sipariş
- `6d4c922ac` #735 feat(bildirim): S6b — kalan boşluklar, Patron tam okuma şablonu, koşul türleri herkese
- `926220196` #731 feat(bildirim): tercih profilleri — backend (hazır + kişisel)
- `3e54b6c95` #737 fix(patron-app): başlık-eylem hizası, kompakt KPI kartı, sade ray
- `c8ca00c62` #736 feat(bildirim): tercih profilleri — panel şeridi + patron uygulaması çipleri

## Ek B — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel turunda `surum-notlari.json`a girer. Metin terfide
kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-15b",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Bildirim profilleri ve yeni bildirimler",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Bildirim tercihlerinde hazır profiller (Yalnız önemliler, Üretim, Finans, Sessiz…) ve kendi kaydettiğiniz profiller; tek dokunuşla uygulanır. Tür listesinde patron telefonu sütunu var." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Yeni bildirimler: fason fire farkı, yeniden işlem, disk dolmak üzere, acil işaretlenen iş emri, brode günlük özeti, büyük sipariş, mesai dışında giriş." },
    { "kapsam": "her-ikisi", "tip": "iyilestirme", "metin": "Termin, gecikme, kalite, sevke hazır ve levent bitiyor uyarıları artık o ekranı görebilen herkese gider; levent bitiyor uyarısı tablet operatörlerine de düşer. Daraltmak için Bildirim profilleri ekranını kullanın." },
    { "kapsam": "panel", "tip": "duzeltme", "metin": "Açma/kapama düğmeleri ve kenarlıklar yeniden doğru çiziliyor." }
  ]
}
```
