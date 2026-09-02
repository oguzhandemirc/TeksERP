> **NOT:** Bu dosya uygulama planıdır; kararların kendisi ve kurallar
> [`MODUL-BAYRAK-TASARIM.md`](MODUL-BAYRAK-TASARIM.md) içindedir. İkisi birlikte okunur.
> Kopya kaynağı: ~/.claude/plans/ (2026-09-02).

# Modül & Bayrak Sistemi — Dilim 0+1 Uygulama Planı

> Tasarım kaynağı: `docs/design/MODUL-BAYRAK-TASARIM.md` (2026-09-02, tüm kararlar
> kullanıcı onaylı). Bu plan yalnız **Dilim 0 (repo birleşme)** ve **Dilim 1
> (modül temeli + süperadmin + kalite-yetenek)** kapsar — kullanıcı seçimi.

## Context

TeksERP tek fabrikada (Adnan Şahin, "basit usul") canlı; ürün başka fabrikalara
(işlemeci/perde → dokuma → boyahane rotasıyla) satılacak. Karar: müşteri
forku/dalı YASAK — tek gövde, tek şema, tek sürüm çizgisi; müşteri farkı yalnız
bayrak profilinde. Bunun temeli: 10 `modul.*` anahtarı + kapatılamaz çekirdek,
satıcıya ait gizli SÜPERADMİN, modül/bayrak yönetimi için Sistem Profili ekranı,
ve kaliteyi istasyon türünden yeteneğe taşıyan refactor (farklı KK topolojili
fabrikalar için).

**Kutsal kısıt:** Adnan Şahin'de sıfır davranış farkı (bilinçli istisna İKİ uç: mal
kabul `modul.ticaret`, depo transferi `modul.coklu-depo` kapısına girince 403
— dump ölçümü 2026-09-02: 0 mal kabul, 0 depo, 0 transfer; transfer karosu zaten gizli). Kabul testi: fabrikanın gerçek dump'ı üstünde
migrate + bekçiler + basit profille LAN regresyonu.

## Kapsam

- **Dilim 0:** `feature/patron-modulu` → `integration/depo-muhasebe` → `main`
  birleşmesi; `adnansahin` + `feature/depo-mal-kabul` dallarının emekliliği;
  CLAUDE.md dallanma satırının güncellenmesi.
- **Dilim 1:** `modul.*` anahtarları (uretim terfisi, ticaret/iplik/coklu-depo/
  kumas-teknik/tezgah-izleme yer tutucuları dahil katalog) + route kapıları +
  karo görünürlüğü; süperadmin (gizli kullanıcı + PIN + TOTP + takma adlı audit);
  ayar şifresi; Sistem Profili ekranı; tamlık bekçisi (screen-catalog → modül
  eşlemesi); kalite-yetenek dönüşümü (`station.appliesQuality`); basit/tam
  profilleri; dump provası.

## İş paketi: Doküman mercek turu (kullanıcı isteği, 2026-09-02)

Karar arşivi tek-fabrika varsayımıyla yazıldı; ölçeklenme sonrası bayat/eksik
kurallar var. Yapılacak:

1. **Tarama:** CLAUDE.md (kök + alt projeler) + `docs/history/CLAUDE-NOT-ARSIVI.md`
   + `docs/ops/` + `docs/design/` — her kural/not iki sınıfa ayrılır:
   `[ÇEKİRDEK]` (her fabrikada değişmez: defter semantiği, brüt sevk, idempotency,
   kilit sırası, fail-closed kapılar) vs `[PROFİL]` (adnansahin'in seçimi:
   "çözgü/dokuma yapmaz", "kurşun+QC tek istasyon", "rezerv yok", tek depo...).
   Uygulama: toplu yeniden yazım DEĞİL — profil-bağımlı cümlelere kısa şerh
   ("⚠️ profil gerçeği — bkz. MODUL-BAYRAK-TASARIM") + bariz bayatları düzelt.
2. **CLAUDE.md üst bölümü:** "Üretim Akışı" başlığı "Referans profil: işlemeci
   (adnansahin)" olarak yeniden çerçevelenir; en üste tek ilke satırı:
   "Tek gövde, çok fabrika — kural yazarken sor: çekirdek mi, profil mü?"
3. **Yazım konvansiyonu:** bundan sonra her yeni karar notu sınıf etiketi taşır.
4. Tarama çıktısı ayrı raporla gelir (hangi not değişti, hangisi şerh aldı) —
   kullanıcı onayından sonra işlenir.

## Tesisat haritası (keşif ①, tamam)

**Rejim kapısı kalıbı:** `finance.middleware.ts:21-35` (35 satır) kopyalanır —
cache'siz okuma, 403 + Türkçe "nereden açılır" mesajı. İyileştirme: bu kez
`AppError.forbidden(msg, {code:"MODULE_DISABLED", modul})` makine-okunur kod.
⚠️ **Jenerik `requireModule("x")` YAZILMAZ** — `test_finance_regime_gate.ts:251`
ve `test_feature_flag_contract.ts:723-729` middleware ADINI metin arar; modül
başına adlandırılmış export (`requireTicaretEnabled`...) şart.

**Taşınacak route kapıları:** `purchase-order.routes:47` + `item-price.routes:44`
+ `stock-count.routes:43` → `modul.ticaret` · `yarn.routes:29` → `modul.iplik` ·
`goods-receipt.routes` (bugün KAPISIZ — karar #4 gereği ticaret kapısına girer;
`test_finance_regime_gate.ts:132-138` muaf gerekçesi güncellenir) ·
`warehouse/warehouse-transfer.routes` (KAPISIZ) → `modul.coklu-depo`.
⚠️ `warehouse.service.ts:29-36` "kapı KONULAMAZ" gerekçesi (depo defterini
fabrika yolları da yazar) SERVİS için geçerli kalır — kapı yalnız transfer/çoklu
depo UI uçlarına; defter yazımı çekirdek.
⚠️ Mount sırası: kendi kapısını taşıyan router `/api/finance` genel ön ekinden
ÖNCE (`app.ts:861-879` kuralı).

**`production.enabled` terfisi:** bugün SALT-UI ve ⚠️ karo kararına bile girmiyor
(`tile-config.ts:69-83` — alan tip zorunluluğu olarak duruyor; okuyucusu
`readProductionEnabled:2696` default-true kalıbı). Terfi: `requireUretimEnabled`
middleware + üretim route'larına mount + karo/side-bar bağı. Mevcut kurulumda
migration'la `production.enabled=true` damgalanır (grandfathering).

**Dört kapı sırası** (her yeni anahtar): `SETTING_KEYS` → `readXEnabled` →
`FeatureFlags` tipi → `getFeatureFlags` → `setFeatureFlags` dalı → Zod
`updateSchema` (strictObject!) → Electron `featureFlagService.ts` tipi →
`settings-config.ts` "Modüller" kategorisi. Bekçi: `test_feature_flag_contract`.

**Karo görünürlüğü:** ctx TEK yerde kurulur (`useOperationsVisibility.ts:24-48`,
açık dönüş tipi → alan ekleyince derleme düşer, unutulamaz). Her modül için ayrı
saf `*-regime.ts` yüklemi (`yarn-regime.ts` kalıbı; satır içi ok fonksiyonu
YAZILMAZ — `tile-visibility.test` `toBe` kimlik testi). Belirsizken karo FALSE.
`ctx.multiWarehouse` veri-türevi (`useWarehouses.ts:46-50`) → `modul.coklu-depo`
anahtarına çevrilir. `nav-config.ts:28` `featureFlag` union'ı genişler.
Route'lar bayrağa bakmaz (bilinçli — derin bağlantı); kapı menü + backend.

**Tamlık bekçisi:** `screen-catalog.ts` `ScreenEntry`'ye `modul` alanı (bugün
YOK) + `test_screen_catalog.ts`'e "her ekran eşlenmeli" bölümü + gerekçeli
`MODULESIZ_EKRANLAR` muafı (ölü muaf da kırmızı — `SCREENLESS_PERMISSIONS` kalıbı).

**Profil seed:** YENİ `src/jobs/module-profile.job.ts` = `default-warehouse.job.ts`
kalıbı (boot uzlaştırma; "satır VARSA dokunma, yoksa profilden yaz"; idempotent,
best-effort). ⚠️ `seed.ts:424-430` deseni KOPYALANMAZ (update fabrika kararını
ezer); kur.ps1 seed koşmuyor — doğru ev boot job'u.

**Ayar şifresi:** emsal YOK, sıfırdan; kalıp `totp-account.service.ts:182-274`
(bcrypt hash 10 + atomik claim + count===0 + audit); kilit kontrolü compare'den
ÖNCE (`auth.controller.ts:111-116` sırası).

**Bekçi genişletmeleri:** `REGIME_GATES`'e modül satırları ·
`test_finance_regime_gate` model setinin modül başına bölünmesi ·
`test_finance_flag_off` → modül başına ikiz · yeni tamlık bekçisi.

## Kalite-yetenek (keşif ②, tamam) — İKİ FAZLI uygulama

**Belirleyici bulgu:** kalite NOTU (`qualityGrade`) bugün iki kapıda doğar —
KK1 girişi (kind'sız, `inventory.service:876`) ve **Tambur finalize**
(TAMBUR kind'ına gömülü). `PROCESS_QC` kalite YAZMAZ; işi hata toplamak +
`QC2_COMPLETED` izi. Yani kullanıcının istediği esneklik ("KK kurşunla birlikte /
ayrı / başka istasyonla") = **KK/muayene SÜRECİNİN yeri**, kalite notunun değil.
İkinci bulgu: "yalnız KK istasyonu" bugün bile kısmen kurulabiliyor
(PROCESS_QC kind + KURSUN özelliği atanmamış istasyonda `KURSUN_APPLIED`
yazılmıyor — `inventory.service:5240-5271`). Asıl kilit: `Kurşun→KK→Tambur`
üçlü rotada bypass/dağıtım "sonraki adım TAMBUR olmalı" şartı (R3) ve mobil
ekran seçiminin kind'a bijective bağı (R4).

**Faz A — Dilim 1'de yapılacak (davranış BİREBİR):**
- `Station.appliesQuality Boolean @default(false)` + kalıcı gerekçe notu
  (`appliesColor` notunun ikizi, schema:790-812 kalıbı) + backfill migration:
  `kind=PROCESS_QC → true` (20260810010330 emsali — davranış koruyan yön).
- Tek yüklem boğazı: `step-capability.helper.ts`'e `stepCanApplyQuality()` +
  `STEP_CAPABILITY_SELECT` alanı; PROCESS_QC kontrolü yapan ~15 nokta
  (kursun-qc.service 12 nokta, inventory 4620/5087, eligibility helper) bu tek
  yükleme KANALİZE edilir — yüklem Faz A'da `kind===PROCESS_QC || appliesQuality`
  okur, backfill sayesinde sonuç birebir.
- Panel: istasyon formunda "Kalite kontrol uygular" (Stations/schema+Form+liste),
  StationCapabilities rozeti; import adapter + Swagger + seed.
- Bonus drift onarımları (keşifte ölçüldü): Electron `enums.ts:48` + form zod'unda
  eksik `SHIPPING`; mobil `models.ts:7`'de hayalet `EXTERNAL`.
- KK1 kararı: giriş kapısı İSTASYON DEĞİL (WO adımı olamıyor,
  `allowAsWorkOrderStep=false`) → `appliesQuality` KK1'e uygulanmaz; bu, R11
  ürün sorusunun cevabı olarak CLAUDE.md kural metnine yazılır.

**Faz B — İLK farklı-topolojili müşteride (bu planın DIŞI, dokümana not):**
R1 (tambur guard yetenekleşmesi) · R3 (bypass "sonraki adım TAMBUR" şartının
üçlü rotaya açılması — yanlış yapılırsa fabrikada dağıtım kilitlenir) ·
R4 (mobil ekran seçimi kind→yetenek; APK işi, bijektiflik bozulur) ·
R5 (RollError çok-istasyon, partial unique 409 riski) · R6 (dashboard ham SQL)
· R9 (`QC2_COMPLETED` semantiği) · R10 (roll-finalize son-adım dalı).
Gerekçe: Faz A modeli + panel yüzeyini kurar (satış cümlesi söylenebilir),
Faz B'nin 7 riskli guard geçişi canlı fabrikada talepsiz değiştirilmez.

⚠️ Regresyon yüzeyi geniş: `test_e2e_full_flow`(20 kind referansı),
`test_kursun_bypass`(16), `test_kursun_regime_lock`, `test_qc2_idempotency`,
mobil `stationScreens.test` + `tile-visibility.test` — Faz A sonrası tümü
yeşil kalmalı (davranış birebir iddiasının ölçümü).

## Süperadmin (keşif ③, tamam)

**Ayırt edici:** `User.isSystemAccount Boolean @default(false)` (additive migration)
— username sihri değil, tipli kolon. `SystemLog` FK'sı `onDelete:Restrict` →
kayıt fiziksel silinemez, iyi.

**Tam yetki — kod bypass'ı (en az yüzey):** `getEffectivePermissions`
(`auth.service.ts:537`) süperadminde `["*"]` döner — `rbac.middleware.ts:39` `*`'ı
ZATEN tanıyor, DB'de grant satırı doğmaz (panel izin sayaçları sızdırmaz).
⚠️ Düzeltme şart: Electron `hasAdminAccess` (`types/auth.ts:95-97`) düz
`includes` kullanıyor, `*`'ı TANIMAZ → `matchesPermission`'a çevrilir.

**Gizleme — 5 backend noktası** (+ zaten filtreli yüzeyler):
`permission-management.service.ts:123,142` (kullanıcı liste/detay) ·
`auth.service.ts:500-512` (mobile-users — tablet isim listesi) ·
`inventory.service.ts:1977` ("Ekleyen" dropdown) · `system-log.service.ts:297`
(audit aktör dropdown'u) · `work-session.service.ts:476` (canlı oturumlar).
Hepsine `user.isSystemAccount=false` süzgeci.

**Takma ad:** `fullName = "Sistem Bakımı"` olarak DOĞAR — 31 kayıt-künyesi
join'i + 4 rapor + 3 audit ekranı tek yazımla kapanır (tek tek etiket ezme YOK).
Gerçek kimlik yalnız süperadmin ekranında gösterilir.

**Giriş:** PIN akışı zaten kullanıcı seçtirmiyor (`auth.service.ts:172-175`,
salt-PIN + sistem geneli @unique) → tablet girişi ek işsiz çalışır; uzakta PIN
zaten 404. Panel girişi username+parola; uzakta TOTP zorunluluğu süperadmin
için de geçerli (muafiyet yok). ⚠️ Risk notu: `quickPin` tasarım gereği düz
metin — DB'ye erişen fabrika personeli süperadmin PIN'ini okuyabilir; kabul +
kolay rotasyon (süperadmin ekranından).

**Doğum:** YENİ `src/jobs/superadmin.job.ts` (emsal `installation-identity.job`)
— `.env`'den (parola hash'i + PIN) okur, yoksa OLUŞTURMAZ (kurulum başına
opt-in); idempotent, best-effort. Seed'e eklemek mevcut fabrikaya ulaşmaz.

**`modul.*` yazım kısıtı:** `feature-flag.routes.ts:38-45` `flagWriteGuard`'a
üçüncü dal: gövde rejim anahtarı içeriyorsa süperadmin şartı (FAIL-CLOSED,
Zod'dan önce, yalnız anahtar adına bakar — invariant korunur).

**Ayar şifresi:** hash `SystemSetting`'de (`security.settingsPasswordHash`);
doğrulama `flagWriteGuard` zincirinde (süperadmin muaf); bcrypt kalıbı
`totp-account.service.ts:182-274`; kilit kontrolü compare'den ÖNCE; her
kullanım audit'e.

---

# UYGULAMA ADIMLARI

## Dilim 0 — repo birleşmesi (yarım gün)
1. `feature/patron-modulu` → `integration/depo-muhasebe` (ff/merge) → `main`.
2. `adnansahin` + `feature/depo-mal-kabul` dalları silinir (ikisi de içeriksiz —
   ölçüldü); CLAUDE.md dallanma konvansiyonu satırı güncellenir
   ("feature/* → main; müşteri dalı YOK").
3. Demo derlemesi bundan sonra `main`'den (not: demo eski sunucuda).

## Dilim 1 — iş paketleri (bağımlılık sırasıyla)

**P1 · Modül anahtarları (backend):** ✅ UYGULANDI 2026-09-03 (`feature/modul-bayrak` c94035cc · 251767ca · 06e23448; karar notu arşivde "Modül anahtarları P1"). 6 yeni anahtar (`ticaret.enabled`,
`iplik.enabled`, `depo.multiEnabled`, `kumasTeknik.enabled`,
`tezgah.enabled` yer tutucu, `production.enabled` terfisi) — her biri dört
kapıdan; modül başına ADLANDIRILMIŞ middleware, **ad = `require` +
PascalCase(API alanı)**: `requireTicaretEnabled` · `requireIplikEnabled` ·
`requireDepoMultiEnabled` · `requireProductionEnabled` (2026-09-02 kararı — plandaki
`requireUretimEnabled` taslak addı; alan `productionEnabled` ve bekçi `REGIME_GATES`
zaten bu adı yazıyordu); yer tutucu `kumasTeknik`/`tezgah` için middleware ve panel
toggle YOK (route'suz kapı ölü satır; `PANEL_EXEMPT` gerekçeli); `iplik→ticaret`
bağımlılığı middleware zincirinde + `setFeatureFlags` yazma doğrulamasında (400
`MODULE_DEPENDENCY`), okuyucular HAM değer döner; `modul.*` ortak ön ek taşımadığı
için süperadmin guard'ı (P2) ad kalıbıyla değil tek kaynak `MODULE_FLAG_KEYS`
kümesiyle (`src/constants/module-flags.ts`) tanımlanır; (jenerik fabrika YOK — bekçiler metin arar); route kapıları taşınır (tesisat
tablosu); `MODULE_DISABLED` makine-okunur kod; `REGIME_GATES` + regime-gate
bekçileri modül başına bölünür; `test_<modul>_flag_off` ikizleri.
Grandfathering migration: mevcut DB'ye bugünkü değerler damgalanır.

**P1 — AÇIK KALANLAR (sonraki paketler, kaybolmasın):**
- **Mobilde `MODULE_DISABLED`ın kullanıcı yüzü YOK** (2026-09-03 ölçümü): modül
  kapalı tablette ekran menüde durur (`useVisibleScreens.conditional` boş — yalnız
  izin), her aksiyon jenerik hata toast'ı basar (offline kuyruk 403'ü kesin hata
  sayıp kalıcı yazmaz, veri riski yok). Adnan'da üretim AÇIK → bugün görünmez.
  Toptancı profili (üretim kapalı) satıldığı gün ŞART: `announceFailure`a
  `details.code === "MODULE_DISABLED"` dalı ("Bu modül bu kurulumda kapalı") +
  `useVisibleScreens.conditional`ı `useFeatureFlags`ten besleme (APK ister).
- `/api/rolls` karma router: üretim kapalıyken `/open-fabric`, `/:id/kursun-finish`,
  `/production-flow`, `/subcontractor-summary` AÇIK kalır — uç-bazlı kapı.
- "Depo & Muhasebe" ayar bölümü hâlâ `financeEnabled` rejiminde (P5 ile birlikte).
- **Sürüm notu TASLAĞI (kullanıcı ONAYI bekler — paketleme YAPILMAZ):** panel:
  "Genel Ayarlar → Modüller'e Ticaret · İplik · Çoklu Depo anahtarları eklendi.
  İplik / Alış Siparişi / Fiyat Listesi / Stok Sayımı ekranlarının kapalı olma
  sebebi artık Ticaret modülü (eskiden Ön Muhasebe). Fabrikada görünür değişiklik
  yok." — kapsam `panel`; tablet için not gerekmez.

**P2 · Süperadmin:** yukarıdaki bölüm — şema kolonu + job + `["*"]` bypass +
`hasAdminAccess` düzeltmesi + 5 gizleme süzgeci + guard dalı. Bekçi:
`test_superadmin.ts` (gizlilik: 5 yüzeyde görünmez · yetki: her uca girer ·
audit: satır yazılır, takma ad basılır · negatif sonda: süzgeç kalkınca kırmızı).

**P3 · Ayar şifresi:** hash + doğrulama dalı + Electron diyaloğu (bayrak
kaydetmeden önce sorar) + süperadmin ekranından üret/değiştir/iptal + audit.

**P4 · Kalite-yetenek Faz A:** yukarıdaki bölüm (kolon + backfill + tek yüklem
boğazı + panel UI + drift onarımları). Davranış birebir — mevcut bekçi seti
yeşil kalmalı; yeni bekçi `test_station_quality_capability.ts` (backfill
doğruluğu + boğazın tekliği AST taraması + negatif sonda).

**P5 · Karo/ctx + Sistem Profili ekranı (Electron):** ⚠️ 2026-09-02 notu:
`depo.multiEnabled` artık ANLIK DAMGA, canlı türev değil — fabrika ikinci depoyu
açınca yüzeyler eskisi gibi kendiliğinden BELİRMEZ. P5 iki uyarı ekler: Sistem
Profili'nde "aktif depo >1 ama anahtar kapalı" amber bandı + Depolar ekranında ikinci
aktif depo kaydedilirken "Çoklu depo modülü kapalı — yüzeyler görünmeyecek, Sistem
Profili'nden açılmalı" uyarısı (anahtarı kimin açacağı kullanıcı-karar kuyruğunda).

`OperationsVisibilityContext`e alanlar (derleme zoruyla yayılır) + modül başına
saf `*-regime.ts` yüklemi + `nav-config` union + `ctx.multiWarehouse` →
`depo.multiEnabled`. Yeni "Sistem Profili" sayfası (yalnız süperadmin görür):
modül kartları, bağımlılık + "kapatırsan şunlar gizlenir" önizlemesi (screen-
catalog `modul` alanından türetilir), alt bayraklar gruplu, profil uygula +
fark göster, değişiklik geçmişi.

**P6 · Tamlık bekçisi + profiller:** `ScreenEntry.modul` alanı + tüm ekranların
eşlenmesi + `test_screen_catalog` genişletmesi (gerekçeli `MODULESIZ_EKRANLAR`,
ölü muaf kırmızı) · `deploy/profiller/{basit,tam}.json` +
`src/jobs/module-profile.job.ts` ("satır varsa dokunma").

**P7 · Doküman mercek turu:** CLAUDE.md + not arşivi + ops/design taraması →
`[ÇEKİRDEK]`/`[PROFİL]` sınıflaması RAPORU (kullanıcı onayına) → onaylanan
şerh/düzeltmeler işlenir; CLAUDE.md üst bölümü "Referans profil: işlemeci"
çerçevesine alınır; yeni not konvansiyonu yazılır.

## Doğrulama (kabul kapıları)
1. Backend test takımı + tüm yeni bekçiler (her biri negatif sondayla kırmızı
   kanıtlı) + `test_feature_flag_contract` + regime-gate ailesi.
2. **Dump provası:** fabrika dump'ı restore → `migrate deploy` (37+ migration)
   → `test_consistency` + `test_db_invariants` → basit profille boot →
   anahtar değerleri = bugünkü davranış (mekanik karşılaştırma scripti).
3. **LAN regresyon turu:** panel giriş/KK1/kurşun/tambur/sevk akışı + tablet
   PIN girişi + "Sevkiyatlar (Muhasebe)" ekranı — sıfır görünür fark.
4. Süperadmin turu: PIN'le tablete gir (listede yok) · panelde `*` ile tüm
   menüler · audit'te "Sistem Bakımı" · fabrika admini modul.* yazamıyor (403)
   · ayar şifresi yanlışsa bayrak kaydedilemiyor.
5. Bilinçli fark ölçümü: mal kabul + depo transferi uçları kapalı modülde 403 —
   başka hiçbir uçta statü farkı yok (route-diff scripti ile ölçülür).
6. Sürüm notu + `panel-v*/tablet-v*` etiketli yayın; Electron+APK gerekmiyor
   (yalnız panel yüzeyi değişti → panel sürümü yeter; tablet OTA yalnız
   görünmez süzgeçler için opsiyonel).
