# Backend `2.16.9`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk ve tek hedef `test` grubu (grubun tek kurulumu `deneme-bulut`,
BARINDIRILAN, Linux, ONAYLI kip). Öncü/genel gruba çıkış ayrı karar (terfi etiketi). Deneme dağıtımı görevi:
2026-11-19 ("deneme 2.16.9 + yerel demo main").
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki ve denemede kurulu sürüm 2.16.8 (etiket `backend-v2.16.8` →
`58c00aaa0`).

Sürüm numarası: YAMA hanesi, otomatik (`node scripts/backend-surum.mjs`).

## 1. Özet

Fason devere: iadede fire ve kalan sıfırlanınca otomatik kapanış, "levent adedi belli değil" (yalnız toplam metre),
Fasondaki İplik sayfasında süzgeç/değer/satır eylemleri/fasoncu ekstresi, fason seçicilerinde kategori süzgeci. İş
emrinde sipariş paylaştırması ve planlama notu. Bildirim: yeni türler (top fire/iptal, sevkiyat oluşturuldu, gün sonu
özeti), profil tercih kilidi, kişi kartında Bildirimler sekmesi, çok sekmede zil akışı düzeltmesi. Bağlı İstemcilerde
açık oturumlar + sonlandırma. Defterli boş çuval silinmez, emekliye ayrılır. Patron iş emri projeksiyonu
catalogVersion 3 (**bulut önce**). **Beş göç, hepsi yalnız ekleme/gevşetme.**

## 2. Ne değişti

Ölçüm: `backend-v2.16.8` (`58c00aaa0`) → `origin/main` @ `02d3f48d8`, ilk ebeveyn hattında 16 PR (#776–#791).
Alt proje farkı: `Teks-Erp/src` · `Teks-Erp/prisma` (5 göç) · `Teks-Erp/scripts` (bekçiler) · `Electron` (web paneli
imajın `/app/dist-web` dizinine girer) · `mobil/src` (yalnız JS; tablet OTA turuna kalır) · `patron/sunucu` +
`patron/uygulama` (bulut ayrı dağıtılır) · belge.

**Fason devere — iade firesi ve otomatik kapanış (#785)** — İade penceresinden kullanılamaz iplik fire olarak aynı
tx'te yazılır (tek yazar `warping-order/waste-write.ts`, defter `WarpingYarnWaste`, DB CHECK: kaynak kapanış XOR iade
hareketi). İade ya da aktarma sonrası deverecide tutma 0 ve `settleBlockers` boşsa sipariş aynı tx'te kendiliğinden
kapanır (audit `auto: true`). Yeni önizleme ucu `POST /api/warping-orders/:id/yarn-returns/preview`. İade ucunda
isteğe bağlı `clientToken` (token'sız eski çağrı çalışır). İade stornosu bağlı fireyi geri alır.

**Fason devere — levent adedi belli değil (#790)** — Sipariş yalnız toplam metreyle açılabilir (`openTargetLengthM`,
`beamLines` ile XOR; ikisi birden ya da hiçbiri 400 `WARPING_BEAM_LINES_INVALID`). Yanıtlar `beamCount: number | null`
+ yeni `beamCountOpen`; mutabakatta `planBeamCountOpen`. Varsayılan bugünkü adet × boy davranışı.

**Fasondaki İplik (#789)** — `GET /api/warping-orders/yarn-at-subcontractor`: `filter[lotId]` (geçersiz kimlik 400),
`search` (≤100), değer (tek kaynak `readYarnLotReceiptPrices`; fiyat alanları `goods-receipt:read` OPT-IN). Panel:
satır eylemleri (İade al / Başka siparişe aktar), fasoncu ekstresi penceresi. Yanıta yalnız opsiyonel alan eklendi.

**Fason kategori süzgeci (#788)** — `GET /api/subcontractors` `filter[categoryId]` artık `readFilterList` ile okunur;
bozuk/tanınmayan değer 400 `SUBCONTRACTOR_CATEGORY_FILTER_INVALID` (eskiden P2007 ya da sessiz 0 satır). Uç
`mode=cursor` kipini öğrendi; sayfa kipi değişmedi. Panel: devereci/fasoncu/rota adımı seçicileri beklenen
kategoriye süzülür ("Tümünü göster" anahtarı), cari formunda kategori seçimi.

**İş emri paylaştırma + planlama notu (#780)** — `PUT /api/work-orders/:id/order-links/allocations`
(`workorder:write`; tavan aşımı 400 `ALLOCATION_OVER_BASIS`, koparılan bağ 409 `ORDER_LINK_CHANGED`, donmuş plan 409
`WO_PLAN_FROZEN`) ve `GET/PUT /api/work-orders/:id/note` (≤2000, boş = temizle). Paylaştırma yalnız plandır: top bağı,
sevk, kapsama ve bulut okumaz. Detay yanıtına `allocation` eklendi.

**Bildirim yönetimi (#786)** — `NotificationProfile.prefsLocked` (varsayılan kapalı): açıkken üyenin kendi uygulama
içi tercih değişikliği 409 `NOTIFICATION_PREFS_LOCKED`. Yönetici uçları `GET/PUT /api/bildirim/kullanicilar/:id/tercihler`
(`settings:notifications` ∨ `admin:settings`, PUT delta). Tercih yanıtına `tercihKilidi` eklendi.

**Yeni bildirim türleri (#778)** — `stok.top-fire-iptal` (varsayılan: `roll:manual-adjust` sahipleri),
`sevkiyat.olusturuldu` (varsayılan KAPALI), `genel.gun-sonu-ozeti` (varsayılan KAPALI). Yeni ayar
`bildirim.gunSonuOzeti.saat` (varsayılan `00:00` = biten fabrika günü). Üç tür de patron telefonuna gitmez.

**Zil akışı (#776)** — Sunucu değişmedi. Panel ve tablet, kullanıcı başına akış tavanında gelen `kapat{neden:"fazla"}`
sonrası hemen yeniden bağlanmak yerine uzun yoklamaya geçer (çok sekmede akışların birbirini kovması bitti).

**Bağlı İstemciler — açık oturumlar (#782)** — `GET /api/admin/open-sessions` (`admin:settings` ∨ `system:clients`;
yanıtta jti/belirteç yok) ve `POST /api/admin/open-sessions/:id/revoke` (`admin:users`; atomik claim, kendi oturumu
400, en yetkili hesap 403). Audit `SESSION_REVOKED_BY_ADMIN`.

**Çuval emekliye ayırma (#779)** — Tahsis defteri olan boş havuz çuvalı "sil"de sert silinmez (eskiden P2003),
`retiredAt` ile damgalanır; havuz okuyucuları ve bağlama claim'leri emekli çuvalı süzer. Defteri olmayan çuvalda
bugünkü silme aynen.

**Patron iş emri v3 (#783)** — `is-emri` projeksiyonu catalogVersion 3 (yalnız ekleme, TAM gönderim): açık/kapalı,
müşteri/sipariş/ürün/renk adları, aşama kırılımı, fason firma payları; ERP okuma ucunda üyelik süzgeçleri.

**Yalnız panel (backend değişmedi):** müşteri kartı Özet sekmesi (#777), geniş çözgü kartı formu + canlı hesap
paneli (#781), modal bölüm görünürlüğü (#784; tercih mevcut `UserPreference` gevşek kaydında), Sevk Edilenler fatura
sütunu / Belgeler / ⋯ menüsü (#787). #791 yalnız belge.

Yeni izin yok. Yeni modül bayrağı yok. Yeni ayar: `bildirim.gunSonuOzeti.saat`.

`tekserp-guncelleyici`, `tekserp-hizmet`, `Teks-Erp/native`, `Teks-Erp/docker`, `deploy/` DEĞİŞMEDİ. Yeni bağımlılık
yok.

Tam döküm: Ek A.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (`backend-v2.16.8..02d3f48d8`).
  - Uçlar yalnız EKLENDİ (paylaştırma, iş emri notu, iade önizlemesi, açık oturumlar + sonlandırma, yönetici bildirim
    tercihleri); kaldırılan ya da yeniden adlandırılan uç yok.
  - Yanıtlara yalnız opsiyonel alan eklendi (`allocation`, `beamCountOpen`, `planBeamCountOpen`, `tercihKilidi`,
    Fasondaki İplik değer/süzgeç alanları).
  - Tip gevşemesi: devere siparişinde `beamCount` artık `null` olabilir — yalnız yeni "adet belli değil" siparişlerde.
  - Davranış değişikliği: son kalem iade edilince devere siparişi kendiliğinden kapanır; kilitli profil üyesinin
    tercih yazımı 409; geçersiz `filter[categoryId]` 400.
  - **Bulut önce:** `is-emri` catalogVersion 3 + liste üyelik süzgeci teli. Patron bulutu (VDS) bu sürümden ÖNCE
    yükseltilir (#783). Ölçüm: eski bulutun uygulayıcısı (`sync-apply.ts`) büyük katalog sürümünü TAM gönderimle kabul
    eder, `PROJEKSIYON_BILINMIYOR` doğmaz; eski bulut yalnız `uyelik` süzgecini tanımaz.
- **Eski istemci ne yapar:**
  - Masaüstü panel (eski sürüm): yeni uçları çağırmaz. Devere iadesi `wasteKg`/`clientToken`sız eskisi gibi çalışır,
    son kalemde sipariş kapanır (yanıt mesajı söyler). "Adet belli değil" siparişte levent sayısı boş görünür, çökmez;
    düzenlemede plan alanına dokunulmazsa mod korunur. Kilitli profilde tercih kaydı Türkçe 409 mesajı alır. Fason
    seçicisi geçerli kimlik gönderdiği için 400 görmez. Web paneli imajla birlikte yenilenir.
  - Tablet (eski OTA): `tercihKilidi`ni yok sayar; kilitli kişi kaydederse 409 Türkçe mesaj. Zil akışında eski
    yeniden bağlanma davranışı sürer. Devere siparişi okumaz.
  - Patron uygulaması: eski uygulama `uyelikSuzgecleri`ni görmez, süzgeçleri gizler.
- **`minVersion` dokunuldu mu:** hayır (`client-version-policy.ts` bu aralıkta değişmedi; her PR'ın eski istemci
  cevabı yukarıda doğrulandı, gerçek kırılma yok).
- **Yeni bayraklar:** yok.

## 4. Migration

- **Var mı:** EVET — 5 göç, hepsi yalnız ekleme ya da NOT NULL gevşetme; veri güncelleme yok, kolon/tablo silme yok.
  - `20261119120000_notification_profile_prefs_locked` — `notification_profiles.prefsLocked` BOOLEAN NOT NULL DEFAULT
    false.
  - `20261119133909_work_order_notes` — yeni tablo `work_order_notes` + unique index + FK Restrict (idempotent).
  - `20261119135551_sack_retired` — `sacks.retiredAt`, `sacks.retiredById` + index + FK + CHECK `sacks_retired_shape`
    (mevcut satırlar `retiredAt` NULL, CHECK boş geçer).
  - `20261119160000_warping_return_waste` — `warping_yarn_wastes.returnMovementId` + FK + index, `settlementId` DROP
    NOT NULL, CHECK `warping_yarn_wastes_source_ck` (mevcut satırların hepsi `settlementId` dolu, geçer);
    `yarn_movements.clientToken` (unique) + `requestHash`.
  - `20261119181210_warping_order_open_beam_count` — `warping_orders.beamCount` DROP NOT NULL (CHECK `> 0` kalır).
- **Toplam migration:** 532 (2.16.8'de 527).
- **Geri alınabilir mi:** göçler geri alınmaz; eklenen kolonlar/tablo 2.16.8 imajı için görünmezdir ve gevşetilen iki
  NOT NULL'a 2.16.8 hep değer yazar. Asıl yol güncelleme öncesi yedek (`GERI_DONDU`).

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + göç + yeniden başlatma; deneme ölçeğinde birkaç dakika (2.16.7'de 8 göç
  ~2 dk sürdü).
- **Sıra:** patron bulutu (VDS) ÖNCE → backend (web paneli imajla birlikte) → masaüstü panel ve tablet bağımsız.
- **Bu sürüme özel:** yayından sonra deneme panelinde "Şimdi yokla" (runbook §16.4 adım 4b). Kurulumdan önce elle
  yedek (`yedek-elle/oncesi-2.16.9-GGAA.dump` biçimi, 2.16.7/2.16.8 gibi).
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış: yeni yazım yolları (paylaştırma, not, iade firesi, oturum sonlandırma, tercih kilidi) varsayılanda kapalı ya
da kullanıcı eylemiyle doğar; ters yolları kendi alanlarındadır (iade stornosu fireyi geri alır, not boşaltılır, kilit
kapatılır). Sürüm: güncelleyiciyle kurulan sürüm açılmazsa önceki imaja ve güncelleme öncesi yedeğe kendiliğinden
dönülür (`GERI_DONDU`). Grupta geri inme yok, düzeltme ileri sürümle. Etiket `backend-v2.16.9` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.16.9; güncelleyici durumu `BASARILI`.
- Veritabanı: 532 migration bitmiş, yarım/geri alınmış 0; beş yeni göç uygulanmış.
- `GET /api/feature-flags` 200; `GET /api/admin/open-sessions` 404 DEĞİL (izinsizse 403).
- Web paneli kökü 200; paket "Açık oturumlar" ve "Levent adedi belli değil" metinlerini taşır.
- Lisans bloğu (`kapaliModuller`) kurulumdan önceyle aynı.
- Konteyner günlüğünde açılış hatası yok; bulut eşitlemesinde `is-emri` reddi yok.

## Ek A — commit dökümü (ilk ebeveyn, eskiden yeniye, 16)

- `ec9402dc8` #776 fix(bildirim): stop bell stream ping-pong at per-user stream cap + latency probe
- `5dfb70701` #777 feat(panel): müşteri kartı Özet sekmesi
- `26f2cd884` #779 fix(shipping): retire, not delete, an emptied sack that has ledger history
- `c178615fc` #778 feat(notifications): roll scrap/cancel, shipment created and combined day-end summary kinds
- `ca954a916` #781 feat(panel): geniş çözgü kartı formu + canlı hesap paneli
- `cb3fecc62` #780 feat(workorder): sipariş paylaştırması + planlama notu
- `9f05495e6` #784 feat(panel): modal bölüm görünürlüğü — × yanında bölümleri göster/gizle
- `02a4dac16` #783 feat(patron): work order v3 whereabouts + list membership filters
- `6806798df` #782 feat(system): Bağlı İstemciler — açık oturumlar sekmesi + yönetici sonlandırması
- `142e3a328` #785 feat(warping): devere iadesinde fire + kalan sıfırlanınca otomatik kapanış
- `204c1edff` #786 feat(notification): profile prefs lock and per-user notification tab
- `7fd219090` #789 feat(warping): Fasondaki İplik — lot süzgeci, arama, değer, satır eylemleri, fasoncu ekstresi
- `da5784f59` #788 feat(subcontractor): fason seçicilerinde kategori süzgeci + cari kartında kategori seçimi
- `7999e3dda` #791 docs(fason): bekçi listesi satır kopyalarını birleştir (main kırmızısı)
- `75be8cb9f` #790 feat(warping-order): levent adedi belli değil — yalnız toplam metreyle devere siparişi
- `02d3f48d8` #787 feat(panel): Sevk Edilenler — fatura bilgi sütunu, sağa yapışık Belgeler, ⋯ menü

## Ek B — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel / tablet turunda `surum-notlari.json`a girer. Metin
terfide kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-19b",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Devere iade firesi, iş emri paylaştırma, bildirim yönetimi",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Devereciden iade alırken kullanılamayan ipliği aynı pencerede fire yazın (\"Kalanın hepsini fire yaz\"); deverecide iplik kalmayınca sipariş kendiliğinden kapanır." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Kaç levent geleceği bilinmiyorsa devere siparişini \"Levent adedi belli değil\" ile yalnız toplam metreyle açın; adet kabulde ortaya çıkar." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Fasondaki İplik sayfasında lot ve aramayla süzün, ipliğin değerini görün, satırdan iade alın ya da başka siparişe aktarın; fasoncu ekstresini Excel/PDF alın." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Devereci ve fasoncu seçicileri yalnız ilgili kategorideki fasonları listeler; hepsini görmek için \"Tümünü göster\". Cari kartında fason kategorisi seçilebilir." },
    { "kapsam": "panel", "tip": "yeni", "metin": "İş emri metresini bağlı siparişlere paylaştırın (\"Paylaştır\") ve iş emrine planlama notu yazın." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Müşteri kartında Özet sekmesi: siparişler, açık kalemler, brüt sevk ve iadeler tek yerde." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Çözgü kartı formu geniş ekranda açılır; yanda tel, kg ve iplik payı anında hesaplanır." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Formlarda kapatma düğmesinin yanındaki simgeyle görmek istemediğiniz bölümleri gizleyin; seçim size özel saklanır." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Sevk Edilenler listesinde fatura bilgisi tek satırda; İrsaliye ve Fatura düğmeleri sağdaki Belgeler sütununda, diğer işlemler ⋯ menüsünde." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Bağlı İstemciler ekranında \"Açık oturumlar\" sekmesi: kim hangi cihazda, hangi sürümle bağlı; gerekirse oturumu sonlandırın." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Bildirim profiline \"Üyeler bildirim tercihlerini değiştiremez\" kilidi; kişi kartındaki Bildirimler sekmesinden kişinin hangi bildirimleri neden aldığını görüp değiştirin." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Yeni bildirimler: top fire edildi ya da iptal edildi, sevkiyat oluşturuldu ve tek bildirimde gün sonu özeti (saati ayarlardan seçilir)." },
    { "kapsam": "her-ikisi", "tip": "duzeltme", "metin": "Aynı hesapla çok sayıda sekme ya da cihaz açıkken bildirim zili artık durmadan yeniden bağlanmıyor." },
    { "kapsam": "tablet", "tip": "iyilestirme", "metin": "Bildirim tercihleri yöneticice kilitlendiyse tercih ekranında bilgi şeridi görünür." },
    { "kapsam": "panel", "tip": "duzeltme", "metin": "Bir kez sevkiyata girmiş boş çuval silinmek istendiğinde hata vermez; geçmişi korunarak listeden kalkar." }
  ]
}
```
