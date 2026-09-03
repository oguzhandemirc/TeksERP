# Doküman Mercek Turu — Rapor (2026-09-03)

> **Ne bu?** `MODUL-BAYRAK-TASARIM.md` §0/§11 ölçütüyle (tek gövde · çok fabrika; **çekirdek mi, profil mü?**) yapılan üç ayrı SALT-OKUNUR taramanın tek raporu.
> **Tarama sırasında hiçbir dosya değiştirilmedi.** Bu rapor bir *uygulama listesidir*; her madde tek tek onaylanıp uygulanır.
> **Kapsam:** ① 4 × `CLAUDE.md` (kök · Teks-Erp · Electron · mobil, 1483 satır) · ② `docs/history/CLAUDE-NOT-ARSIVI.md` (1966 satır, 58 karar notu) · ③ `docs/ops/` (29) + `docs/design/` (21, MODUL-BAYRAK-* ve GECE-KARARLARI-* hariç) + `deploy/README.md` + `Teks-Erp/ARCHITECTURE.md`.

---

## § Özet

### Sayılar

| Ölçü | Değer |
|---|---|
| Taranan dosya | **56** (4 CLAUDE.md · 1 arşiv · 29 ops · 21 design · deploy/README · ARCHITECTURE) |
| Taranan satır | ~3.500 (CLAUDE.md 1483 + arşiv 1966) + ops/design gövdesi |
| **Toplam madde** | **116** |
| Bayat düzeltmesi | **26** (hepsi `file:line` kanıtlı) |
| Additive şerh | **80** (mevcut metne DOKUNMADAN eklenen satır) |
| Sabah onayı (tartışmalı sınıflama) | **10** |
| Silinen içerik | **0** |
| Yeniden yazılan cümle | **0** |

### Sınıf dağılımı

| Sınıf | Kök+alt CLAUDE.md | Arşiv | ops/design | **Toplam** |
|---|---:|---:|---:|---:|
| `[ÇEKİRDEK]` | 9 | 17 | 13 | **39** |
| `[PROFİL]` | 9 | 8 | 4 | **21** |
| `[KARIŞIK]` | 10 | 39 | 7 | **56** |
| **Toplam** | **28** | **64** | **24** | **116** |

> ⚠️ **Sayım şerhi:** Arşiv taramasının kendi `stats` bloğu `toplam_oneri: 66` ve `sinif_dagilimi` toplamı 58 diyor; bu rapordaki 64/17/8/39 rakamları **madde dizisinin fiili sayımıdır** (stats'taki 58, notların sayısıdır — öneri sayısı değil; 66 ise iki "eşlik eden madde"yi ayrı saymış). Uygulamada esas alınacak liste aşağıdaki gövdedir.

### Güven dağılımı

| | kesin | tartışmalı |
|---|---:|---:|
| CLAUDE.md turu | 24 | 4 |
| Arşiv turu | 60 | 4 |
| ops/design turu | 21 | 3 |
| **Toplam** | **105** | **11** |

> Not: 10 madde `sabah-onayi` türünde, 11 madde `tartismali` güvende — fark **1**: kök `CLAUDE.md:109` (şube bazlı planlama) *additive şerh* olarak önerildi ama sınıfı tartışmalı; ops turundaki `DEVIR-2026-08-17` maddesi *bayat düzeltme* olarak önerildi ama biçimi (düzeltme mi şerh mi) tartışmalı.

### Üç baskın desen

1. **Kurşun + KK2 tek istasyon varsayımı** dokümanların her katmanına sızmış (kök CLAUDE.md:146-147 · arşiv L78/L94/L338 ve dolaylı L69/L248 · KURULUM.md ADIM 6 · ARCHITECTURE §4). Ölçüm bunu ayrıca **düzeltilmesi gereken bir yanlışa** çeviriyor: `kursun-qc.service.ts` içinde `qualityGrade` **0 kez** geçiyor — kalite bugün İKİ kapıda doğuyor (KK1 girişi + Tambur finalize), PROCESS_QC kalite yazmıyor.
2. **Tek-fabrika ÖLÇÜM rakamları rehber gibi okunuyor** (arşiv L129 "87 giriş/30 gün", L399 bulanık eşik kalibrasyonu, L403 "bilinen 2 kırmızı satır"; kök CLAUDE.md refakat kartı %75 doluluk; ops DEPLOY-RUNBOOK "yetkili değerler" tablosu). Bunlar profil verisidir; yeni kurulumda yeniden ölçülür.
3. **P1/P2 koda indi, dokümanlar bilmiyor.** `module-flags.ts` (7 anahtar) + 6 adlandırılmış route kapısı + `User.isSystemAccount` canlı; buna karşılık üç alt-proje `CLAUDE.md`'sinin hiçbirinde "modül"/"süperadmin" kelimesi geçmiyor (grep: 0), `TICARET-KURULUM.md` §1 `ticaret.enabled`'ı hiç saymıyor ve `KURULUM.md` `SUPERADMIN_*` satırlarını istemiyor.

### En kritik üç bulgu (uygulama önceliği)

1. **`TICARET-KURULUM.md` §1 eksik** — `ticaret.enabled` varsayılan KAPALI ve dört route'u kapılıyor; reçeteyi elle uygulayan kişi mal kabul/alış siparişi/fiyat/sayım uçlarında **403 `MODULE_DISABLED`** alır. (Bootstrap script'i doğru; ayrışan yalnız doküman.)
2. **`KURULUM.md:120` ham `npm run build:win`** — çok müşteride "başka fabrikanın güncellemesini kuran paket" üretir ve hata SESSİZDİR. Aynı çelişki `ELECTRON-OTOMATIK-GUNCELLEME.md` diyagramında (satır 16-18) da var — belge kendi 240-243. satırında bu komutu yasaklıyor.
3. ~~**`KURULUM.md` A1 ENV bloğu `SUPERADMIN_*` istemiyor**~~ — ⛔ **ÜSTÜ ÇİZİLDİ (2026-09-03 P8):** `.env` doğuş yolu KALDIRILDI, dolayısıyla bu bulgunun reçetesi (B18) **uygulanmamalıdır**. Satıcı hesabı sunucuda `npm run superadmin:kur` ile kurulur; yeni fabrika yine süperadminsiz doğar ama bu artık bilinçli tasarımdır (emniyet supabı) ve reçetesi `KURULUM.md` A3b'dedir.

---

## § Bayat düzeltmeleri (kesin, `file:line`, eski → yeni)

> 26 madde. Hepsi ölçümle doğrulandı. **Eski cümle silinmez** — düzeltme, ya bir "⚠️ Düzeltme (2026-09-03)" satırı olarak eklenir ya da yalnız bayat SAYI/ADRES yerine doğrusu yazılır (aşağıda her maddede belirtildi).

### B1 — `Teks-Erp/CLAUDE.md:128-136` · Environment (`.env`) bloğu · `[KARIŞIK]`
- **Eski:** `oad@localhost:5432/adnansahin_db`
- **Yeni:** `postgresql://tekserp:***@localhost:55433/tekserp_demo?schema=public` — Docker konteyneri `tekserp-local-db` (55433→5432).
- **Eklenecek şerh:** *"⚠️ Bayat (2026-09-03 ölçümü): geliştirme DB'si artık `postgresql://tekserp:***@localhost:55433/tekserp_demo?schema=public` — Docker konteyneri `tekserp-local-db` (55433→5432); `oad@localhost:5432/adnansahin_db` örneği geçerli değil. Ayrıca **DB adı bir PROFİL değeridir**: müşteri adını taşıyan DB adını koda/dokümana sabitleme, ortam değişkeninden oku."*
- **Kanıt:** `Teks-Erp/.env:5`; `docker ps` → `tekserp-local-db 0.0.0.0:55433->5432/tcp`.

### B2 — `Teks-Erp/CLAUDE.md:272-273` · `ALTER DATABASE` komut örneği · `[KARIŞIK]`
- **Eski:** `ALTER DATABASE adnansahin_db SET log_min_duration_statement = 500`
- **Yeni:** `ALTER DATABASE tekserp_demo SET log_min_duration_statement = 500`
- **Eklenecek şerh:** *"⚠️ Bayat (2026-09-03): dev DB adı artık `tekserp_demo` (Docker `tekserp-local-db`, port 55433). Sahadaki Windows sunucuda ad `tekserp` olarak KALIR. Kural: DB adını dokümana sabitleme, `.env`'den doğrula (`\l` / `SELECT current_database()`)."*
- **Neden acil:** operasyonel komut örneği — bayatlığı doğrudan **var olmayan DB'ye `ALTER`** çalıştırtır.

### B3 — `Teks-Erp/CLAUDE.md:199` · izin kataloğu · `[ÇEKİRDEK]`
- **Eski:** "58 izin satırı" → **Yeni:** "**86 izin satırı**"
- **Öneri:** sayıyı sabitlemek yerine *"kanonik sayı `src/constants/permission-catalog.ts`'tedir"* yaz (satır 172 zaten bu kuralı koyuyor).
- **Kanıt:** `PERMISSION_CATALOG.length` = 86. Aynı bayatlık `ARCHITECTURE.md §13`'te de ("TÜM 58 permission").

### B4 — `Teks-Erp/CLAUDE.md:229` · rol kataloğu · `[ÇEKİRDEK]`
- **Eski:** "26 rol (8 masaüstü + 17 mobil + tam yetki)" → **Yeni:** "**29 rol**" (kırılım yeniden sayılmalı).
- **Öneri:** *"kanonik sayı `src/constants/role-template-catalog.ts`"*.
- **Kanıt:** `ROLE_TEMPLATE_CATALOG.length` = 29.

### B5 — `Electron/CLAUDE.md:367` · seed izin sayısı · `[ÇEKİRDEK]`
- **Eski:** "tüm permission'lar atanmış — ~55 kod" → **Yeni:** "**katalogdaki tüm izinler** (bugün 86)".
- **Eklenecek şerh:** *"⚠️ Sayı bayat: seed admine **katalogdaki tüm izinleri** atar ve bugün bu 86 koddur (`Teks-Erp/prisma/seed.ts:142-148`, `PERMISSION_CATALOG.length`); '~55 kod' ifadesi 2026-08 öncesine ait. Sayıyı sabitleme — 'katalogdaki tüm izinler' yeterli."*

### B6 — `Electron/CLAUDE.md:125` · `hasAdminAccess` · `[ÇEKİRDEK]`
- **Eski:** "`admin:users | admin:settings | admin:*` … herhangi biri varsa true" (düz `includes`)
- **Yeni/eklenecek şerh:** *"⚠️ Eksik/bayat (2026-09-03): `hasAdminAccess` artık düz `includes` değil `matchesPermission` ile ölçer (`src/types/auth.ts:126-127`) → **global `\"*\"` de true döner**. Bu, süperadmin (satıcı) hesabı içindir: backend `getEffectivePermissions` ona `[\"*\"]` verir, DB'de grant satırı doğmaz. Düz `includes` yazımına geri dönme — `adminOnly` karolar (SystemHubPage) izin dalına HİÇ düşmediği için belirti KISMİ ve sessiz olur."*
- **Kanıt:** `Electron/src/types/auth.ts:100-112`, `:126-127`.

### B7 — `mobil/CLAUDE.md:251-256` · API bağlantısı · `[ÇEKİRDEK]`
- **Eski:** `export const API_URL = 'http://192.168.X.X:4000/api';`
- **Eklenecek şerh:** *"⚠️ Bayat (2026-09-03): `API_URL` elle yazılan bir IP DEĞİL, üç kaynaktan TÜRETİLİR — `src/constants/api.ts:15-20`: geliştirmede Expo host'u (`Constants.expoConfig.hostUri`), aksi halde `EXPO_PUBLIC_API_URL`, o da yoksa `http://localhost:4000/api`; cihazda kullanıcı ezmesi ayrıca `src/store/baseUrlStore.ts:55`'ten gelir. Fabrika adresi **koda yazılmaz** (profil değeri): ERP bağlantısı fabrika ağında kalır ve güncelleme kanalından ayrıdır (`mobil/scripts/lib/feed.cjs` ↔ `EXPO_PUBLIC_API_URL`, iki ayrı tek-kaynak)."*

### B8 — `CLAUDE.md:261` (kök) · Test Kullanıcıları · `[PROFİL]`
- **Eski:** "Admin dışı tüm kullanıcılar `test123` şifresini kullanır."
- **Eklenecek şerh:** *"⚠️ Düzeltme (2026-09-03 ölçümü): **seed yalnız `admin` üretir** — `Teks-Erp/prisma/seed.ts:130-131` (`username: \"admin\"`, `hashPassword(\"123123\")`) ve çıktı satırı 687 (\"Tam yetki (tek seed kullanıcısı)\"); ARCHITECTURE.md §13 de \"Seed'de YALNIZ admin var\" diyor. 'Admin dışı tüm kullanıcılar test123' cümlesi 2026-07-03'te kaldırılan eski test kullanıcılarına (mehmet.planlama, ali.operator…) aittir; yeni kullanıcı panelden (`POST /api/admin/users`) açılır, 0-izinli testler kendi geçici kullanıcısını üretir."*
- **Not:** `Electron/CLAUDE.md:367` zaten "yalnız admin" diyor — kök dosya onunla çelişiyordu.

### B9 — Arşiv `L42` · "**ERP fatura KESMEZ**" · `[PROFİL]`
- **Eklenecek şerh:** *"> ⚠️ **2026-09-03 GÜNCELLEME:** \"ERP fatura KESMEZ\" cümlesi **finans modülü kapalıyken** doğrudur. `modul.finans` açık kurulumda sevk sonrası taslak fatura ERP'nin kendi içinde doğar (`shipping.service.ts:1686/1999/2641` → `maybeAutoDraftInvoiceAfterDispatch` → `helpers/shipment-auto-draft.helper`) ve `Invoice.shipmentId` + `invoices_one_active_per_shipment` partial unique'i şemada HAZIRDIR; `invoiceNo` elle izi ile iç faturanın çakışması `shipping.invoiceMode` ile yönetilir — bkz. MODUL-BAYRAK-TASARIM §6 / karar #10."*
- **Kanıt:** `shipping.service.ts:2672`; `prisma/migrations/20260813201311_finance_preaccounting/migration.sql:352`.

### B10 — Arşiv `L211` · Sevk Kapısı `visibleWhen` · `[KARIŞIK]`
- **Eski:** "`visibleWhen` artık 'bayrak açık VEYA çıkış bekleyen sevkiyat var'"
- **Eklenecek şerh:** *"> ⚠️ **BU CÜMLE 2026-08-22'de GERİ ALINDI:** karo kuralı saf bayrağa indi — `Electron/src/pages/Operations/tile-config.ts:273` bugün `visibleWhen: (ctx) => ctx.shipmentConfirmationEnabled`; \"VEYA çıkış bekleyen PLANNED\" dalı ve `sack-store/board?limit=1` sondası KALDIRILDI. Kapalı rejimde PLANNED sevkiyatın çözümü storno'nun `releaseSacks` seçeneği ve Sevkiyatlar detayındaki \"Sevk Et\" düğmesidir — bkz. aşağıdaki 2026-08-22 \"SEVK KAPISI = BAYRAĞIN EKRANI\" notuna bak."*

### B11 — Arşiv `L302` · "kaliteyi KK2/Kurşun da belirler" · `[KARIŞIK]` ⚠️ **en yanıltıcı bayat**
- **Eklenecek şerh:** *"> ⚠️ **2026-09-03 DÜZELTMESİ:** Bu notun \"kaliteyi yalnız kalite istasyonları (KK1 opsiyonel giriş, **KK2/Kurşun**, Tambur) belirler\" cümlesi bugün YANLIŞTIR: `PROCESS_QC` kalite NOTU YAZMAZ — `Teks-Erp/src/services/kursun-qc.service.ts` içinde `qualityGrade` hiç geçmez (0 eşleşme); o istasyonun işi hata toplamak ve `QC2_COMPLETED` izi bırakmaktır. Kalite bugün İKİ kapıda doğar: KK1 girişi (`inventory.service`) ve Tambur finalize. ⚠️ Ayrıca \"Tambur zorunlu değil / son adım finalize eder\" kuralı ÇEKİRDEK'tir; \"fabrika çözgü/dokuma yapmaz\" ise PROFİL — bkz. MODUL-BAYRAK-TASARIM §5.1/§5.2."*
- **Neden kritik:** kalite-yetenek dönüşümünü (plan P4, `stepCanApplyQuality`) planlayan bir sonraki modeli doğrudan yanıltır.

### B12 — Arşiv `L714` · "tablet hâlâ bitmiş topu okutamıyor" · `[KARIŞIK]`
- **Eklenecek şerh:** *"> ⚠️ **BU AÇIK AYNI GÜN KAPANDI (2026-08-25 akşam):** eleme kaldırıldı ve karar saf yükleme taşındı — `mobil/src/screens/Modules/HizliIsEmri/scanClassify.ts` (dosya başlığı bu satırın kaldırıldığını açıkça yazar) + `useQuickWorkOrder.ts:571`; sıra kuralı da orada: iptal → statü → çuval/sevkiyat → kumaş kilidi. Ayrıntı için aşağıdaki \"Mobil Hızlı İş Emri artık BİTMİŞ topu da alıyor\" notuna bak."*
- **Neden:** açık madde olarak bırakılırsa bir sonraki oturum aynı işi ikinci kez yapar.

### B13 — Arşiv `L868` · Electron yayın adresi · `[PROFİL]`
- **Eski:** `https://demo.etkiliyazilim.com/guncelleme/electron/`
- **Eklenecek şerh:** *"> ⚠️ **BU ADRES BAYAT (aynı notun ilerisinde değiştirildi):** yayın bugün `https://guncelleme.etkiliyazilim.com/<müşteri>/<ürün>/` altındadır ve müşteri kodu tek kaynaktan gelir — `Electron/shared/musteri.json` (`kod: \"adnansahin\"`) + `Electron/shared/update-feed.ts`; `demo.etkiliyazilim.com/guncelleme/electron/` yalnız ilk kurulumun tarihçesidir, yeni paket ASLA o adrese kurulmaz."*
- **Neden:** notun ilk paragrafını okuyup duran biri yanlış feed adresiyle paket üretir; düzeltme not içinde 20 satır sonra geliyor.

### B14 — Arşiv `L116` · "dört emekli statü" · `[ÇEKİRDEK]`
- **Eski:** "o dört emekli statünün Electron'daki TEK liste yüzeyi"
- **Eklenecek şerh:** *"> ⚠️ **2026-08-25'te GÜNCELLENDİ:** Arşiv artık DÖRT değil ALTI statü taşır — `CANCELLED` ve `SCRAP` eklendi (`Electron/src/pages/Operations/Rolls/service.ts:56-57`, `STATUS_GROUPS.ARCHIVE`); gerekçe ve sayfa araması için aşağıdaki 2026-08-25 ②b notuna bak."*

### B15 — `docs/ops/TICARET-KURULUM.md` §1 (satır 42-51) · bayrak tablosu · `[ÇEKİRDEK]` ⚠️ **en ağır ops bulgusu**
- **Eklenecek metin:** *"⚠️ 2026-09-03 — BU BÖLÜM EKSİK: rejim bayrağı ARTIK ÜÇ. `ticaret.enabled` (varsayılan **KAPALI**) alış siparişi · mal kabul · fiyat listeleri · stok sayımı uçlarının ÖNÜNDE kapı olarak durur (`src/routes/goods-receipt.routes.ts:27`, `purchase-order.routes.ts:51`, `item-price.routes.ts:46`, `stock-count.routes.ts:44` → `requireTicaretEnabled`). Açılmazsa reçetenin ana akışı (satın al → mal kabul) **403 `MODULE_DISABLED`** verir. İplik kg defteri kullanılacaksa ayrıca `iplik.enabled` (ticarete bağımlı, ticaret KAPALIYKEN açılamaz — 400 `MODULE_DEPENDENCY`). Tabloya ekle: `ticaret.enabled` | Muhasebe/Modüller | KAPALI | **AÇ** · `iplik.enabled` | aynı | KAPALI | iplik kullanılıyorsa AÇ."*
- **Kanıt:** `system-setting.service.ts:1070-1072` (varsayılan KAPALI); `scripts/setup-ticaret.ts:50,214-228` (betik doğru davranıyor).

### B16 — `docs/ops/TICARET-KURULUM.md:318` §9 · betik açıklaması · `[ÇEKİRDEK]`
- **Eski:** "`finance.enabled` + `finance.pricingEnabled` bayraklarını açar"
- **Yeni:** *"⚠️ 2026-09-03 düzeltme — betik artık **DÖRT** bayrak açar: `finance.enabled` · `finance.pricingEnabled` · `ticaret.enabled` · `iplik.enabled`. Bayrak sırası load-bearing: **ticaret İPLİKTEN ÖNCE** yazılır (iplik ticarete bağımlı; ters sırada ilk çağrı 400 `MODULE_DEPENDENCY` alır ve kurulum yarıda kalır)."*
- **Kanıt:** `scripts/setup-ticaret.ts:203-229` (`flagPlan`, 214-216 yorumu).

### B17 — `docs/ops/KURULUM.md:56` ve `:89` · katalog sayıları · `[ÇEKİRDEK]`
- **Eski:** "55 permission, 15 permission template" → **Yeni:** "**86 permission, 29 permission template**"
- **Öneri:** rakam yerine *"katalogdaki kadar"* (tek kaynak `permission-catalog.ts` + `role-template-catalog.ts`; seed listeyi taşımaz, boot uzlaştırması getirir).
- **Not:** `prisma/seed.ts:15-17` yorumu da 58/15'te kalmış.

### B18 — `docs/ops/KURULUM.md:22-31` · A1 ENV bloğu · `[ÇEKİRDEK]` — ~~ÜSTÜ ÇİZİLDİ~~
> ⛔ **ÜSTÜ ÇİZİLDİ — 2026-09-03 P8 ile `.env` yolu KALDIRILDI. AŞAĞIDAKİ METNİ UYGULAMAYIN:**
> uygulanırsa kaldırılan sır yüzeyi (`.env`de duran parola hash'i + PIN + TOTP
> sırrı) reçeteyle geri gelir. Satıcı hesabının tek doğuş yolu artık sunucuda
> elle koşulan `npm run superadmin:kur`tur (idempotent; rotasyon `--rotate`;
> **gerçek TTY ister** — `ssh -t` / `docker exec -it`). Bu maddenin yerini
> `KURULUM.md` A3b "Süperadmin kurulumu" bölümü aldı; `.env`de kalan
> `SUPERADMIN_*` satırları artık okunmuyor ve boot log'unda **silinmeleri**
> için uyarı basılıyor (yalnız anahtar adı; değer asla).
- ~~**Eklenecek metin:**~~ *"⚠️ 2026-09-03 — ENV artık iki değişkenle bitmiyor. Satıcı (süperadmin) hesabı `.env`den tohumlanır ve **satırlar yoksa hesap hiç doğmaz** (`src/jobs/superadmin.job.ts:90-110`; eksikse boot log'unda \"SUPERADMIN_* tanımlı değil — satıcı hesabı oluşturulmadı\"). Yeni kurulumda ekle: `SUPERADMIN_USERNAME` · `SUPERADMIN_PASSWORD_HASH` (HAM parola DEĞİL, hazır bcrypt `$2b$10$…`) · `SUPERADMIN_PIN` (TAM 6 hane, sistem genelinde benzersiz) · opsiyonel `SUPERADMIN_TOTP_SECRET` (uzaktan giriş için zorunlu). Örnek satırlar `Teks-Erp/.env.example:66-82`, kurulum reçetesi `docs/ops/UZAK-ERISIM-KURULUM.md:147-173`. ⚠️ Bu değerler `.env` + parola yöneticisi dışında HİÇBİR yere yazılmaz (repo/log/audit diff dahil)."*

### B19 — `docs/ops/KURULUM.md:120` · D bölümü, installer üretimi · `[ÇEKİRDEK]` ⚠️ **çok müşteride kritik**
- **Eski:** "35. **Installer üret:** `npm run build:win`"
- **Yeni:** *"⚠️ **Ham `npm run build:win` KULLANMA** (2026-08-26'dan beri; çok müşteride kritik). Yayın adresi pakete **derleme anında** gömülür — `package.json`da hangi müşteri yazılıysa onunla derler ve yanlış müşteri kodu taşıyan paket **başka bir fabrikanın güncellemesini indirip kurar**; hata SESSİZDİR (dosyalar kendi aralarında tutarlı kalır). Doğru komut: `./deploy/electron-paketle.sh <müşteri>` — müşteri kodunu `shared/musteri.json` ve `package.json > build.publish` içine birlikte yazar, derler ve derlemeden SONRA paketin içindeki gömülü adresi argümanla kıyaslayarak kapı kurar. Ayrıntı: `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md`."*

### B20 — `docs/ops/KURULUM.md:101` · ADIM 9 (İstasyon Yetenekleri) · `[ÇEKİRDEK]`
- **Eklenecek metin:** *"⚠️ 2026-08-02 düzeltmesi — **renk artık istasyon kısıtı DEĞİL.** Boyahane fiziksel olarak her rengi boyar; rota adımının renk seçicisi tüm aktif renk kataloğunu gösterir ve yeni tanımlanan renk hiçbir yere işaretlenmeden anında kullanılabilir. `StationColor` satırları geriye dönük uyum için duruyor ama **hiçbir yer onu filtre olarak kullanmaz** (`src/services/station-capability.service.ts:7-11`; renk kilidi `requiredCategory.appliesColor` ile çözülür — `src/services/helpers/workorder-locks.helper.ts:21-26`). Bu adımda girilecek olan **yalnız `StationProperty`**'dir (gerçek proses kısıtı + \"buradan geçen top bunu otomatik kazanır\"): Kurşun=KURSUN, Zımpara=ZIMPARALI."*
- **Neden:** sahada tam bu yüzden 58 aktif renkten 8'i rota adımında görünmüyordu; reçete yeni fabrikada aynı tuzağı kurar.

### B21 — `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md:16-18` · "Nasıl çalışıyor" diyagramı · `[ÇEKİRDEK]`
- **Eski:** "sürüm no'yu artır" · `npm run build:win`
- **Yeni:** "**sürüm notunu yaz (kapı)**" · **`./deploy/electron-paketle.sh <müşteri>`**
- **Gerekçe metni:** *"(a) yama hanesini 2026-09-02'den beri script artırıyor (taban git etiketi `panel-v*`, doğrulayan yayın sunucusu — `scripts/lib/surum.mjs`); elle artırma yalnız küçük/büyük hane için geçerlidir ve o bir karardır. (b) Ham `build:win` bir önceki müşterinin adresiyle derler — bu belgenin kendi §\"2. Paketle\" bölümünde zaten yasaklı (satır 240-243)."*
- **Not:** belge kendi içinde çelişiyor; çelişkinin yanlış tarafı en çok okunan diyagramda.

### B22 — `docs/ops/DEPLOY-RUNBOOK.md:48` · build klonu / `adnansahin` dalı · `[ÇEKİRDEK]`
- **Eklenecek metin:** *"⚠️ 2026-09-02 — `adnansahin` dalı **EMEKLİ**; build klonu `main` ucundadır ve paket `main`'den üretilir (`docs/design/MODUL-BAYRAK-TASARIM.md` §0: müşteri dalı/forku yasak). Sunucuda tek seferlik geçiş adımı ve `git branch -D adnansahin` temizliği `deploy/README.md`'dedir. `C:\Etkili-Yazilim\tekserp` klonunun dar refspec'i (`+refs/heads/main`) artık YETERLİDİR; onu paket için kullanmama gerekçesi yalnız sparse checkout'ta `deploy/` dizininin olmamasıdır."*
- **Neden:** `deploy/README.md:21-38` güncel, runbook eski — ve runbook kendini "çelişki görürseniz bu tablo geçerlidir" diye yetkilendiriyor.

### B23 — `docs/ops/DEPLOY-RUNBOOK.md:104` · `DATABASE_URL` · `[ÇEKİRDEK]`
- **Eski:** "dev = `adnansahin_db`, üretim = `tekserp`"
- **Yeni:** *"dev = `tekserp_demo` (mevcut `Teks-Erp/.env`), üretim `tekserp`. ⚠️ Çok müşteride DB adı bir **kurulum parametresidir** — dokümana müşteri adı gömmek yerine 'ortam/müşteri başına farklı; yetkili değer o kurulumun `.env`indedir' demek doğru olanıdır."*
- **Neden:** yedekleme host/port/user/db'yi bu URL'den çözüyor (`backup.service.ts`) — yanlış ad geri yükleme tatbikatında hedefi ıskalatır.

### B24 — `Teks-Erp/ARCHITECTURE.md:890` §10.1 · DB adı notu · `[ÇEKİRDEK]`
- **Eski:** "dev = `adnansahin_db` (.env), Windows production = `TeksErpDb` (installer)"
- **Yeni:** *"-- DB adı ortam/müşteri başına farklıdır ve yetkili değer o kurulumun `.env`indedir (bugün: dev `tekserp_demo`, saha üretim `tekserp`). ⚠️ `installer` yolu 2026-07-30'da tamamen kaldırıldı — `TeksErpDb` adı yalnız o installer'ın ürettiği tarihsel kurulumlarda geçerlidir."* Örnek SQL'deki `ALTER DATABASE "TeksErpDb"` da parametreleştirilmeli.
- **Neden:** üç bayatlık aynı satırda; blok "yeni kurulum / DB taşıma sonrası uygulanacak" SQL'in başında duruyor.

### B25 — `docs/design/TICARET-PAKETI-TASARIM.md:161-165` §8 · Mal Kabul kapısı · `[ÇEKİRDEK]`
- **Eski:** "Mal Kabul karosu yalnız izinle kapılı (tek depolu ticaret firması da kullanacağı için `multiWarehouse` şartı konamaz)"
- **Eklenecek metin:** *"⚠️ 2026-09 güncellemesi — Mal Kabul artık **yalnız izinle kapılı DEĞİL**: `goods-receipt.routes.ts:27` üzerinde `requireTicaretEnabled` modül kapısı var (`MODUL-BAYRAK-TASARIM.md` karar #4 — planın iki bilinçli statü değişikliğinden biri; ölçüm: fabrika dump'ında 0 mal kabul). Paragrafın gerekçesi (\"`multiWarehouse` şartı konamaz\") DOĞRU kalır — kapı çoklu depoya değil **ticaret modülüne** bağlandı; depo transferi ayrıca `requireDepoMultiEnabled` taşır (`warehouse-transfer.routes.ts:24`). İzin katmanı da yerinde durur: iki kapı, iki soru (\"bu kurulum ticaret paketini kullanıyor mu\" ≠ \"bu kullanıcı yetkili mi\")."*

### B26 — `docs/ops/DEVIR-2026-08-17-FABRIKA-TALEP.md:3` · dal adı · `[ÇEKİRDEK]` · ⚠️ *biçim tartışmalı*
- **Öneri:** *"**Dal:** `adnansahin` *(2026-09-02'de EMEKLİ — bu satır tarihsel; iş bugün `main` üzerindedir, bkz. `deploy/README.md` ve `docs/design/MODUL-BAYRAK-TASARIM.md` §0)*"*
- **Tartışmalı olan:** belge tarihsel bir devir notudur; düzeltme mi parantez içi şerh mi olacağı karar ister. Öneri: **parantez içi şerh** (içerik yeniden yazılmasın, ama okuyucu var olmayan dala checkout denemesin).

---

## § Additive şerhler (kesin)

> 80 madde. Hepsi **tek satır/tek blok ekleme**; mevcut hiçbir cümle silinmez veya yeniden yazılmaz.
> **Uygulama sırası:** önce yapısal çerçeve (Grup A), sonra alt-proje kontrol listeleri (B–D), sonra arşiv (E, satır sırasına göre), en son ops/design (F).

### GRUP A — Kök `CLAUDE.md` (önce bunlar; hepsi çerçeve kurar)

**A1 · satır 1 ("# TeksERP — Monorepo Kökü") hemen altı · `[ÇEKİRDEK]`**
```
> **Tek gövde, çok fabrika — kural yazarken sor: çekirdek mi, profil mü?** [ÇEKİRDEK] her kurulumda aynıdır (defter semantiği, brüt sevk, idempotency, kilit sırası, atomik claim, fail-closed kapılar, sır hijyeni, veri bütünlüğü). [PROFİL] bu fabrikanın seçimidir ve bayrak/veriyle değişir (rota, istasyon topolojisi, açık modüller, sayısal ayarlar). Sınıflama ölçütü ve red gerekçeleri: `docs/design/MODUL-BAYRAK-TASARIM.md` §0 ve §11.
```

**A2 · satır 31, "### Karar Notları Dizini" blockquote'unun sonuna · `[ÇEKİRDEK]`**
```
**Yeni not sınıf etiketi TAŞIR:** buraya eklenen her özet satırı `[ÇEKİRDEK]` (her kurulumda aynı — defter semantiği, veri bütünlüğü, idempotency, kilit sırası, fail-closed kapı, sır hijyeni) ya da `[PROFİL]` (bu fabrikanın seçimi; bayrak/veri/rota türevi) etiketiyle başlar; karma notlarda etiket cümle bazında verilir. Ölçüt: MODUL-BAYRAK-TASARIM §11'deki "bayraklanmayacaklar" listesindeki her şey ÇEKİRDEK'tir.
```

**A3 · satır 15 "## Üretim Akışı" başlığının hemen altı (kod bloğundan ÖNCE; başlık DEĞİŞTİRİLMEZ) · `[PROFİL]`**
```
> ⚠️ **Referans profil: işlemeci (adnansahin)** — aşağıdaki akış bu fabrikanın ROTASIDIR, sistemin zorunlu akışı değil; her adım istasyon kataloğundan + rota şablonundan kurulur. Profil gerçeği — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §5 (üretim esnekliği) ve §10 (profil tablosu).
```

**A4 · satır 239 "## Ortak Konvansiyonlar" başlığının hemen altı · `[ÇEKİRDEK]`**
```
> Bu bölümün tamamı **[ÇEKİRDEK]**'tir — bayrakla açılıp kapanmaz, profile göre değişmez (UUID/zaman damgası, soft delete, audit, beş sağlamlık sınıfı, yıkıcı işlemde detaylı onay). "Bizde böyle olmasın" talebinin cevabı bayrak değil süreç/eğitimdir; red gerekçesi: MODUL-BAYRAK-TASARIM §11 (defter semantiği · veri bütünlüğü değişmezleri · mevzuat bayraklanmaz).
```

**A5 · satır 25 ("Fabrika **çözgü/dokuma yapmaz**…") · `[PROFİL]`**
```
⚠️ Profil gerçeği — bu cümle adnansahin'in rotasını anlatır, sistemin kısıtını değil: devere (levend/çile/bobin aktarma), çözgü, haşıl **yeni mimari istemez** — istasyon kataloğuna istasyon, rotaya adım eklenir. Dokuma diliminin tek tasarım işi "top TEZGAHTAN doğar" damgasıdır (doğum: tezgah + çözgü levendi + iplik lotu). bkz. MODUL-BAYRAK-TASARIM §5.2 · Dilim 4.
```

**A6 · satır 21 (Üretim Akışı bloğu, "Çuval Depo … mühür/rezerv YOK") + satır 33 (Çuval depo modeli özet satırı) · `[PROFİL]`**
```
⚠️ Profil gerçeği — "rezerv YOK" bugünkü kurulumun seçimidir, kalıcı bir domain kuralı değil: rezervasyon **kendi append-only defteriyle** ayrıca kurulacak (`shipping.reservationEnabled`, karar #6) ve `SackAllocation`'a DOKUNULMAYACAK — o sevk muhasebesidir. Yeni rezervasyon yüzeyi yazmadan önce MODUL-BAYRAK-TASARIM karar #6 + §9.
```

**A7 · satır 93 ("**Phase 1:** COM port …") · `[KARIŞIK]`**
```
⚠️ Kural duruyor; ölçek notu: gerçek makine verisi geldiğinde de backend'e seri port/polling GİRMEZ — fabrika LAN'ında **ayrı bir toplayıcı ajan** okur ve API'den basar (tablet gibi bir istemci), tek-process invariantı korunur. Gerçek sürücü ilk dokuma müşterisinin sahasında pilotla gelir. bkz. MODUL-BAYRAK-TASARIM §8 (`modul.tezgah-izleme`).
```

**A8 · satır 94 ("⚠️ PRODUCTION CANLI…") · `[ÇEKİRDEK]`**
```
⚠️ Ölçek notu: "production" artık **tekil değildir** — kural kurulum sayısından bağımsız olarak HER canlı kurulum için geçerlidir. Şema/migration işinde ölçüt "bizim fabrika" değil *en eski canlı kurulumun verisi*dir; prova o kurulumun kendi dump'ı üstünde yapılır (kabul testi: dump restore → `migrate deploy` → bekçiler → profil boot). bkz. MODUL-BAYRAK-TASARIM §0.
```

**A9 · satır 111 (Refakat kartı = A5 varsayılan…) · `[PROFİL]`**
```
⚠️ Profil gerçeği — A5 **varsayılanı ve doluluk ölçümü** (WO max 3 adım / 1 sipariş / 2 parti → A5'te %75) bu fabrikanın verisinden çıktı. Sayfa boyutu bir kurulum ayarıdır (`DEFAULT_TRAVELER_CARD_CONFIG.pageSize` + panel + baskı başına ezme); daha çok adım/sipariş/parti taşıyan bir kurulumda varsayılan A4 seçilebilir — kod değişikliği değil profil kararı. Yoğunluk profili (`traveler-card.density.ts`) ve donmuş belge kuralı ÇEKİRDEK kalır.
```

**A10 · satır 134-135 (PARTİ NO KISA ve DÖNEN) · `[PROFİL]`**
```
⚠️ Profil gerçeği — `P01…P99` körlemesine sarma, adnansahin'in **fiziksel parti plakası** setinin karşılığıdır ve bir bayrağa bağlıdır (`batch.shortNumberEnabled`, bugün AÇIK). Plakasız/uzun-parti çalışan bir kurulumda bayrak kapalı (günlük kalıp) profille kurulabilir. Ayar değerini **kurulum profili** yazar; koddaki default yalnız satır-yok sigortasıdır. Sarmayı mümkün kılan invariantlar (kimlik = `Batch.id`, `orderBy: batchNumber` YASAK, advisory kilit 8022) her iki rejimde de ÇEKİRDEK.
```

**A11 · satır 146 (Kurşun + QC2 = tek fiziksel istasyon) · `[PROFİL]`**
```
⚠️ Profil gerçeği — "kurşun ile KK aynı istasyonda" adnansahin'in TOPOLOJİSİDİR; sektörde KK ayrı istasyonda ya da başka bir istasyonla birlikte yapılır (tasarım karar #11, §5.1). Bugün kalite hâlâ `StationKind`'a bağlıdır — **`station.appliesQuality` HENÜZ YOK** (2026-09-03 ölçümü: `prisma/schema.prisma` + `helpers/step-capability.helper.ts` içinde 0 eşleşme). Dönüşüm Dilim 1 · P4'te tek yüklem boğazına (`stepCanApplyQuality`) alınacak; yeni bir `kind === "PROCESS_QC"` karşılaştırması yazmadan önce MODUL-BAYRAK-TASARIM §5.1 + UYGULAMA-PLANI "Kalite-yetenek" bölümünü oku (Faz A/Faz B ayrımı).
```

**A12 · satır 147 (Hata yaşam döngüsü) · `[KARIŞIK]`**
```
⚠️ "PROCESS_QC'de açılır" varsayımı kalite-yetenek dönüşümünün etki listesindedir (UYGULAMA-PLANI, Faz B · R5: hata çok-istasyonlu olunca partial unique 409 riski). Hata AÇILMA/KAPANMA semantiği (Tambur kararıyla kapanır, `isProcessed`, `CUT|NO_CUT`) ÇEKİRDEK'tir; hatanın hangi istasyonda açıldığı PROFİL'dir. Bu varsayıma yaslanan yeni yüzey yazmadan önce Faz B listesine bak.
```

**A13 · satır 109 (Şube bazlı planlama) · `[KARIŞIK]` — ⚠️ sınıfı tartışmalı, bkz. § Sabah onayı**
```
⚠️ Profil gerçeği — bugünkü kurulumda tek şube var. `branchId`'nin **opsiyonelliği ÇEKİRDEK**'tir (şubesiz kurulum meşru); çok-şubeli planlama yüzeyi ise profil kararıdır ve çoklu depo (`depo.multiEnabled`) ile karıştırılmamalı — şube ticari, depo fiziksel adrestir. Çok-şube/çok-saat-dilimi doğarsa gün sınırı yine tek noktadan çözülür (`FACTORY_TIMEZONE`).
```

**A14 · satır 259-261 "## Test Kullanıcıları" bölümünün sonuna · `[ÇEKİRDEK]`**
```
⚠️ Buraya **yalnız seed/dev kimlikleri** yazılır. Süperadmin (satıcı hesabı) parolası/PIN'i ve ayar şifresi repoya, log'a, sürüm notuna ve audit diff'ine GİRMEZ; dağıtım yalnız `.env` + parola yöneticisiyle olur (`quickPin` emsali gibi redaksiyon listesine eklenir). bkz. MODUL-BAYRAK-TASARIM §7 ve §12.8 (sır hijyeni).
```

### GRUP B — `Teks-Erp/CLAUDE.md`

**B-a · satır 305-322 "## Yeni Endpoint Kontrol Listesi", Route maddesinden hemen sonra yeni kutu · `[ÇEKİRDEK]`**
```
- [ ] Uç bir modüle aitse router **adlandırılmış** modül kapısını taşıyor (`requireProductionEnabled` / `requireTicaretEnabled` / `requireIplikEnabled` / `requireDepoMultiEnabled` — `src/middlewares/module.middleware.ts`); jenerik `requireModule("x")` YASAK (bekçiler middleware ADINI metin arar). Kapı gerekmiyorsa gerekçesi `REGIME_GATES` / muaf listesinde YAZILI. Kapalı modülde LAN'da 403 + `MODULE_DISABLED`, tünelde 404.
```
*Gerekçe:* P1 canlı (`goods-receipt.routes.ts:27` · `stock-count.routes.ts:44` · `workorder.routes.ts:21` · `station-capability.routes.ts:25`) ama backend CLAUDE.md'de "modül/kapı" kelimesi hiç geçmiyor (grep: 0).

### GRUP C — `Electron/CLAUDE.md`

**C-a · satır 1-5, başlık bloğunun altına (başlık DEĞİŞTİRİLMEZ) · `[PROFİL]`**
```
> ⚠️ Profil gerçeği — "Adnan Şahin ERP" bugünkü **paket kimliğidir**, ürünün adı değil: `package.json:3` `productName` ve `:122` `appId: com.etkiliyazilim.adnan-sahin-erp` sabittir ve müşteriyle BİRLİKTE TÜREMEZ — `deploy/electron-paketle.sh` yalnız `shared/musteri.json`u (kod/ad/ERP adresi) yazar. İkinci müşteride panel yine bu adla kurulur; çözüm `if (musteri === 'X')` değil, paket kimliğini `musteri.json`dan türetmektir (ayrı karar). bkz. MODUL-BAYRAK-TASARIM §11 son madde.
```

### GRUP D — `mobil/CLAUDE.md`

**D-a · satır 262-271 "## Ekran Önceliği" listesinin sonuna · `[PROFİL]`**
```
⚠️ Profil gerçeği — bu sıra **üretim profilinin** ekran haritasıdır. Modül kapalıyken (ör. toptancı: `production.enabled=false`) tablette karşılığı YOK: `useVisibleScreens` yalnız izne bakar (`src/hooks/useVisibleScreens.ts:38-40` — `conditional` boş nesne) ve `MODULE_DISABLED` kodu mobil kaynakta hiç geçmez (2026-09-03 ölçümü: `src` altında 0 eşleşme) → kapalı modülde ekran menüde durur, her aksiyon jenerik hata toast'ı basar. Adnan'da üretim AÇIK olduğu için bugün görünmez. İlk üretim-kapalı müşteride ŞART: `announceFailure`a `details.code === "MODULE_DISABLED"` dalı + `conditional`ı `useFeatureFlags`ten besleme (APK ister). bkz. UYGULAMA-PLANI "P1 — AÇIK KALANLAR".
```

### GRUP E — `docs/history/CLAUDE-NOT-ARSIVI.md` (54 şerh; satır sırasına göre)

> **Önce E0**, sonra kalanlar. Her şerh, hedef notun **hemen üstüne/altına ayrı bir alıntı satırı** olarak eklenir.

**E0 · L3-L14 dosya başlığı ("yeni not kuralı") bloğunun hemen altına · `[ÇEKİRDEK]`**
```
> **⚠️ Sınıf etiketi kuralı (2026-09-03):** Bundan sonra her yeni karar notu başlığında `[ÇEKİRDEK]` (her fabrikada değişmez: defter semantiği, brüt sevk, idempotency, kilit sırası, fail-closed kapılar, sır hijyeni, veri bütünlüğü) ya da `[PROFİL]` (bu kurulumun seçimi) etiketi taşır; karışık notta profil-bağımlı cümle satır içinde ⚠️ ile işaretlenir — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §0/§11.
```

**E1 · L18 (Çuval depo modeli) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "Rezerv YOK" · "mühür YOK" · `Sack.customerId` opsiyonel · tek depo — dördü de referans profilin (adnansahin, basit usul işlemeci) seçimidir; rezervasyon altyapısı `shipping.reservationEnabled` ile ayrı dilimde gelecek, çoklu depo `depo.multiEnabled` arkasında. Notun **stok yalnız DISPATCH'te düşer / `SackAllocation` sevk ANINDA yazılır / PLANNED tahsis sayılmaz** kısmı ÇEKİRDEK defter semantiğidir ve bayraklanmaz — bkz. MODUL-BAYRAK-TASARIM §4 karar #6, §9, §11.
```

**E2 · L20 (çuval notu + SACK etiketi + tek dokunuş tartı) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Çuval notunun üç yüzeydeki opt-in gösterimi, SACK etiketi alan seti ve "tek dokunuş tartı" bu kurulumun paketleme/sevkiyat tercihidir; **FAIL-CLOSED baskı** (şablon çözülemezse 400, başka `LabelKind`'a SAPMAZ) ve "blocklist yeni kolonu müşteri belgesine sızdırır" kuralı ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.
```

**E3 · L26 (koşullu etiket elemanı, showIf) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** "değer `code`'dur ad değil" · `toLocaleUpperCase("tr")` yasağı · kalitesiz topta fail-closed · tek uygulama noktası `prepareElements` — dördü de fabrikadan bağımsız; bayraklanmaz (MODUL-BAYRAK-TASARIM §11).
```

**E4 · L33 (sevk rakamı BRÜT) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** Brüt sevk · donmuş belge · "iade AYRI belgeyle kapanır" · "Güncel rozeti = son versiyon, içerik güncel DEĞİL" — MODUL-BAYRAK-TASARIM §11'in ilk maddesi (defter semantiği bayraklanmaz): iki müşterinin raporu aynı kelimeyle farklı şey söyleyemez.
```

**E5 · L39 (brüt kuralı liste + muhasebe ekranı) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "Sevkiyatlar (Muhasebe)" ekranı + `invoiceNo` fatura izi, muhasebecisi AYRI program kullanan kurulumun **dış muhasebe köprüsü**dür ve çekirdek sevkiyatın parçasıdır; `modul.finans` açık kurulumda aynı ekran terfi eder ve çakışma `shipping.invoiceMode = dis|ic|ikisi` ile çözülür. `attachTotals`'ın BRÜT olması ve `dispatchedAt` union'ında iki tarafın alan adının farklı olması ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §6.
```

**E6 · L45 (brüt → çuval içeriği) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** Tek kaynak (`RollReturn`, snapshot DEĞİL) · tx'siz iki sorguda dedup · `totalKg` değişmez · "mobil istemci brütü elle kurmaz" — dördü de fabrikadan bağımsız; MODUL-BAYRAK-TASARIM §11.
```

**E7 · L53 (belge yolu da brütleşti) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** "Freeze tek koruma" varsayımının çürütülmesi ve "yeni sevk-içeriği yüzeyi eklerken sor: sevkten SONRA da koşar mı?" sorusu her kurulumda geçerlidir — MODUL-BAYRAK-TASARIM §11.
```

**E8 · L59 (Roll.foldType + entryReason + manuel top PARTİLİ) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "Kat 2 değerli, o yüzden index eklenmedi" ve kat kataloğunun içeriği (2-KAT/4-KAT/TUP) bu kurulumun ürün karakteristiğidir (`modul.uretim`); **kanoniklik zorunluluğu** (ham değer filtrede sessizce 0 satır döndürür), **sebep audit'ten değil KOLONDAN okunur** ve **parti üç dalı (tek açık→bağla · çok→400 · hiç→null)** ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §5.2, §11.
```

**E9 · L69 (rota şablonu HEDEF saklar) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "Renkte `hasDefaultCategory` DE aranır, yoksa Tambur adımına renk yazılır" cümlesi, boya işini yalnız FASON firmanın yaptığı bu kurulumun topolojisinden doğar; iç boyahaneli kurulumda kural `stepCanApplyColor` üzerinden aynı kalır ama "kategorisiz istasyon = renk veremez" varsayımı geçersizdir. "Hedef ÖNERİDİR, kilit değil" · "istemci sözleşmesi DÜZ ID dizisi" · "istasyon değişince hedef sıfırlanır" ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §5.1/§5.2.
```

**E10 · L78 (Kurşun Planlama) · `[PROFİL]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Bu notun tamamı `modul.uretim` altındaki **kurşun + KK2 tek fiziksel istasyon** (`StationKind.PROCESS_QC`) topolojisini varsayar — kaliteyi ayrı istasyonda yapan fabrikada ekran, rejim anahtarı ve "sonraki adım TAMBUR olmalı" şartı yeniden değerlendirilir (Faz B). Taşınabilir olan kısım: **tek kapı / tek yüklem** disiplini (`assertKursunTabletMayWrite`) ve "toplu sonuç PARÇALI, atlanan satır sebebiyle döner" kuralı — bkz. MODUL-BAYRAK-TASARIM §5.1, UYGULAMA-PLANI "Faz B" (R3).
```

**E11 · L94 (dağıtım ön koşul değil) · `[PROFİL]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "Tambur kilometre taşıdır" ve "bayrak AÇIK + adım bypass'a UYGUN" kapsamı bu kurulumun kurşun/tambur rotasına aittir (`modul.uretim`); Tambur'suz rotalı fabrikada kilometre taşını rota belirler. Taşınabilir çekirdek: **milestone confirmation deseni**, "makine atfı UYDURULMAZ (`machineId=null` + görünür bant)" ve marker ön ek uyumu — bkz. MODUL-BAYRAK-TASARIM §5.1.
```

**E12 · L105 (manuel top geri alma + izlenebilirlik) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Tambur ekranı, "Son Çıkan Toplar" ve `mobile:tambur-duzelt` izni `modul.uretim` yüzeyleridir; **`qtyOut=0` storno ≠ `qtyOut=qtyIn` dispozisyon**, "iptal edilen `clientToken` REPLAY EDİLEMEZ (409)", "barkod topun KİMLİĞİdir, koruma STATÜDEDİR" ve "alan eklemek yetmez, hangi YANITTA döndüğünü doğrula" ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.
```

**E13 · L119 (KK1 mükerrer koruması) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** Giriş MOTORU (Roll doğuran servis + guard'lar) kapatılamaz çekirdektir — advisory kilit sırası, `clientEnteredAt` penceresi, `shouldReleaseInFlight` ve "5xx ulaşılamıyor DEĞİLDİR" her kurulumda geçerli. ⚠️ Değişebilen tek şey SUNUM: "KK1 istasyon ekranı" `modul.uretim` altındadır, toptancı profilinde aynı motorun üstüne sade "Mal Girişi" ekranı gelir — bkz. MODUL-BAYRAK-TASARIM §4 karar #2, §12 kural 4.
```

**E14 · L129 (giriş izlenebilirliği) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "ÖLÇEK TETİĞİ" maddesindeki rakamlar (87 giriş/30 gün, tek ham giriş istasyonu) bu fabrikanın hacmidir — başka kurulumda eşik ilk günden aşılabilir, o yüzden tetik kuralını (500+ giriş/gün ya da 4+ eşzamanlı istasyon → `pg_locks` ölçümü) kuruluma göre YENİDEN ölç. `readIdCondition`'sız elle id okuma → P2007, `kk1.historyAllEntriesEnabled` dört kapı ve `forcedCreatorFilter`'ın SAF katmanda olması ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §11.
```

**E15 · L140 (top listesi filtresi) · `[PROFİL]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "KK1 ve Tambur ekranları" `modul.uretim` yüzeyleridir; toptancı/dokuma profilinde aynı bileşen başka ekran çiftine bağlanır. Taşınabilir çekirdek: **süzme SUNUCUDA** (cursor'lu listede istemci süzmesi yanlış "kayıt yok" üretir), `dateField` gönderilmezse aralık SESSİZCE yok sayılır, `last7` bugünü içerir — bkz. MODUL-BAYRAK-TASARIM §11.
```

**E16 · L154 (kesimde kat sessizce düşüyordu) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "Kat" alanı ve Tambur kesim yolu `modul.uretim`/`modul.kumas-teknik` bağlamıdır; **"gövdeyi elle kuran her katman sessiz bir allowlist'tir"** (Zod dersinin istemci ikizi), "etikete katalog KODU basılır, ad değil" ve `present:false` sözleşmesi ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.
```

**E17 · L163 (SINGLE_RESTORE + F0402) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Tambur geri-alma modları ve modal metinleri `modul.uretim` yüzeyidir; **"restore-toplamına giren HER kaynak `applyFull` terslemesine de eklenir, yoksa çift sayım"** senkron sözleşmesi ve **"genel 'stoktan kaldır' tuşu bilinçli RED — sebebi söyleyen TİPLİ olay yazılır"** kuralı ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.
```

**E18 · L172 (kayıt kuyruğu kaldırıldı) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "KK1'de tek kırmızı yüzey" ve yazıcı kuyruğu kararları bu kurulumun saha ergonomisidir; **"toast 'kayıt oluşmadı' DİYEMEZ — timeout ≠ yazılmadı"**, "çakışma 409'unun TEK yüzeyi modaldır" ve "köprü `setMutationDefaults`'a taşınamaz" ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.
```

**E19 · L182 ("giriş noktası" kuralı) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** "Giriş noktası = en erken hareketin adım sırası", "çözülemezse bekleyen say (erken COMPLETED geç olandan kötü)" ve "bekçi ile ürün kodu AYNI kuralı söylemeli" — rota topolojisinden bağımsız; MODUL-BAYRAK-TASARIM §11.
```

**E20 · L184 (parti no kâğıda + kart bayat bayrağı) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Fason çeki / kabul makbuzu yüzeyleri `modul.fason` altındadır ve "fasona giden belgede parti varsayılan AÇIK" bu kurulumun boyahane ilişkisidir; **"`sections`/`columns.hidden` BLOCKLIST'tir → naif kolon müşteri belgesinde varsayılan GÖRÜNÜR doğar"**, "fazla işaretlemek güvenli, eksik hata" ve "GET bayrağı TEMİZLEMEZ" ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §2/§11.
```

**E21 · L193 (iş emri belgeleri TEK uçtan) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Birleştirilen dört kaynağın ikisi (`SUBCONTRACTOR_RECEIPT`, `SUBCONTRACTOR_DIRECT_SHIP`) `modul.fason`a aittir — fason kapalı kurulumda liste iki kaynakla doğar. **"Liste izni ↔ baskı izni HİZALI olmalı, ayrışma = görünen satır + sessiz 403"** ve "iptal belge listede KALIR" ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §3 madde 4.
```

**E22 · L201 (storno ≠ iade + toplu iade) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** Storno ≠ iade (SAP VL09), `preShipStatus` ile rafın korunması, `freezeForSource` `max+1`, "tahsis SİLİNMEZ, `shippedQty` defterden türer", `documentSourceId` ile belge çözümü ve `shipping:undo-dispatch` görev ayrılığı — hepsi defter semantiği, bayraklanmaz (MODUL-BAYRAK-TASARIM §11).
```

**E23 · L214 (belge yerleşimi A5 + alan bazlı punto) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Sayfa boyu (A5), fason çeki grid'i ve "sayfa başına 50 top" bu fabrikanın kâğıt düzenidir — belge şablonu/ayar seviyesinde her kurulumda farklıdır. **DÖRT KAPI birlikte güncellenir yoksa ayar sessizce kaybolur**, `calc()`/`var()` yasağı ve şablon literalinde backtick yasağı ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §11.
```

**E24 · L230 (Ctrl+F kaldırıldı) · `[PROFİL]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Kaldırma bu kurulumun kullanıcı kararıdır, ürün kısıtı değil; başka fabrikada yeniden istenirse karar yeniden verilir. Taşınabilir olan tek şey tuzak: `findInPage` seçeneğindeki `findNext` "SONRAKİ eşleşme" değil "YENİ OTURUM BAŞLAT" demektir.
```

**E25 · L239 (filtrelerde çoklu seçim / CSV) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** `readIdCondition`/`readFilterList` tek kaynağı, üç arıza modu (P2007 · sessiz 0 satır · **filtre sessizce DÜŞER → YANLIŞ liste**), "backend ÖNCE" deploy sırası ve "iki değerli NOT NULL enum'da çoklu seçim gürültüdür" — hepsi fabrikadan bağımsız; MODUL-BAYRAK-TASARIM §11.
```

**E26 · L248 (üretim karakteristiği: kat kataloğu + istasyon modu) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "Bugün fabrikada içeride yapılan bir proses yok" (KAPSAM DIŞI maddesi) ve `appliesColor=false` göçü bu kurulumun topolojisidir — iç boyahaneli/dokuma profilinde bu varsayım düşer. **Bu not aynı zamanda kalite-yetenek dönüşümünün (§5.1) ÖNCÜLÜDÜR:** renk ve özellik istasyon TÜRÜnden YETENEĞE taşındı, kalite üçüncüsü olacak (`Station.appliesQuality`, Faz A) — bkz. MODUL-BAYRAK-TASARIM §5.1, UYGULAMA-PLANI P4.
```

**E27 · L313 (hazır sebep katalogları koddan DB'ye) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** "`code` rapor anahtarıdır ve ASLA değişmez, `label` serbest", üç kademeli okuma (sunucu → cihaz → APK zemini; boş liste operatörü kilitler), "silme yok/son aktif satır gizlenemez", uzlaştırma YALNIZ EKLER — kataloğun SAHİBİNİ fabrikaya vermek tam olarak çok-fabrika tasarımının istediği şeydir; yeni kind eklerken beş kapı birlikte güncellenir.
```

**E28 · L325 (fason kısmi kabul) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Bu notun tamamı `modul.fason` (hizmet ALAN yön) altındadır ve fason kapalı kurulumda hiçbir yüzeyi yoktur; boyahane profilinde (hizmet VEREN yön) aynı akışın AYNASI ayrı tasarım işidir. **Çekirdek olan:** `clientToken @unique` replay kimliği, "kalem yalnız TAM satırla kapanır — 21 filtre noktası", LIFO iptal ve "karne dönen metrajı DEFTERDEN okur" — bkz. MODUL-BAYRAK-TASARIM §2, §10.
```

**E29 · L338 (Tambur paketi 2: sektör boşlukları) · `[PROFİL]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** M1 ("Boyahaneye Geri Gönder") ve M4 (tabletten bağ sökme) `modul.uretim`+`modul.fason` yüzeyleridir; M3'ün kısa-kesim eşiği bu fabrikanın kesim pratiğidir. Taşınabilir çekirdek: **kanonik yüklem `stepCanApplyColor`** (moveService'in dar `colorStep`'i DEĞİL), `RollPlanDeviation`'ın `confirmationId` çift-sayım kilidi ve "birleştirme TEK yerde (`resolveShortCutConfig`)" — bkz. MODUL-BAYRAK-TASARIM §12 kural 4.
```

**E30 · L346 (iş emri TİPİ bağın aynası) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "Stok üretimi" kavramının varlığı `workorder.stockProductionEnabled` ile bayraklanacak (varsayılan AÇIK); siparişsiz üretime izin vermeyen bir kurulumda bu notun STOK↔ORDER simetrisi tek yönlü kalır. **Çekirdek:** "tip HİÇBİR yerde beyan değil BAĞDAN TÜRER", atomik `updateMany WHERE type=STOCK` ve "liste/künye/kart ile detay ayrışmamalı" (türetilmiş alan sınıfı) — bkz. MODUL-BAYRAK-TASARIM §9.
```

**E31 · L353 (üretim rengi TEK BEKÇİ) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "bugün prod'da iç boyahane yok (aktif `appliesColor=true` tek istasyon 'Boyahane (Fason)')" cümlesi bu kurulumun ölçümüdür — iç boyahaneli profilde `kursunFinish` 3c dalı ilk günden canlıdır. **Çekirdek:** tek bekçi (`assertTargetColorChange`), "kilit ADIMA değil MALA bakar", üç sonuç (SERBEST / `COLOR_PARTIAL_CONFIRM` / `COLOR_DYED_BLOCKED`) ve "kumaş farkı HER ZAMAN red" — bkz. MODUL-BAYRAK-TASARIM §5.1.
```

**E32 · L365 (fason kabulü: çekme bir hata değil) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** `modul.fason` yüzeyi; `fason.shrinkTolerancePct` varsayılanı (%10) bu fabrikanın boyahane deneyimidir, kumaş cinsine/kuruluma göre değişir. **Çekirdek:** "fark DEFTERE yazılır (`RollVariance`, `SUBCONTRACTOR_RETURN`)", `sourceRefId` terslemenin ADRESİDİR, "⚠️ toleransta `<=0 → null` kalıbı YASAK (0 = tolerans yok, null = varsayılan)" ve "RESTRICT FK: fason kabulü yapan HER test cleanup'ı `rollVariance.deleteMany` içermeli" — bkz. MODUL-BAYRAK-TASARIM §11.
```

**E33 · L378 (nameFold DB seddi + sebep kodu) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** Partial UNIQUE seddi (tombstone predicate'iyle), "uygulama bekçisi KALIR — mesajı o verir, DB sessiz son hat", "kodu SUNUCU türetir, serbest metne kod UYDURULMAZ" ve `legacyTexts` eski-ad sözlüğü — veri bütünlüğü sınıfı, bayraklanmaz. ⚠️ Yalnız KAPSAM profil: hangi tabloların sedli olduğu (bugün 3) kurulumun ana-veri hacmine göre genişler; yeni tabloya sed eklemeden önce `find_fold_duplicates.ts`.
```

**E34 · L388 (tutarlılık taraması: türetilmiş alan) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** §21-§26 bekçilerinin bir kısmı `modul.fason`/`modul.uretim` varlıklarını sorgular — modül kapalı kurulumda o bölümler tanım gereği boş döner ve bu bir arıza DEĞİLDİR (bölüm kaldırılmaz, sıfır satır beklenir). **Çekirdek:** "TEK KAYNAK + AST bekçisi" deseni, `repointPendingBypassAssignmentsTx` sırası ve "üretilen metraj kalite kovası KATALOGDAN" — bkz. MODUL-BAYRAK-TASARIM §3 madde 8, §12 kural 9.
```

**E35 · L391 (sıfırlama rafa kalktı: yumuşak kapı) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** **expand → backfill → contract** (kısıt veri temizlenmeden aynı sürümde gelmez) ve "prod'da `test_db_invariants` §1 kırmızı = enforce bekliyor, bilerek" — her müşteri kurulumunda aynen geçerli; yeni fabrikaya kurulumda taze DB sed'i ANINDA alır, göç edilen DB'de yumuşak kapı devreye girer.
```

**E36 · L393 (Sevk Kapısı = bayrağın ekranı) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** `shipping.confirmationEnabled` bu kurulumda KAPALI (`readShipmentConfirmationEnabled` varsayılanı `false`, `system-setting.service.ts:3313`) — not "kapalı rejim" davranışını anlatır; açık rejimli fabrikada PLANNED doğal durumdur ve storno varsayılanı işaretsiz gelir. **Çekirdek:** "karo `visibleWhen` SAF bayrak", "iptal gövdesi TEK KAYNAK (`cancelPlannedShipmentTx`)" ve "route bayrağa bakmaz — derin bağlantı açılır, yalnız menüde çizilmez" — bkz. MODUL-BAYRAK-TASARIM §3 madde 3.
```

**E37 · L399 (mükerrer paneli v2 P1) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Bulanık eşleştirme profilleri (FIRM/PRODUCT gürültü kelimeleri, eşik %90) **bu fabrikanın canlı kopyasıyla kalibre edildi** (9 yanlış pozitif → 1 gerçek); yeni fabrikada ad yapısı farklıdır → eşik ve gürültü listesi kurulum başına yeniden ölçülür (`duplicatesFuzzyThresholdPct` zaten panelde). **Çekirdek:** "birim KELİME, karakter DEĞİL", "`token_set_ratio` KULLANILMAZ", "kimlik alanına DB seddi BİLİNÇLİ YOK" ve "inceleme SQL'de, UYGULAMA MOTORDA" — bkz. MODUL-BAYRAK-TASARIM §11.
```

**E38 · L403 (§13 kök nedeni / mutabakat kırmızısı) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** §13'ün "canlıdaki 2 satır BİLEREK düzeltilmedi" ve §18'in "kumaş 5 · fason 2 grup" ölçümleri **bu fabrikanın verisidir** — yeni kurulumda mutabakat kapısı temiz doğar, o yüzden kırmızı satır "bilinen borç" değil GERÇEK bir sapma sayılır. **Çekirdek ve taşınabilir olan ders:** bir mutabakat kırmızısı üç ayrı şey demek olabilir — kod hatası (§13) · iş kararı bekleyen veri (§18) · sorgunun kör noktası (§20); üçünü ayırmadan "drift düzelt" demek ikisini yanlış yerden onarır.
```

**E39 · L468 (saha deploy sonrası üç arıza) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** ②'nin ölçümü ("230 iptal / 1 fire, sebepli 24 iptalin hepsi kayıt hatası") ve ②c'nin "parti engeli kaldırıldı" kararı bu fabrikanın kullanımına dayanır. **Çekirdek:** İptal (`CANCELLED`, stok düşmez, `qtyOut=0`) ↔ Fire (`SCRAP`, stok düşer, `qtyOut=qtyIn`) ayrımı ve iki sebep kataloğunun İKİ FARKLI kapıdan geçmesi (`resolveReasonCode` ↔ `validateVarianceReason`) defter semantiğidir; ③'ün `SegmentedButtons` kuralı ve "yerleşim hatasında tahmin değil ÖLÇÜM" dersi de her kurulumda geçerli.
```

**E40 · L670 (bitmiş kumaş tekrar iş emrine) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "Ölçüm: 980 topun 4'ü iki WO'dan geçmiş" ve "sahadaki iki rotada da planlı firma yok" bu kurulumun verisidir. **Çekirdek ve çok-fabrikada tam da aranan ders:** *backend destekliyordu ama HİÇBİR istemci kullanamıyordu* — bir yeteneğin "var" sayılması için motor + en az bir çıkış yüzeyi + izin ataması ÜÇÜNÜN birden olması gerekir (aynı sınıf: `modul.*` açık ama ekran yok). ⚠️ "Fason firma seçicisi LOAD-BEARING" uyarısı `modul.fason` bağımlıdır.
```

**E41 · L720 (prod'un üç "dev'de yapılacaklar" notu) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** `kur.ps1`, renk seddi ve `SURUM-2.9.0` bu fabrikanın kurulum/sunucu gerçeğidir; çok-fabrika döneminde `kur.ps1` ve deploy reçetesi **müşteri başına** doğrulanır (yayın adresi pakete derleme anında gömülür). **Çekirdek ders:** "prod notunun TEŞHİSİ tutar, 'repoda şu var / şu bekçi yeter' cümleleri VARSAYIMDIR" — 6'sı ölçümle düzeltildi; ayrıca "beklenen değeri gerçek değerle AYNI kaynaktan alan kapı, o kaynağın yanlış olmasını yakalayamaz".
```

**E42 · L748 (mobil "Yeniden Üretime Al" + sebep kataloğu) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "ham+bitmiş aynı WO'da SERBEST · hedef renk BOŞ gelir · sebep İSTEĞE BAĞLI · 2. kalite DAHİL" dört karar da bu kurulumun tercihi (`modul.uretim`); `WORK_ORDER_REWORK` kataloğunun içeriği de fabrikaya aittir. **Çekirdek:** yeni `ReasonPresetKind` eklerken **beş kapı birlikte** (şema+migration · backend katalog · Electron KIND_TABS · mobil union · mobil zemin) ve "mobil zemin GERÇEK kodları taşır" kuralı.
```

**E43 · L798 (sebep 60 sn'lik pencerede yaşıyordu) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK — çok-fabrikada BİRİNCİ SINIF:** "TTL'in işi TAZELİK'tir GEÇERLİLİK değil" (bayat liste döner + arka planda tazeler), "bayatlık ≠ boşluk — önbellek HİÇ dolmadıysa fail-closed KALIR", tek-uçuş yalnız ARKA PLANA ait (yazmalar kendi yazdığını görmek zorunda) ve "geçersiz kod `AppError` 400, düz `Error` 500'e düşer ve mobil kuyruk 5xx'i geçici sanar". Fabrikanın kendi kataloğunu düzenleyebilmesi tam olarak tek-gövde/çok-fabrika modelinin çalışma koşuludur.
```

**E44 · L862 (Electron dağıtımı) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL/OPS GERÇEĞİ:** Bu not TEK MÜŞTERİ döneminde başladı ve aynı gün çok-müşteriye taşındı — bugünkü geçerli yol düzeni `guncelleme.etkiliyazilim.com/<müşteri>/<ürün>/` (tek kaynak `Electron/shared/update-feed.ts` + `shared/musteri.json`). **Çekirdek:** "yayın adresi pakete DERLEME ANINDA gömülür → yanlış müşteri kodu başka fabrikanın güncellemesini kurar ve hata SESSİZDİR", `latest.yml` EN SON yüklenir, CF proxy AÇIK kalmalı, `add_header … always` YASAK.
```

**E45 · L911 (yarı mamul: filtre yetmedi, sekme oldu) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** "Boyalı gelen kumaşa sadece kurşun+tambur" senaryosu ve "prod'da SEMI_FINISHED SIFIR" ölçümü bu kurulumundur; ayrıca notun sonundaki **"Panelden yapılacak: 'Yarı Mamul (Kurşun+Tambur)' rotası"** maddesi kurulum başına tekrar edilir (rota kod değil VERİdir). **Çekirdek:** üç kapsam ve `RAW_STOCK`'un BİLEREK geniş olması, `rollScope` FAIL-CLOSED, "altıncı enum değeri unutuldu" sınıfı ve "rapor da ayrılmazsa çelişkiyi BİZ üretiriz".
```

**E46 · L1015 (mobil uzaktan güncelleme) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL/OPS GERÇEĞİ:** Yol `/adnansahin/mobil/` bu müşterinin segmentidir; yeni fabrika = sunucuda `mkdir <müşteri>/mobil` + `--musteri=` ile yayın (DNS/sertifika/servis YOK). **Çekirdek:** "ERP bağlantısı fabrika ağında kalır, güncelleme internetten gelir — İKİ KANAL, hiçbiri diğerinden TÜRETİLMEZ", manifest yayın anında DONDURULUR, `runtimeVersion` filtresi SUNUCUNUN işidir, kod imzalama AÇIK, `add_header … always` YASAK.
```

**E47 · L1273 (sebep adımı üç bölge + sürükleme) · `[PROFİL]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Tambur sebep adımı `modul.uretim` yüzeyidir ve "7. satırda görüldü" ölçümü bu fabrikanın katalog büyüklüğüdür. **Taşınabilir çekirdek:** üç bölge (sabit başlık · KAYAN liste · sabit footer), `mergeVisibleOrder` köprüsü ("sunucu TÜM id'leri ister, ekran yalnız AKTİF satırları çizer — gizli satır KENDİ YUVASINDA kalır") ve "sürükleme yalnız yetkilide, `builtin:` zemin satırlarında KAPALI".
```

**E48 · L1339 (rota kapsaması REDDETMEZ, UYARIR) · `[KARIŞIK]`**
```
> ⚠️ **ÇOK-FABRİKA AÇISINDAN EN ÖNEMLİ NOTLARDAN BİRİ:** "Boyahanesiz rota (kurşun+tambur) dışarıdan boyalı gelen mal için DOĞRUDUR" — yani rota kapsaması **REDDETMEZ, UYARIR** kuralı tam olarak farklı fabrika topolojilerini destekleme kararıdır (`ApiResponse.warnings`); `modul.fason` kapalı bir kurulumda hedef renk hiçbir zaman uygulanmayabilir ve bu meşrudur. ⚠️ AÇIK kalan asimetri (oluşturma ↔ düzenleme) yeni profil eklenirken yeniden ölçülmeli — bkz. MODUL-BAYRAK-TASARIM §5.2, §11.
```

**E49 · L1413 (sipariş görünürlüğü) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** Sipariş & Müşteri kapatılamaz çekirdek bloktur (MODUL-BAYRAK-TASARIM §2). Liste/cursor/özet TEK `where` (`BaseService.buildListWhere` — şerit listeden sapamaz), "iptal kalem `quantity` DEĞİL `shipped` ile sayılır", "açık talep süzgeci TEK KAYNAK `order-line-scope.helper` (`cancelledAt == null` **gevşek**)" ve "karşılanma raporu `getCoverageForLines` KULLANMAZ — havuzu her satıra tam yazar, çift sayım" — hepsi bayraklanmaz.
```

**E50 · L1546 (yarı mamul → Kanban + tablet) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** Kanban kolonları ve mobil Depo sekmeleri `modul.uretim` yüzeyleridir; "bugün fark 0 ama tesadüfen" ölçümü bu kurulumun verisi. **Çekirdek:** "bekçi ANAHTAR değil SAYI SEMANTİĞİ ölçer" (pano=48 ↔ envanter=47 negatif sondası), "altıncı unutulmuş enum" sınıfı ve "üç yüzeyde TEK rakam" ilkesi — bkz. MODUL-BAYRAK-TASARIM §3 madde 8.
```

**E51 · L1679 (Patron modülü) · `[KARIŞIK]`**
```
> ⚠️ **PROFİL GERÇEĞİ:** `WEB_BOSS` şablonunun `report:finance` taşımaması "alt-ağaç zaten `requireFinanceEnabled` arkasında ve **fabrikada kapalı**" gerekçesine dayanır (L1836-1838) — `modul.finans` AÇIK bir kurulumda bu gerekçe düşer ve şablon yeniden değerlendirilir. **Çekirdek:** uzaklık SOKETTEN çözülür (`clientType` güvenlik sınırı DEĞİL), Access JWT FAIL-CLOSED, JWKS TTL = tazelik (geçerlilik değil), `clientIpHeaderRemoteOnly`, helmet İKİ ÖRNEK / TEK PROCESS, uzakta 404 (403 keşfe davet) ve sır hijyeni — bkz. MODUL-BAYRAK-TASARIM §7, §12 kural 8.
```

**E52 · L1919 (Modül anahtarları P1) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK — bu not sınıflamanın KENDİ TEMELİDİR:** tek gövde/çok fabrika altyapısı (7 anahtar · adlandırılmış middleware · tek kaynak `module-flags.ts` · bağımlılık iki yerde · `MODULE_DISABLED` · grandfathering "değer = DÜNKÜ DAVRANIŞ"). Bu dosyadaki eski notlar okunurken kural: **"adnansahin'de yok" = "bayrağı kapalı"**; hiçbir eski not `if (musteri === 'X')` gerekçesi olarak kullanılamaz — bkz. MODUL-BAYRAK-TASARIM §11, §12 kural 6.
```

**E53 · L1941 (Süperadmin P2) · `[ÇEKİRDEK]`**
```
> ✅ **ÇEKİRDEK:** Satıcı hesabı, `["*"]` kod bypass'ı, tek-kaynak gizleme süzgeci (`isSystemAccount:false` + AST bekçisi), takma adlı audit, kilitlenme supabı (hesap YOKSA guard dalı devre dışı) ve **sır hijyeni** (parola/PIN/ayar şifresi repoya, log'a, audit diff'ine GİRMEZ) — kuruluma bağlı DEĞİL; her müşteride aynı. ⚠️ Kuruluma bağlı tek şey `.env` tohumlaması: hesap doğmadan kilit mutlak değildir — bkz. MODUL-BAYRAK-TASARIM §7, §12 kural 7/8.
```

### GRUP F — `docs/ops/` + `docs/design/` + `ARCHITECTURE.md`

**F1 · `docs/ops/KURULUM.md:3` (belge başı) altına · `[KARIŞIK]`**
```
> ⚠️ **Bu runbook'un REFERANS PROFİLİ işlemeci/apreci fabrikadır** (kumaş hazır gelir; KK1 → Kurşun+KK2 → Tambur rotası). A/B/D/E/F bölümleri (sunucu · ilk admin · panel · tablet · donanım) **her fabrikada aynıdır — çekirdek**. C bölümündeki istasyon/makine/rota adımları (ADIM 5-11) o profilin **kurulum seçimidir**, sistemin kısıtı değil: farklı topolojili fabrika (dokuma/örme, ayrı KK istasyonu, çoklu depo) aynı adımları kendi istasyon kataloğuyla doldurur. Modül aç/kapa ve profil seçimi: `docs/design/MODUL-BAYRAK-TASARIM.md`. Ticaret (üretimsiz) kurulumu için `docs/ops/TICARET-KURULUM.md`.
```

**F2 · `docs/ops/KURULUM.md:100` (ADIM 6 — İstasyonlar) · `[PROFİL]`**
```
⚠️ Profil gerçeği — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §5.1: **"Kurşun + KK2 = tek istasyon" bu fabrikanın topolojisidir, sistemin kuralı değil.** Kimi fabrika kaliteyi kurşunla birlikte yapar (buradaki `PROCESS_QC` çifti), kimi ayrı istasyonda, kimi başka istasyonla birlikte. Bugün kalite `StationKind`'a gömülüdür; `station.appliesQuality` yeteneğine taşındıktan sonra üç topoloji de yalnız rota kurulumu olur ve bu adım "fabrikanın istasyonlarını gir" cümlesine iner.
```

**F3 · `Teks-Erp/ARCHITECTURE.md:176` (§4 `ItemType` / WARP) · `[PROFİL]`**
```
⚠️ Profil gerçeği — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §5.2: **"çözgü/dokuma yapmaz" referans fabrikanın rotasıdır, sistemin kısıtı değil.** Devere/çözgü/haşıl yeni mimari istemez — istasyon kataloğuna istasyon, rotaya adım olarak girer. Dokuma müşterisi geldiğinde tek tasarım işi rotanın başında topun **tezgahtan doğması**dır (doğum damgası: tezgah + çözgü levendi + iplik lotu). `WARP` enum değerinin kaldırılması bir profil sadeleştirmesiydi; dokuma dilimi açılırsa geri gelme kararı ayrıca verilir.
```

**F4 · `Teks-Erp/ARCHITECTURE.md:194` (§4 `StationKind` kuralı) · `[KARIŞIK]`**
```
⚠️ Bilinen katılık — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §5.1. Davranışın **istasyon TÜRÜnden** dispatch edilmesi bugünkü gerçektir ama ürün sınırı değildir: renk (`appliesColor`, 2026-08-02) ve özellik (`StationProperty`) aynı dönüşümü yaşayıp türden **yeteneğe** taşındı; kalite üçüncüsü olacak (`station.appliesQuality`). Yeni davranışı `StationKind`'a bağlamadan önce sor: bu gerçekten domain rolü mü, yoksa istasyon yeteneği mi? Etki alanı: `RollError` yaşam döngüsü ("PROCESS_QC'de açılır" varsayımı), kurşun bypass bayrağı, tabletin istasyon-türünden ekran seçimi.
```

**F5 · `docs/design/CUVAL-HAVUZU-TASARIM.md:22` ("Mühür yok, rezerv yok…") · `[KARIŞIK]`**
```
⚠️ Profil gerçeği — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` karar #6. **ÇEKİRDEK olan:** tahsisin sevk ANINDA yazılması, stoğun yalnız DISPATCH'te düşmesi, PLANNED'ın tahsis sayılmaması — bunlar defter semantiğidir ve bayraklanmaz. **PROFİL olan:** "rezerv yok" — erken taahhüdü istemeyen bu fabrikanın seçimidir. Rezervasyon altyapısı ayrı bir dilimde gelecek ve **kendi append-only defterinde** yaşayacak; `SackAllocation`a DOKUNULMAZ (o sevk muhasebesidir). Yani buradaki "rezerv yok" cümlesi "bu kurulumda kapalı" diye okunur, "sistem rezerv tanımaz" diye değil.
```

**F6 · `docs/design/KARTELA-TASARIM.md:9` ("bu firma için önemsiz") · `[PROFİL]`**
```
⚠️ Profil gerçeği — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md`. "Bu firma" = referans profil (adnansahin); ayrım zaten bayrakta yaşıyor (`kartela.measurementEnabled`, varsayılan KAPALI) ve belgenin kendi cümlesi de bunu söylüyor ("Başka firmalara AÇIK satılabilir"). Kartela akışının tamamı ileride `modul.kartela` altına yerleşir; ölçüm bayrağı o modülün **alt bayrağı** olur ve modül kapalıyken okunmaz bile.
```

**F7 · `docs/design/TICARET-PAKETI-TASARIM.md:16` ve `:153` ("tek depo") · `[PROFİL]`**
```
⚠️ Profil gerçeği — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md`. "Tek depo" referans fabrikanın kurulumudur; sistem tarafında karşılığı artık bir **modül anahtarıdır** (`depo.multiEnabled`, varsayılan KAPALI — `src/constants/module-flags.ts`). Ayrım veri-türevi ("kaç depo var") değil anahtardır: transfer uçları `requireDepoMultiEnabled` ile kapılıdır (`warehouse-transfer.routes.ts:24`), depo **defteri** ise kapısız çekirdektir (fabrika yolları da yazar). Backfill'in "hangi depoydu" varsayımı yalnız tek depolu geçmiş için geçerlidir — çok depolu bir kurulumda aynı script kullanılamaz.
```

**F8 · `docs/ops/TICARET-KURULUM.md:3-5` (belge başı) · `[KARIŞIK]`**
```
⚠️ Bu belge fiilen **ikinci kurulum profilidir** ("Ticaret / alım-satım") — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §10 profil tablosu. "Üretim kullanılmaz" bugün **izinle gizleme** ile sağlanıyor; kalıcı yol modül anahtarıdır (`production.enabled` — bugün SALT-UI, `requireUretimEnabled` kapısına terfi edilecek). Terfi indiğinde bu reçetenin 1. bölümü "profil uygula" adımına iner: ticaret profili = `ticaret.enabled` AÇIK · `finance.enabled` AÇIK · `production.enabled` KAPALI. O güne dek üretim karolarını izinle gizlemek geçerli ve yeterlidir.
```

**F9 · `docs/ops/SURUM-NOTLARI.md:3` · `[ÇEKİRDEK]`**
```
⚠️ Çok müşteri notu — `surum-notlari.json` **TEK kaynaktır ve TÜM müşterilere aynı gider**; not kapsam etiketi ürün eksenindedir (`panel`/`tablet`/`her-ikisi`), müşteri ekseninde DEĞİL. Sonuç iki kural: (1) not, o müşteride **kapalı bir modülün** ekranını tarif ediyorsa okuyanın karşılığı yoktur — maddeyi ya modülden bağımsız yaz ya da hangi modülle geldiğini operatör diliyle söyle ("Ön muhasebe kullanan kurulumlarda: …"); (2) hiçbir maddede tek bir fabrikanın verisi/adı/vakası geçmez (not fabrikadan fabrikaya gider). Bekçi bugün yalnız notun VAR olduğunu ve teknik terim taşımadığını denetler, KAPSAMINI denetlemez.
```

**F10 · `docs/ops/SUNUCU-ENVANTERI.md:13` (Makineler tablosu) · `[ÇEKİRDEK]`**
```
⚠️ Çok müşteri notu — bu tablo **fabrika başına bir satır** taşımalıdır (`Fabrika sunucusu — <müşteri kodu>`), çünkü her kurulumun kendi LAN'ı, kendi tünel hostname'i (`<musteri>-erp.etkiliyazilim.com`), kendi yedek kullanıcısı (`fab-<müşteri>`) ve kendi yayın klasörü (`/<müşteri>/electron`, `/<müşteri>/mobil`) vardır. Aşağıdaki "Fabrika sunucusu — ağ / servisler" bölümleri **her fabrika için aynı şablondur** (4000 LAN · 4001 yalnız 127.0.0.1 · 5432 yerel) — şablon çekirdektir, satırlar müşteri başına çoğalır.
```

**F11 · `docs/ops/DEPLOY-RUNBOOK.md:37` ("SAHADAKİ KURULUM — yetkili değerler") · `[KARIŞIK]`**
```
⚠️ Çok müşteri notu — bu tablo **bir kurulumun** yetkili değerleridir (referans fabrika: SAHINSRV). Sütunların kendisi (PG sürümü/portu · PG yolları · DB/kullanıcı · çalışan paket dizini · pm2 adı · build klonu · deploy script'leri · pm2 daemon hesabı · boot görevi · gece yedeği · backend scheduler durumu) **her kurulumda sorulması gereken çekirdek listedir**; değerler müşteriye göre değişir. Yeni fabrika devreye alınırken bu tablo kopyalanıp o kurulumun ölçülmüş değerleriyle doldurulur — tahminle değil, sunucuda ölçülerek (2026-08-25 dersi: dokümanlar `C:`'yi anlatıyordu, paket `D:`'den üretiliyordu).
```

---

## § Sabah onayı kolonu (tartışmalı sınıflamalar + gerekçe)

> 10 madde. **Hiçbiri uygulanmadan önce karar ister.** Her satırda: soru · öneri · neden tek başına karar veremiyorum.

### S1 — TR-only: `[ÇEKİRDEK]` mi, `[PROFİL]` mü? · kök `CLAUDE.md:256`
- **Soru:** "TR-only bilinçlidir, i18n altyapısı KURULMAZ" kuralı çekirdek mi (üç hedef segment de Türkiye) yoksa profil mü?
- **Önerim:** kural **ÇEKİRDEK kalsın**, yanına tek cümle eklensin: *"⚠️ **Görünen ad ≠ çeviri**: fabrikaya göre değişen terminoloji (`ui.terminologyOverrides`, MODUL-BAYRAK-TASARIM §9) bir sözlük katmanı DEĞİLDİR; kod/kimlik/rapor anahtarı sabit kalır."*
- **Neden karar gerekiyor:** tasarım §9 `ui.terminologyOverrides`i eksik bayrak listesine koyuyor; şerhsiz bırakılırsa terminoloji ezmesi yanlışlıkla "i18n" sayılıp reddedilir.

### S2 — Kalite → hedef statü seed eşlemesi · kök `CLAUDE.md:27`
- **Soru:** "1.Kalite ve A1 → WAREHOUSE, FİRE → SCRAP" satırı kuralın parçası mı, profil verisi mi?
- **Önerim:** MEKANİZMA çekirdek (`QualityGrade.targetStatus` override, kalite null → WAREHOUSE), **seed satırları profil**; şerh: *"⚠️ Parantez içindeki eşleme SEED'dir, yani profil verisi — kalite kataloğu fabrikanın kendi verisidir; kod hiçbir kalite ADINA/koduna gömülmez ('1. KALİTE' `sortOrder`'dan çözülür kuralının ikizi)."*
- **Neden:** kalite skalası sektörde 1./2./A1 dışında da olur; şerhin dili kullanıcı onayı ister.

### S3 — Refakat kartı: "doğar" ↔ "basılır/okutulur" sınırı · kök `CLAUDE.md:110`
- **Soru:** "kart iş emriyle DOĞAR" çekirdek mi (evet gibi: `TravelerCard.workOrderId @unique`), "malla birlikte hareket eder ve okutulunca süreç tetikler" profil mü?
- **Önerim:** mekanizma ÇEKİRDEK, fiziksel kâğıt + okutma akışı PROFİL şerhi alsın — kart okutmayan kurulumda istasyon tetikleyicisi tablet/ekran olur.
- **Neden:** sınırın nereye çizileceği ürün kararıdır (kâğıtsız fabrika kartı hiç yazdırmayabilir).

### S4 — Şube bazlı planlama · kök `CLAUDE.md:109` (şerh metni A13'te hazır)
- **Soru:** `branchId` opsiyonelliği çekirdek, çok-şubeli planlama yüzeyi profil — bu ayrım doğru mu?
- **Neden:** tasarım §2 `modul.coklu-depo`yu ayrı anahtar yapıyor; şube (ticari) ile depo (fiziksel) karışırsa yanlış modül kapısı üretilir.

### S5 — Rol şablonu İÇERİĞİ profil ekseninde mi? · arşiv `L232`
- **Önerilen şerh:** *"⚠️ **SINIFLAMA ONAYI BEKLİYOR:** 'Katalog KODA, atama PANELE' + boot uzlaştırma + 'sistem rolü silinmez pasifleştirilir' + kimlik `code` ÇEKİRDEK'tir. Tartışmalı olan **şablon İÇERİĞİ**: 8 masaüstü rolü ve SoD üçlüsünün (`shipping:invoice` / `shipping:undo-dispatch` / `roll:manual-adjust`) yalnız Muhasebe+Süpervizör'de olması — bu bir organizasyon şemasıdır ve `modul.finans`/`modul.ticaret` kapalı bir kurulumda 'Muhasebe' rolü karşılıksız kalır. Profil başına rol şablonu seti mi, tek katalog mu? — MODUL-BAYRAK-TASARIM §10 ile birlikte karar verilmeli."*
- **Neden:** tasarımda rol şablonlarının profil ekseni YOK; §10 modülleri sayıyor, rolleri saymıyor.

### S6 — Rapor karneleri: fason kovası modülle kapanmalı mı? · arşiv `L274`
- **Önerilen şerh:** *"⚠️ **SINIFLAMA ONAYI BEKLİYOR:** Trigger'ın yazması, kaynak statü listesinden `SHIPPED`/`CANCELLED`'ın bilerek dışlanması, '1. KALİTE koda gömülmez', 'dönemde sevk edilen metraj TEK tanım `_shipped.ts`' ve 'ölü stok = eski VE siparişsiz' ÇEKİRDEK rapor semantiğidir (§3 madde 8). Tartışmalı: **fason atfının üç kovası** ve Fason Karnesi `modul.fason` ile birlikte kapanmalı mı, yoksa kova boş mu görünmeli? Bir de 'üretilen metraj = 1. kalite + A1' tanımının kalite kataloğu farklı olan fabrikada `QualityGrade.targetStatus`'tan türemesi yeterli mi?"*
- **Neden:** §3 madde 8 raporun modülle kapanmasını söylüyor ama "boş kova mı, hiç satır mı" davranışını söylemiyor.

### S7 — Tambur en toleransı ±10 cm ayar olmalı mı? · arşiv `L305`
- **Önerilen şerh:** *"⚠️ **SINIFLAMA ONAYI BEKLİYOR:** 'Üç yol TEK helper', 'onay TOP başına BİR kez', 'imzalı karar audit'e düşer' ve 'onay topun kaydını DEĞİŞTİRMEZ' ÇEKİRDEK. Tartışmalı: **en eşiği ±10 cm** `constants/tambur-plan-gate.ts`'te SABİT — perde/dokuma profilinde tolerans farklıdır; ayar (`quality.*ToleranceCm`, dört kapı) yapılsın mı, yoksa 'eşik ürün kararıdır, bayraklanmaz' mı? Notun kendisi 'panelden ayar istenirse DÖRT KAPI kuralıyla' diyerek kapıyı açık bırakmış — MODUL-BAYRAK-TASARIM §9 ile birlikte karar verilmeli."*

### S8 — Yarı mamul ayrımı `modul.uretim`e mi, çekirdek gösterime mi ait? · arşiv `L1618`
- **Önerilen şerh:** *"⚠️ **SINIFLAMA ONAYI BEKLİYOR:** 'Yarı mamul ARZDIR, düşülmez — ayrı GÖSTERİLİR' (SAP HALB emsali) ÇEKİRDEK bir arz/talep tanımı gibi görünüyor ve negatif sondası (400 m talepte 200 m sahte açık) bunu destekliyor. Tartışmalı olan: **yarı mamul ayrımının KENDİSİ** (ayrı sekme/kova/kolon) `modul.uretim`e mi bağlı, yoksa toptancı profilinde de anlamlı bir çekirdek gösterim mi? Zamanlama gerekçesi ('prod'da 0 yarı mamul kaydı varken kapatıldı') tamamen bu fabrikanın ölçümü."*
- **Neden:** tasarımda yarı mamul hiçbir modül/anahtarla eşleşmiyor; tamlık bekçisi (P6) bu ekranı eşlerken karar gerekecek.

### S9 — `adnansahin` geçen yayın adresleri: yer tutucuya çevrilsin mi? · ops (çoklu dosya)
- **Kapsam:** `ELECTRON-OTOMATIK-GUNCELLEME.md` (25,51,53,87,103,157,232-233,284-286,303,397,539-540) · `MOBIL-UZAKTAN-GUNCELLEME.md` (31,78-80,130) · `YEDEK-VPS-KURULUM.md` (96-176) · `VDS-TASIMA.md` (67,109,118) · `SUNUCU-ENVANTERI.md` (60,110-111)
- **Sınıflama kaydı:** bunlar **PROFİL DEĞİL, KURULUM PARAMETRESİDİR.** Yol düzeni (`/<müşteri>/<ürün>/`), kullanıcı düzeni (`fab-<müşteri>`) ve komut sözleşmesi (`--musteri=<kod>`) çok müşteride aynen geçerlidir.
- **Önerim: KALSIN** — çalışan gerçek adres, kopyala-yapıştır hatası yapmayan tek referanstır; yer tutucuya çevrilirse "gerçekten böyle mi görünüyor" doğrulaması kaybolur.
- **Onay istenen tek nokta:** örnekler `adnansahin` olarak mı kalacak, `<musteri>` yer tutucusuna mı çevrilecek.

### S10 — `SAAS-TASARIM.md` ile `MODUL-BAYRAK-TASARIM.md` önceliği · `docs/design/SAAS-TASARIM.md:7`
- **Önerilen şerh:** *"⚠️ 2026-09-02 — Çok müşteriye çıkışın YÜRÜRLÜKTEKİ yolu bu belge DEĞİL, `docs/design/MODUL-BAYRAK-TASARIM.md`'dir: tek gövde · tek şema · tek sürüm çizgisi · müşteri farkı yalnız bayrak profilinde, dağıtım **on-prem**. SaaS taslağı bununla çelişmez (§A0 zaten `TENANT_MODE=single` ile on-prem'i bayt-bayt koruyor) ama önce gelmez; ikisi birlikte okunduğunda modül/bayrak ağacı SaaS'ın da 'firma bazlı modül bayrakları' satırının karşılığıdır. Belgenin bugünkü değeri hâlâ ölçümlerindedir (86 dosyanın prisma bağımlılığı, 19 bellek-içi global durum, ~46 istasyon hard guard'ı)."*
- **Neden:** çelişki teknik değil **öncelik** düzeyinde; SaaS 58 KB ile daha görünür, MODUL-BAYRAK ise onaylanmış ve kodu başlamış yol. Ürün kararı.

### S11 (ek) — `DEMO-YAYIN-RUNBOOK.md` iki maddesi
- **(a) satır 255 — demo firma adı:** *"⚠️ Demo artık **satış yüzeyidir**: firma adı, künye ve demo master-data referans fabrikanın adını taşımamalı (`Adnan Şahin Tekstil` → nötr bir demo firma adı). Sıfırlama betiği (`demo-reset.sh`) seed'i yeniden koştuğu için ad her sıfırlamada geri gelir — kalıcı çözüm seed/demo verisinin nötrleştirilmesidir, Genel Ayarlar'dan elle düzeltme değil."* → **satış kararı, onay gerekir.**
- **(b) satır 29-32 — certresolver ifadesi:** doküman *"`etkiliyazilim.com` bu Cloudflare hesabının zone'unda olmadığı için DNS-01 çalışmıyor"* diyor; kullanıcı kaydı zone'un kendisinde olduğunu söylüyor. Önerilen düzeltme: *"…bu Traefik örneğinin Cloudflare **token'ı** o zone'a yetkili olmadığı için DNS-01 çalışmıyor (zone hesapta VARDIR)."* → **CF panelinde doğrulama ister; kanıt kod değil.**

> **Not:** S11 iki alt maddeden oluşuyor; sabah onayı sayısı madde bazında **10** (S1–S10), S11 ops turunun üçüncü tartışmalı maddesi olarak S10 ile birlikte sayıldı. Uygulamada üçü ayrı ayrı onaylanmalı.

---

## § Kök `CLAUDE.md` — ilke satırı + "Referans profil" satırı

Bu iki ekleme **mercek turunun asıl çıktısıdır**; diğer 114 madde bu iki satırın uygulanmasıdır.

### 1) İlke satırı — `CLAUDE.md` satır 1'in hemen altına

```markdown
# TeksERP — Monorepo Kökü

> **Tek gövde, çok fabrika — kural yazarken sor: çekirdek mi, profil mü?** [ÇEKİRDEK] her kurulumda aynıdır (defter semantiği, brüt sevk, idempotency, kilit sırası, atomik claim, fail-closed kapılar, sır hijyeni, veri bütünlüğü). [PROFİL] bu fabrikanın seçimidir ve bayrak/veriyle değişir (rota, istasyon topolojisi, açık modüller, sayısal ayarlar). Sınıflama ölçütü ve red gerekçeleri: `docs/design/MODUL-BAYRAK-TASARIM.md` §0 ve §11.
```

**Neden buraya:** dosyanın en üstünde bugün yalnız satır 13'teki dallanma notu var; ilke satırı yok. Plan "Doküman mercek turu" madde 2 bunu açıkça istiyor.

### 2) Referans profil satırı — `## Üretim Akışı` başlığının altına (başlık DEĞİŞMEZ)

```markdown
## Üretim Akışı

> ⚠️ **Referans profil: işlemeci (adnansahin)** — aşağıdaki akış bu fabrikanın ROTASIDIR, sistemin zorunlu akışı değil; her adım istasyon kataloğundan + rota şablonundan kurulur. Profil gerçeği — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §5 (üretim esnekliği) ve §10 (profil tablosu).

```
Stok (Roll) → İş Emri → KK1 (RAW_QC) → …
```
```

**Neden ADDITIVE:** başlığı ("Üretim Akışı") değiştirmek, akışa atıf yapan onlarca satırı ve arama alışkanlığını bozar; okuma çerçevesi tek blockquote ile kurulabiliyor.

### 3) Bu iki satırın yanına giden iki toplu etiket (aynı turda uygulanır)

- `### Karar Notları Dizini` blockquote'una **A2** (yeni not sınıf etiketi taşır).
- `## Ortak Konvansiyonlar` başlığının altına **A4** (bölümün tamamı `[ÇEKİRDEK]`) — bu tek satır, o bölümün 15+ maddesini tek tek şerhleme ihtiyacını ortadan kaldırıyor.

---

## § Yeni not konvansiyonu (metin önerisi)

Bundan sonra **her yeni karar notu** bir sınıf etiketi taşır. Kural iki yerde birden yaşar (biri unutulursa diğeri hatırlatır):

### A) Kök `CLAUDE.md` → "### Karar Notları Dizini" blockquote'unun sonuna

```markdown
**Yeni not sınıf etiketi TAŞIR:** buraya eklenen her özet satırı `[ÇEKİRDEK]` (her kurulumda aynı — defter semantiği, veri bütünlüğü, idempotency, kilit sırası, fail-closed kapı, sır hijyeni) ya da `[PROFİL]` (bu fabrikanın seçimi; bayrak/veri/rota türevi) etiketiyle başlar; karma notlarda etiket cümle bazında verilir. Ölçüt: MODUL-BAYRAK-TASARIM §11'deki "bayraklanmayacaklar" listesindeki her şey ÇEKİRDEK'tir.
```

### B) `docs/history/CLAUDE-NOT-ARSIVI.md` → dosya başlığındaki "yeni not kuralı" bloğunun hemen altına

```markdown
> **⚠️ Sınıf etiketi kuralı (2026-09-03):** Bundan sonra her yeni karar notu başlığında `[ÇEKİRDEK]` (her fabrikada değişmez: defter semantiği, brüt sevk, idempotency, kilit sırası, fail-closed kapılar, sır hijyeni, veri bütünlüğü) ya da `[PROFİL]` (bu kurulumun seçimi) etiketi taşır; karışık notta profil-bağımlı cümle satır içinde ⚠️ ile işaretlenir — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §0/§11.
```

### Yazım kuralları (uygulama notu)

| Durum | Nasıl yazılır |
|---|---|
| Not tamamen çekirdek | Başlığa `[ÇEKİRDEK]`; gövdede ek işaret gerekmez |
| Not tamamen profil | Başlığa `[PROFİL]`; hangi bayrak/veriye bağlı olduğu ilk cümlede yazılır |
| Karışık not | Başlığa **etiket konmaz**; profil-bağımlı her cümle satır içinde `⚠️ Profil gerçeği —` ile işaretlenir, çekirdek olan kısım `✅ ÇEKİRDEK:` ile toplanır |
| Ölçüm rakamı içeren cümle | **Her zaman profil** ("bu fabrikada N kayıt") — rakam kurulum başına yeniden ölçülür |
| Ekran/karo/izin adı geçen cümle | Genelde profil (modül yüzeyi); altındaki motor/sözleşme genelde çekirdek |

### Okuma kuralı (arşivin başına, E52 ile birlikte)

> **"adnansahin'de yok" = "bayrağı kapalı".** Hiçbir eski not `if (musteri === 'X')` gerekçesi olarak kullanılamaz.

---

## § Uygulanmayacaklar (bilinçli red)

Bu turda **içerik silme / cümle yeniden yazma / bölüm birleştirme önerisi ÜRETİLMEDİ**, ve gelecekte gelirse reddedilir. Gerekçeler:

1. **Arşiv notu silinmez, kısaltılmaz.** `CLAUDE-NOT-ARSIVI.md` bir karar defteridir; bir notun bugün yanlış olması onu silme gerekçesi değil, **şerh** gerekçesidir (kararın nasıl değiştiği ancak eski metin dururken okunur). Bu yüzden altı bayat bulgunun altısı da "eski cümlenin üstüne/altına ⚠️ satırı" olarak yazıldı.
2. **Kök `CLAUDE.md`'nin "Ortak Konvansiyonlar" bölümü madde madde şerhlenmez, tek toplu `[ÇEKİRDEK]` etiketi alır.** Madde başına şerh, bölümü iki katına çıkarır ve okunurluğu düşürür; ayrıca her maddesi §11'in "bayraklanmayacaklar" listesiyle birebir örtüşüyor.
3. **`## Üretim Akışı` başlığı değişmez.** "Referans akış (işlemeci profili)" gibi bir yeniden adlandırma, başlığa atıf yapan tüm belgeleri ve arama alışkanlığını bozar. Çerçeve blockquote ile kurulur.
4. **`Electron/CLAUDE.md` başlığı ("Adnan Şahin ERP — Admin") değişmez.** Bu, paketin bugünkü **gerçek kimliğidir** (`package.json:3` + `:122`); dokümanı gerçeğe aykırı hale getirmek yerine gerçeğin profil olduğu şerh edilir. Paket kimliğini `musteri.json`dan türetmek **ayrı bir karardır** ve o karar verilene kadar başlık doğru kalır.
5. **`SAAS-TASARIM.md` arşive taşınmaz / silinmez.** Öncelik farkı şerhle söylenir; belgenin ölçüm değeri (86 dosyanın prisma bağımlılığı, 19 bellek-içi global, ~46 istasyon hard guard'ı) hâlâ geçerli ve başka hiçbir yerde yok.
6. **`DEVIR-2026-08-17-FABRIKA-TALEP.md` ve `URETIM-KONTROL-LISTESI.md` yeniden yazılmaz.** Tarihsel belgelerdir; yalnız "bu satır tarihsel" işareti eklenir (`URETIM-KONTROL-LISTESI.md` bunu zaten kendi başında taşıyor — bayat sayılmadı).
7. **`adnansahin` geçen yayın adresleri/komutları yer tutucuya çevrilmez** (S9 önerisi: kalsın). Çalışan gerçek adres, kopyala-yapıştır hatası yapmayan tek referanstır; belgeler zaten hem şablonu (`<musteri>`) hem örneği veriyor.
8. **`ARCHITECTURE.md` enum tablosu sadeleştirilmez.** `WARP` kaldırma gerekçesi tarihsel bir karardır; şerh eklenir, satır korunur.
9. **Katalog sayıları "otomatik üretilsin" diye doküman-generator önerilmez.** Bu turun kapsamı doküman; sayı bayatlığının kalıcı çözümü "sayıyı yazma, tek kaynağı işaret et" (B3/B4/B5/B17'de bu biçimde önerildi).
10. **Hiçbir kod/şema/bekçi değişikliği bu rapordan doğmaz.** Ölçümler (ör. `station.appliesQuality` YOK, mobil `MODULE_DISABLED` yüzeyi YOK, `production.enabled` hâlâ salt-UI) yalnız **doküman şerhine** dönüştürüldü; uygulama işleri `MODUL-BAYRAK-UYGULAMA-PLANI.md`'nin P4/P6 ve Faz A/B dilimlerinde durur.

---

## Ek — Ölçülen kod kanıtları (tarama sırasında doğrulandı)

| Konu | Bulgu |
|---|---|
| Modül anahtarları | `src/constants/module-flags.ts` — **7** anahtar: `production.enabled` · `finance.enabled` · `ticaret.enabled` · `iplik.enabled` · `depo.multiEnabled` · `kumasTeknik.enabled` · `tezgah.enabled` |
| Kapılı route'lar | `goods-receipt.routes.ts:27` · `purchase-order.routes.ts:51` · `item-price.routes.ts:46` · `stock-count.routes.ts:44` (`requireTicaretEnabled`) · `yarn.routes.ts:32` (`requireIplikEnabled`) · `warehouse-transfer.routes.ts:24` (`requireDepoMultiEnabled`) · `workorder.routes.ts:21` · `station-capability.routes.ts:25` |
| Henüz kapısız | `production.enabled` — `requireUretimEnabled` route grep'inde YOK, hâlâ salt-UI |
| Süperadmin (P2) | `prisma/schema.prisma:421` `User.isSystemAccount`; `src/jobs/superadmin.job.ts:90-110` `.env` tohumlaması |
| Kalite yeteneği (P4) | **YOK** — `schema.prisma` + `helpers/step-capability.helper.ts` içinde `appliesQuality` 0 eşleşme |
| PROCESS_QC kalite yazmıyor | `kursun-qc.service.ts` içinde `qualityGrade` **0 eşleşme** |
| Mobil modül yüzeyi | `mobil/src` ağacında `MODULE_DISABLED` **0 eşleşme**; `useVisibleScreens.ts:38-40` `conditional` boş nesne |
| İzin / rol katalogları | `PERMISSION_CATALOG.length` = **86** · `ROLE_TEMPLATE_CATALOG.length` = **29** |
| Dev DB | `Teks-Erp/.env:5` → `postgresql://tekserp:***@localhost:55433/tekserp_demo`; `docker ps` → `tekserp-local-db` |
| Electron paket kimliği | `package.json:3` `productName` + `:122` `appId` müşteri adına SABİT; `electron-paketle.sh:99-123` yalnız `shared/musteri.json` yazıyor |
| Arşiv statüleri | `Electron/src/pages/Operations/Rolls/service.ts:56` → altı statü (`CANCELLED`, `SCRAP` dahil) |
| Sevk Kapısı karosu | `Electron/src/pages/Operations/tile-config.ts:273` → saf bayrak |
| Otomatik taslak fatura | `shipping.service.ts:2672` + migration `20260813201311…:352` (`invoices_one_active_per_shipment`) |

### Temiz çıkanlar (dokunulmadı)

`docs/ops/UZAK-ERISIM-KURULUM.md` (çok müşteri farkında; süperadmin bölümü 2026-09-03 P8 ile `npm run superadmin:kur`a çevrildi — `SUPERADMIN_*` env yolu artık yok) · `docs/ops/YEDEK-VPS-KURULUM.md` (`fab-<fabrika>` şablonu + güven modeli yazılı) · `deploy/README.md` (dal emekli notu işlenmiş) · `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md` (yol düzeni + `runtimeVersion` doğru) · `docs/design/YETKI-MIMARISI.md` (zaten çok müşteri çerçevesiyle yazılmış) · `docs/ops/URETIM-KONTROL-LISTESI.md` (kendi TARİHSEL uyarısını taşıyor).

**Ayrıca dokunulmayan çekirdek bölümler:** kök `CLAUDE.md` "Ortak Konvansiyonlar" madde metinleri · BEŞ SAĞLAMLIK SINIFI (244-254) · İdempotency (143) · WO kapatma dispozisyonu (98) · Tambur finalize WO disiplini (150) · `Teks-Erp/CLAUDE.md` istemci sürüm politikası (7-54) · DB performans kuralları (246-268) · timestamptz/fabrika günü (282-302) · `Electron/CLAUDE.md` process boundary (58-68) · sayfa iskeleti (146-198) · gezinme (199-238) · `mobil/CLAUDE.md` güncelleme kanalları (19-163) · liste sayfalama (401-429).
