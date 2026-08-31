# TeksERP — Backend (`Teks-Erp/`)

Express 5 + Prisma 7 + PostgreSQL. See root `CLAUDE.md` for domain facts.

> **Deep reference:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — full schema (~78 models, ~35 enums), API endpoint map, pattern examples, business rules, performance playbook. Read it when starting non-trivial work. (Not: §4-§6 envanter tabloları/sayıları nokta-anı snapshot'tır ve bayatlar — kanonik kaynak her zaman `schema.prisma`; ARCHITECTURE'ın değeri §7-§10 pattern/gerekçe içeriğindedir.)

## İstemci sürüm politikası (panel/tablet uyumu)

Bu projede deploy sırası **backend ÖNCE**. Yani yeni bir sözleşme çıktığında
sahada bir süre ESKİ istemciler koşar — ve bazı değişiklikler onlarda GÖRÜNÜR
hata üretmez: alan sessizce düşer. Politika o aralığı kapatır.

`src/config/client-version-policy.ts` → `CLIENT_VERSION_POLICIES`
Uç: `GET /api/client-policy/:istemci` (**PUBLIC** — istemci politikayı giriş
ekranından ÖNCE sorar; kimlik aransaydı, sözleşmesi bozulduğu için giriş
yapamayan istemciye "güncelle" diyebilme yolu kapanırdı).

| Kural | Neden |
|---|---|
| Değer **KODDA sabit**, panelde ayar DEĞİL | Yanlış girilen bir sayı sahadaki TÜM istemcileri kilitler; kod yolu review + deploy'dan geçer |
| İstemci **FAIL-OPEN** | Uç okunamaz/bozuk/404 ise istemci KİLİTLENMEZ. Projenin fail-closed eğiliminin bilinçli istisnası: "kapalı" tarafın bedeli tek bozuk yanıtla fabrikanın durmasıdır |
| Tanımsız istemci **404** (boş politika değil) | "Kural yok" ile "kural okunamadı" farkı korunur |
| Yeni istemci → route'a değil **kayıt defterine** satır | Uç parametreli |

⚠️ **`minVersion` sahadaki sürümden BÜYÜK OLAMAZ** — olsaydı en güncel istemci
bile kapıda kalır ve indirecek bir şey olmadığı için ÇIKAMAZDI (kendi kendini
kurtaramayan tek arıza biçimi). ⚠️ Yalnız GERÇEK bir kırılmada yükselt; her
sürümde artırmak, güncellemeyi indirememiş her makineyi üretim dışı bırakır.

### ⚠️ TETİK — şu değişiklikleri yaparken DUR ve `minVersion`'ı değerlendir

Aşağıdakilerden birini yapıyorsan, işi bitirmeden önce "sahadaki eski istemci bu
değişiklikten sonra ne yapar?" sorusunu **açıkça** cevapla:

| Değişiklik | Eski istemcide ne olur |
|---|---|
| Bir uç **kaldırıldı** ya da yolu değişti | 404 — görünür hata, ama akış durur |
| Yanıt alanının **adı** değişti / alan kaldırıldı | ⚠️ Alan sessizce `undefined` olur; ekran boş/0 gösterir, **kimse fark etmez** |
| Alanın **tipi/birimi** değişti (string→number, m→cm) | ⚠️ Sessiz yanlış hesap — en tehlikelisi |
| **Zorunlu** bir istek parametresi eklendi | 400 — eski istemci o işlemi hiç yapamaz |
| Enum'a değer eklendi | Eski istemci onu tanımaz (bu repoda beş kez yaşandı: "altıncı enum değeri unutuldu") |
| Yetki/izin kodu bir uçta zorunlu oldu | 403 — kullanıcı sebebi anlamaz |

Cevap "eski istemci bozulur" ise `minVersion` yükseltilir. Cevap "eski istemci
etkilenmez" ise **DOKUNMA** — her sürümde artırmak, güncellemeyi henüz
indirememiş her makineyi üretim dışı bırakır.

⚠️ **Sıra:** önce yeni istemci sürümü YAYINLANIR, sonra `minVersion` yükseltilmiş
backend deploy edilir. Ters sırada her makine kapıyı görür ve indirecek bir şey
olmadığı için çıkamaz. Ayrıntı ve örnek:
`docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md` → "`minVersion`'a ne zaman dokunulur".

Bekçi: `scripts/test_client_policy.ts` (kayıt defterindeki HER girdiyi kapsar).
Sahaya çıkarma reçetesi: kök `CLAUDE.md` → "Sürüm Yayınlama".

## Commands

```bash
npm run dev                  # nodemon + ts-node (server.ts)
npm run build                # tsc compile
npm run seed                 # Test verisi yükle
npm run prisma:generate      # Şema değişikliği sonrası ZORUNLU
npm run prisma:migrate       # migrate deploy (production)
npx prisma migrate dev       # Yeni migration oluştur (development)
npm run prisma:studio        # DB GUI
npm run lint                 # ESLint (yalnız src)
npm run typecheck            # Type-check — yalnız src/ (kök tsconfig)
npm run typecheck:scripts    # Type-check — scripts/ + prisma/ + src/ (tsconfig.scripts.json)
npm run typecheck:plain      # Aynısı --pretty false ile — çıktıyı GREP'LEYECEKSEN bunu kullan
npm run typecheck:scripts:plain
```

### ⚠️ tsc ÇIKTISI BORUDA DA RENKLİDİR — "temiz" hükmü METİNDEN VERİLMEZ (2026-08-13)

`npm run typecheck 2>&1 | grep "error TS"` **hiçbir zaman eşleşmez**: tsc boruya
yazarken bile ANSI rengi basar ve `error` ile `TS####` arasına kod girer
(`[91merror[0m[90m TS2339`). Ölçüldü ve ısırdı: 6 tip hatası "temiz" raporlandı,
`grep -c` 0 döndürdü, hata ancak nodemon uygulamayı çökertince görüldü. Kural:
**temiz/kirli hükmünün ölçüm birimi ÇIKIŞ KODUDUR** (`npm run typecheck; echo $?` —
0 temiz, 2 hata); hataları metin olarak süzeceksen `typecheck:plain` /
`typecheck:scripts:plain` kullan (`--pretty false`, grep'lenebilir). Not: casing
hataları (`AppError` ↔ `app-error.ts`) için ayrıca önlem GEREKMEZ —
`forceConsistentCasingInFileNames` açık ve tsc TS2307 ile yakalıyor (ölçüldü);
macOS'ta "derlendi sanma"nın tek sebebi yukarıdaki grep tuzağıydı.

### ⚠️ `scripts/` ve `prisma/` tip kontrolü — `npm test`'in ÖN KOŞULU

Kök `tsconfig.json` `include: ["src/**/*"]` ile sınırlı, `npm run lint` de `eslint src`. Bu yüzden **222 test dosyası uzun süre HİÇ derlenmedi**: bir servisin imzası ya da bir enum değişince `src` yeşil kalıyor, testler de yeşil kalıyor — ama testin doğruladığı ŞEY sessizce boşa düşüyordu. `tsconfig.scripts.json` (`noEmit`, `scripts/ + prisma/ + src/`) bu boşluğu kapatır ve **`npm test` artık onu geçit olarak koşar** (~28sn; tip hatası varsa paket KOŞULMAZ). Tek test koşarken (`npx tsx scripts/run-all-tests.ts <filtre>`) geçit atlanır; acil kaçış `SKIP_TYPECHECK=1`.

> Build hâlâ kök `tsconfig.json` ile yapılır — `tsconfig.scripts.json` **yalnız doğrular**, `dist/` üretmez (genişletilmiş `include` ile derlemek `dist/` düzenini bozardı).

2026-08-01 denetiminde bu geçit **87 tip hatası** buldu; hepsi YEŞİL test olarak raporlanıyordu. Tipik desenler:

| Desen | Sessiz sonuç |
|---|---|
| Var olmayan enum üyesiyle süzme (`StationKind.EXTERNAL` — o üye `StationType`'ta) | Prisma `undefined` koşulu ATAR → süzgeç no-op'a düşer, "fason olmayan istasyon seç" garantisi yok olur |
| Yanlış ilişki adıyla `deleteMany` (`workOrderStep` ↔ doğrusu `step`) + `.catch(() => {})` | Temizlik hiç koşmaz, fixture'lar dev DB'sinde birikir (denetimde 200 aktif istasyonun çoğu artıktı) |
| `catch (e) { err = e as typeof err }` | `typeof err` akış-daraltmasıyla `null`'a iner → hata gövdesi kontrolleri `never` üzerinde, hiçbir şey doğrulanmaz |
| Zorunlu hâle gelmiş parametrenin atlanması (`applyRawCode`'un `language`'ı) | Argüman `undefined` gider, kod `default` dalını ölçer — test "ZPL yolunu doğruladım" sanır |

### Pull sonrası senkronizasyon (yeni dev / `git pull` sonrası ZORUNLU sıra)

Eksik adım = sessiz bozulma. `prisma generate` atlanırsa TS derlenmez (`Property 'X' does not exist on type Y`); `migrate dev` atlanırsa runtime'da `P2022 — column X does not exist` ile audit log sessizce kaybolur ve server çalışmaya devam eder (best-effort audit). Doğru sıra:

```bash
npm install                  # package.json değiştiyse
npm run prisma:generate      # schema.prisma güncellendiyse client yenilensin
npm run prisma:migrate       # pending migration'ı DB'ye uygula (= migrate deploy)
npm run dev                  # sunucuyu kaldır
```

**Pull'lanmış migration'ı `deploy` uygular, `dev` DEĞİL** — `migrate dev` yeni migration *yazmak* içindir ve bu repoda diff aldığı her seferde iki DEFERRABLE composite FK'yı (`rolls_sackId_shipmentId_consistency`, `swatches_...`) DROP etmek ister (bkz. perf kuralı 4). Başkasının yazdığı migration'ı almak için diff'e hiç ihtiyaç yok: `deploy` yalnız dizindeki bekleyen dosyaları sırayla koşar. Production'da da aynı komut kullanılır.

**⚠️ Prisma komutları `Teks-Erp/` İÇİNDEN koşulur; kökten koşacaksan `--config` ver.** `prisma.config.ts` çalışma dizinine göre keşfedilir — repo kökünde bir `prisma.config.ts` yok, `--schema` ile şemayı göstermek de yetmez ve komut şu hatayla düşer:

```
Error: The datasource.url property is required in your Prisma config file
```

Mesaj config'i suçluyor ama sorun oradaki `url` satırı değil, **`.env`'in bulunamamış olması**: config `DATABASE_URL`'i `process.env`'den okur ve dotenv `.env`'i CWD'ye göre arar. 2026-08-15'te `prisma.config.ts` dotenv'i **kendi dizinine** sabitleyecek şekilde düzeltildi (`path.join(__dirname, ".env")`), böylece kökten de koşulabilir:

```bash
npx --prefix Teks-Erp prisma migrate status --config Teks-Erp/prisma.config.ts
```

Bu düzeltme *nereden* koşulduğunu değiştirmez, yalnız kök kullanımını mümkün kılar — **önerilen yol hâlâ `Teks-Erp/` içinden `npm run prisma:*`**, çünkü `.env`'i tek yerden çözmek DB adresinin hangi ortamdan geldiği sorusunu tek cevaplı bırakır.

## Environment (`.env`)

```
PORT=4000
DATABASE_URL="postgresql://oad@localhost:5432/adnansahin_db?schema=public"
JWT_SECRET="..."
```

> Geliştirme tamamen **yerel** PostgreSQL ile çalışır (`localhost:5432/adnansahin_db`). Uzak/paylaşımlı DB yok.

## Architecture (özet)

**Routes → Controllers → Services → Prisma** — alt katman atlamak yasak. (Bilinçli istisna: ince read/ayar endpoint'leri — admin/dashboard/feature-flag/customer-branch/production-balance/station-capability route'ları controller'sız, route içinde Zod parse + servise delege; iş mantığı yine serviste, prisma import'u route/controller'da YASAK.)

- `controllers/` — HTTP layer, Zod validate, service çağırır
- `services/` (+ `helpers/` + `reports/`) — iş mantığı, transaction, `AuditService.log()`
- `routes/` (+ `reports/`) — Swagger JSDoc + `verifyToken` + `requirePermission`
- `middlewares/` — `auth` (verifyToken), `rbac` (requirePermission), `error` (AppError + Prisma + Zod mapping), `device` (mobil allowlist/atama: x-device-id → req.device.machineId), `uuid-param` (UUID path validate), `latency` (per-endpoint gecikme ölçümü), `login-lockout` (PIN/kart giriş kilidi)
- `prisma/schema.prisma` — ~78 model, ~35 enum, `@prisma/adapter-pg`. **İdempotency katmanı:** `clientToken String? @unique @db.Uuid` (Roll/Order/WorkOrder) + `SwatchStockReduction` olay modeli (kartela stok-düşüm/iptal idempotency'sini taşır — KartelaDispatch'te clientToken yok).

**Master Data CRUD** için yeni kod yazmadan `BaseController` + `BaseService` kullan (`searchFields` config'i yeterli). Detay: ARCHITECTURE.md §8.1.

## Allowed npm Packages

Sadece bunlar. Alternatif tanıtma.

| Category | Packages |
|---|---|
| Core | `express`, `dotenv`, `cors`, `helmet`, `compression` |
| Database | `prisma`, `@prisma/client`, `pg`, `@prisma/adapter-pg` |
| Auth | `jsonwebtoken`, `bcryptjs` |
| Validation | `zod` |
| Docs | `swagger-ui-express`, `swagger-jsdoc` |
| Logging | `morgan` |
| Util | `uuid` |
| Barcode | `bwip-js` |
| Servis keşfi | `bonjour-service` (**1.4.4'e SABİT**) |
| Etiket fontu (raster) | `opentype.js` (DejaVu TTF → 1bpp glif; fontlar `assets/fonts/`) |
| Test data | `@faker-js/faker` (dev only) |

> **`bonjour-service` — bilinçli istisna (2026-08-26).** Bu listenin kuralı "paket ekleme, kendin yaz"dır ve üç kez uygulandı (`node-cron`→`setInterval`, `handlebars`→kendi şablon motoru, CSV paketi→hiç). Burada tersine karar verildi çünkü alternatif ~250 satırlık **DNS tel biçimi** kodu yazmaktı: kodlama/çözümleme hatası sessizdir (ilan hiç görünmez, hata vermez) ve bakımı bize kalırdı. Ölçülen ayak izi: CommonJS (`module:"commonjs"` ile uyumlu, `ERR_REQUIRE_ESM` riski yok), tipleri paket içinde, 6 paket, yerel derleme yok, `paketle.ps1` `npm ci --omit=dev` ile otomatik taşır. **Sürüm SABİT (`1.4.4`, `^` yok)** — sonraki ana sürümler ESM-only olabilir ve `require()` yolunu sessizce kırar. Kullanımı tek dosyada (`src/jobs/mdns-advertiser.job.ts`) ve orada tembel `require` + try/catch ile yüklenir: paket kaybolsa bile sunucu ayakta kalır.

## RBAC Permission Kodları

`requirePermission(code)` → `req.user.permissions[]` array. Permissions doğrudan kullanıcıya bağlanır (`UserPermission`), tekrar kullanım için `PermissionTemplate` var (rol modeli **yok**). Kanonik liste + güncel sayı **`src/constants/permission-catalog.ts`**'tedir (aşağıdaki tablo modül kırılımı + gerekçe notları içindir, sayaç değil):

| Modül | Permissions |
|---|---|
| SALES | `order:read/write`, `customer:read/write`, `customer-alias:read/write` |
| PRODUCTION | `workorder:read/write`, `workorder:distribute` (kurşun dağıtım — bypass düzeni), `roll:read/write`, `roll:manual-adjust`, `station:read/write` |
| MASTER_DATA | `item:read/write` |
| QUALITY | `quality:read/write`, `property:read/write` |
| SUBCONTRACTOR | `subcontractor:read/write` |
| KARTELA | `kartela:read/write` |
| LOGISTICS | `label:read`, `label:print`, `label:edit`, `label-template:read/write`, `shipping:read/write`, `shipping:invoice` (muhasebe fatura işareti — `shipping:write` VERMEDEN), `return:read/write` |
| REPORTS | `report:production/sales/quality/inventory/subcontract/customer/audit` |
| ADMIN | `admin:users`, `admin:settings`, `admin:*` (wildcard), `settings:workstation` (kategori **web** — "Bu Bilgisayar" yerel donanım sekmesi: yazıcı/kantar/tabanca/sunucu adresi; sunucuya HİÇBİR ŞEY yazmaz, `admin:*` bunu **vermez**), `document-template:read/write` (kategori **web** — belge tasarım yüzeyi; `admin:*` bunu da **vermez**) |
| MOBILE | `mobile:kk1/kk2-kursun/tambur/depo/fason-sevk/fason-kabul/kartela-sevk/kartela-kabul/tarti-paket/sevkiyat/iade/hizli-is-emri`, `mobile:kursun-dagitim` (Kurşun Dağıtım ekranı — `workorder:distribute`'in mobil ikizi), `mobile:kk1-desen` (KK1-içi yetenek: seçili operatöre yeni desen oluşturma), `mobile:*` (wildcard) |

> Eski `shipment:*` ve `allocation:*` permission'ları 2026-05-25'te silindi; yeni sevkiyat yazımıyla `shipping:read/write` + `return:read/write` (LOGISTICS) ve mobil ekran izinleri geldi.

### Yeni izin eklemek — TEK DOSYA (2026-08-01 kalıcı çözümü)

Yeni endpoint yazarken `requirePermission(code)`'daki `code` **DB'de olmalı** (yoksa Admin dışı kullanıcılar 403 alır ve hata mesajı sebebi söylemez). Bunu artık **unutmak mümkün değil** — izin eklemenin TEK adımı var:

> **`src/constants/permission-catalog.ts` → `PERMISSION_CATALOG` dizisine bir satır ekle. Başka hiçbir yere kopyalama.**

Üç parça o tek listeden beslenir:

| Parça | Dosya | İşi |
|---|---|---|
| 1. **Tek kaynak** | `src/constants/permission-catalog.ts` | 58 izin satırı. `category` Prisma `PermissionCategory` enum'una bağlı → yazım hatası **derlemede** düşer. |
| 2. **Boot-time uzlaştırma** | `src/jobs/permission-catalog.job.ts` (`server.ts`'ten çağrılır) | Backend **her açılışta** katalogla DB'yi karşılaştırır, EKSİK satırları yazar. Denklem: **kodu deploy etmek = katalogu getirmek.** |
| 3. **Mekanik bekçi** | `scripts/test_permission_catalog.ts` (`npm test`) | Route/controller/servislerdeki izin kodlarını TS AST ile tarar; katalogda olmayanı **geliştirme anında** düşürür. Ayrıca katalog ⊆ DB'yi doğrular (kırmızıysa "uzlaştırma bu DB'de koşmamış" sinyali). |

**Artık GEREKMEYEN iki adım:** ~~canlı DB'ye elle INSERT~~ ve ~~her izin için ayrı veri migration'ı~~. İkisi de "unutulabilir bir adımdı ve fiilen unutuldu" (2026-08-01: kurşun bypass ekranı canlıya çıktı, izin satırı olmadığı için kimse göremedi, teşhis saatler aldı). Boot uzlaştırması ikisinin de işini yapar; `pm2 restart` zaten deploy'un parçasıdır.

> `20260801020000_kursun_bypass_permission_catalog` migration'ı **duruyor ve silinmeyecek** (uygulanmış migration IMMUTABLE'dır; ayrıca kendisi `ON CONFLICT DO NOTHING` ile idempotenttir). Yalnız **emsal olmaktan çıktı** — yeni izin için benzerini YAZMA. Çift kaynak riski yok: migration ile uzlaştırma aynı katalog satırını yazar, ikincisi çakışanı atlar.

**Uzlaştırma yalnız EKLER — silmez, güncellemez.** Katalogdan bir kodu çıkarmak onu DB'den kaldırmaz (kullanıcı atamaları sessizce düşmesin diye); mevcut satırın `description`/`module` alanları da ezilmez (fabrika panelden düzeltmiş olabilir). Gerçekten kaldırmak/yeniden adlandırmak **bilinçli bir veri migration'ı** ister.

### Sayısal feature-flag eklerken (2026-08-19)

Boolean bayrağın üç yeri (`SETTING_KEYS` + `updateSchema` + `setFeatureFlags`) sözleşme
bekçisiyle korunuyordu; **sayısal ayarların aynı zinciri hiç ölçülmüyordu** (`aBool`
daraltması onları eliyordu). `test_feature_flag_contract.ts` artık sayısal anahtarları
da A(api)+B(şema)+C(servis) üçlüsünde arar. Panelde sayısal alan `FlagDef.numberField`
ile yazılır ve ⚠️ iç alan adı **`numberKey:`** olmak ZORUNDA — bekçi panel kümesini
satır başı `key: "..."` regex'iyle okuduğu için `key` adıyla yazılan sayısal anahtar
boolean kümesine sızar ve "yönetilemez bayrak" kontrolü yanlış şey ölçer.

`set()` `Prisma.InputJsonValue` alır: TS'te ne `null` ne `Prisma.JsonNull` geçer →
"değeri temizle" semantiği **0 yazarak** kurulur, okuma tarafı (`parsed <= 0 → null`)
onu "girilmemiş"e çözer.

### ROL (yetki şablonu) kataloğu — aynı üç parça, ikinci tur (2026-08-06)

Yeni izin **kodunun** DB'ye gelmesi yetmiyordu; onu kullanıcıya götüren **paketin** de gelmesi gerekiyor. Şablonlar (`PermissionTemplate`) da yalnız `seed.ts`'te yaşıyordu ve aynı boşluk aynı şekilde açıldı — bu kez ölçüldü: canlı fabrikada **"Admin (Tam Yetki)" şablonu 55 izin taşıyordu, katalog 67**. O şablonla açılan yeni yönetici 12 yetkiyi ALMIYOR ve bunu hiçbir yerde göremiyordu. Ayrıca **masaüstü (büro) rolü HİÇ YOKTU**: 16 şablonun 15'i tek-ekran mobil, biri tam yetki → üç masaüstü kullanıcısı (Eda · Enes · Samet) **birebir aynı 40 izne** sahipti.

| Parça | Dosya | İşi |
|---|---|---|
| 1. **Tek kaynak** | `src/constants/role-template-catalog.ts` | 26 rol (8 masaüstü + 17 mobil + tam yetki). `codes` alanı `PERMISSION_CATALOG`'a bağlı. |
| 2. **Boot-time uzlaştırma** | `src/jobs/role-template-catalog.job.ts` | İzin uzlaştırmasından **SONRA**, aynı zincirde koşar (şablon satırları izin satırlarına FK ile bağlı). |
| 3. **Mekanik bekçi** | `scripts/test_role_template_catalog.ts` | Katalog tutarlılığı + **kapsam** + DB uzlaştırması + idempotentlik. |

- **`mode:"all"` yalnız "Admin (Tam Yetki)" içindir** — o şablonun tanımı bir liste değil bir KURALDIR ("her şey"), bu yüzden her boot'ta katalogla eşitlenir ve bir daha bayatlayamaz. Diğer rollerde eksik izinler eklenir, **fazlalar korunur, hiçbir izin çıkarılmaz**.
- ⚠️ **Kimlik `code`'dur, ad değil** (`permission_templates.code`, migration `20260806040111`). Fabrika şablonu yeniden adlandırabilir; ada bakan bir uzlaştırma o rolü "yok" sayıp **ikizini doğururdu**. `code = null` → fabrikanın kendi şablonu, uzlaştırma ona hiç dokunmaz.
- ⚠️ **Sistem rolü SİLİNMEZ, PASİFLEŞTİRİLİR** (`deleteTemplate`). Sert silme, bir sonraki `pm2 restart`'ta **dirilişti** ve admin sebebini hiçbir yerde göremezdi. Pasif satır durduğu için uzlaştırma onu "var" sayar → "bu rolü kullanmıyorum" kararı kalıcı olur. Geri açma `PATCH … { isActive: true }`. `applyTemplate` pasif şablonu **400 ile reddeder** ve panel listesi onu gizler (iki katman aynı şeyi söyler).
- ⚠️ **Sahiplenme YALNIZ `LEGACY_TEMPLATE_NAME_TO_CODE` üzerinden.** Kodsuz eski seed satırlarını adlarıyla eşleyip kodlar. Bunu `entry.name`e de açmak cazip ama YANLIŞ: fabrika kendi "Muhasebe" şablonunu yaratmış olabilir ve o satır sessizce sistem rolüne dönüşüp bizim izin listemizi üstüne alırdı. Yeni rolde ad çakışması varsa **oluşturma atlanır**, sessizce genişletilmez.
- **Bekçinin en kolay kaybedilen kuralı:** kapsam kontrolü **"Admin (Tam Yetki)" DIŞINDAKİ** roller üzerinde koşar. O şablon hariç tutulmazsa kontrol **vakumen yeşil** kalır (tanımı gereği her izni içerir). Kapsam dışı kalması meşru izinler `ROLE_COVERAGE_EXEMPT`'te **gerekçeyle** durur (`admin:*`, `mobile:tambur-duzelt`, `mobile:kk1-desen`) ve muaf listesi **iki yönlü** denetlenir — ölü muaf da, gereksiz muaf da testi düşürür.
- **Katalog yine ATAMA İÇERMEZ.** Rol DB'ye gelir, kimseye verilmez. Unutulan atamayı görünür kılan tek yüzey **Yetki Kataloğu ekranındaki "N yetki hiçbir kullanıcıda yok" bandı**dır (`listPermissions` artık `userCount`/`templateCount` döner).

**Katalog NE İÇERMEZ:** kullanıcı→izin ATAMALARI ve fabrikanın düzenlemiş olabileceği şablon içerikleri — bunlar ortama özgüdür (bir kurulumda planlamacı Ahmet, diğerinde Mehmet), panelden veya `scripts/sync-*-permissions.ts` deseniyle verilir. Kural: *katalog koda, atama script'e.* Yeni bir ekran canlıda görünmüyorsa sırayla bak: (1) satır DB'de mi (boot log'u: `[permission-catalog] ...`), (2) kullanıcıya **atanmış** mı, (3) kullanıcı yeniden giriş yaptı mı (JWT'deki izin listesi bayat olabilir).

> **Mobil ayrı union taşır:** `mobil/src/types/permissions.ts` bağımsız bir projedir, bu katalogu import edemez — mobil ekran izni eklerken oradaki liste elle güncellenir (bekçi orayı taramaz).

Detay: ARCHITECTURE.md §6.

## Database Performance Rules (her zaman uygula)

> Üretim yüzbinlerce satır barındıracak; ERP yıllarca yerel sunucuda çalışacak. Detay + örnekler: ARCHITECTURE.md §9, §10.1, §10.2.

1. **FK index zorunlu.** Her `@relation` kolonuna `@@index([fkColumn])` — Prisma otomatik yapmaz. (Bilinçli istisna: düşük-trafik "kim yaptı" audit FK'ları — `printedById`, `grantedById`, `updatedById` gibi — sorgulanmadıkça indexlenmez; sorgu yolu doğarsa eklenir.)
2. **Composite index sırası:** Eşitlik kolonları önce, range/order sonra. Örn: `[status, createdAt]` ✓, `[createdAt, status]` ✗.
3. **Sık birlikte filtrelenen kolonlar = tek composite.** İki ayrı index bitmap scan'e zorlar.
4. **Null-yoğun / soft-delete tablolarda partial index.** `WHERE col IS NOT NULL` veya `WHERE isActive = true` — raw SQL migration ile (Prisma şemada native değil). **Drift-free yöntem:** şemada `@@index([col])` BIRAK, migration `DROP INDEX ... ; CREATE INDEX ... WHERE ...` ile partial'a çevir — Prisma 7 **predicate** farkını drift saymaz (test edildi) ama **index↔unique** farkını SAYAR (`schema.prisma:1603-1605`: aksi halde `migrate dev` sonsuz CREATE üretir → partial unique için şemada `@@unique` kullan). `items`/`customers` partial'ı henüz YOK (gerekirse aynı yöntemle).
    - **⚠️ Şema-dışı nesneler mekanik korunuyor — `scripts/test_db_invariants.ts`.** Aktif envanter (38 partial index + 27 CHECK constraint + 2 DEFERRABLE composite FK + 1 extended statistics; sayılar bayatlar — banner gerçek uzunluğu basar) o dosyada yaşar ve `npm test` ile koşar; predicate düşerse / nesne kaybolursa test DÜŞER. **Yeni partial index / CHECK / DEFERRABLE FK / statistics eklediğinde beklenen listeye de yaz** — kapı 2026-08-01'den beri **iki yönlü**: envanter-DIŞI nesne de testi DÜŞÜRÜR (eskiden `exit 0`'lı ⚠️ basıyordu ve `npm test` özetinde hiç görünmüyordu, yani fiilen sessizdi; ayrıca tespit 5 bölümün yalnız 2'sinde vardı). Kırmızıya doğru tepki nesneyi **silmek değil**, envantere yazmaktır. Neden gerekli: `20260611084953_native_uuid_pk_fk` FK kolonlarını DROP+ADD ederek 9 partial index'i sessizce TAM index'e çevirdi, `20260612100000` elle onardı — CI `migrate deploy`'u boş DB'de doğruladığı için yakalamadı. Gerekçeli tablo: ARCHITECTURE.md §10.
    - **⚠️ `sacks` composite FK drift'i:** `migrate dev` `rolls_sackId_shipmentId_consistency_fkey` + `swatches_...` FK'larını **her diff'te** DROP etmek ister (datamodel'de temsil edilemezler). `--create-only` ile üret, `DropForeignKey` satırlarını SİL. Bkz. `schema.prisma:2557-2558`.
    - **⚠️ ELLE YAZILAN MIGRATION: `git add` EDİLMEDEN `db execute` KOŞULMAZ.** Sıra **her zaman** `git add` → `prisma db execute` → `migrate resolve --applied` → DOĞRULA. **Bu sıra artık MEKANİK: `npx tsx scripts/apply-migration.ts <ad> [--apply]`** (dry-run varsayılan) — git kapısı + `ON_ERROR_STOP` + gerçek çıkış kodu + resolve + drift/hijyen bekçileriyle bağımsız doğrulama tek komutta. Elle dört adımı tekrarlama; 2026-08-13'te tam ortasından kırıldı (aşağıdaki resolve tuzağı). Neden: 2026-07-30'da üç migration dev'e uygulandı ama git'e hiç girmedi; dev tarafında her şey normal görünüyordu (dizinde var + `_prisma_migrations`'ta "uygulandı") ve eksik olan tek şey commit'ti. `migrate deploy` yalnız dizindeki dosyaları uygular → production'da kolon/enum hiç oluşmaz, deploy "başarılı" der, sonra kolonu okuyan **her** yol P2022/500 verir. Mekanik bekçiler: `npm run check:migrations` (git tarafı — untracked/modified migration + untracked `test_*.ts`) ve `npx tsx scripts/test_migration_hygiene.ts` (DB tarafı — DB'de var/dizinde yok, pending, elle-resolve edilmişler) ve **`scripts/test_schema_drift.ts`** (ŞEMA tarafı — `migrate diff` ile repo datamodel'i ↔ canlı DB; iki bilinen DEFERRABLE composite FK dışındaki her fark KIRMIZI). Üçü ayrı soruları sorar: *commit edildi mi* · *defter tutarlı mı* · *DB gerçekten şema gibi mi*. Emsal: `sacks_customerId_fkey` 2026-07-12'de opsiyonel oldu ama FK hiç yeniden yazılmadı; canlıda aylarca `ON DELETE RESTRICT` kaldı (şema `SET NULL` diyordu) ve **hiçbir bekçi görmedi** → `20260801030000_sack_customer_fk_setnull` ile kapatıldı.
    - **⚠️ `migrate resolve --applied` SQL'in KOŞTUĞUNU DOĞRULAMAZ** — yalnız `_prisma_migrations`'a `applied_steps_count = 0` ile satır yazar. `statement_timeout=50s` ile yarıda kesilen bir DDL de sessizce "uygulandı" görünür (D-23) — ve 2026-08-13'te İKİNCİ mod ölçüldü: `db execute` hatalı argümanla HİÇ ÇALIŞMADAN (yardım metni basıp çıktı) koşulan resolve yine "uygulandı" yazdı; RUB enum'da yokken defter doluydu. Bu yüzden `resolve` sonrası **doğrulama adımı opsiyonel değil**: `\d+ <tablo>` / `pg_enum` / `pg_index.indisvalid` — ya da doğrulamayı da içeren `scripts/apply-migration.ts` kullan.
5. **Yüksek hacim tablolar (`Roll`, `RollMovement`, `RollOperation`, `SystemLog`, `TravelerCardScan`)** için cursor pagination. `MAX_OFFSET=10000` guard aktif (`query-parser.ts`) — `skip > 10K` → 400.
6. **JSON alan sorgulanacaksa GIN index** raw migration ile, **endpoint yazılmadan ÖNCE**. Şu an hiçbiri sorgulanmıyor (`WorkOrder.parameters`, `RollOperation.metadata`, snapshot'lar). (`MachineLog` modeli 2026-05-25 cleanup'ında silindi.)
7. **`include` yerine `select`** — only-needed-fields, over-fetch'i azaltır. Liste sayfaları için detay ekranındaki tüm alanları çekme.
8. **Karmaşık aggregation → `prisma.$queryRaw`.** Prisma `groupBy` API'si bazen çoklu round-trip yaratır.
9. **`createMany` toplu insert için.** 100+ satır eklerken tek-tek `create` 10-50x yavaş.
10. **Transaction süresi kısa.** External I/O (HTTP, file) tx içinde **yapma** — lock uzar, deadlock riski. DB-level `idle_in_transaction_session_timeout=5min` aktif.
11. **`tx.*` ile `Promise.all` YASAK.** pg adapter tek connection seri çalıştırır; ESLint kuralı yakalar (`eslint.config.mjs`).
12. **EXPLAIN ile doğrula.** Yeni endpoint büyük tabloya değiyorsa `EXPLAIN ANALYZE` koş. `Seq Scan` görürsen index eksik.
13. **Snapshot JSON'ları liste sorgusunda çekme.** `Manifest.snapshot`, `PrintedDocument.snapshot` — sadece detay/print endpoint'i `select`'ine al. (`SubcontractorDispatch.printSnapshot` migration `20260609225307` ile kaldırıldı — donmuş belgeler artık `PrintedDocument`'ta.)
14. **Canlı DB'de index migration → vardiya dışında deploy et.** `CREATE INDEX` büyük tabloda yazma kilidi alır (milyon satırda dakikalarca). `prisma migrate deploy` komutunu gece veya hafta sonu çalıştır — operatörler farkına bile varmaz, sabah index hazır olur. Vardiya saatinde index ekleme yasak. (Sıfır-downtime gerekirse `CREATE INDEX CONCURRENTLY` + psql manuel akışı kurulabilir, şu an ihtiyaç yok.)
    - **⚠️ statement_timeout tuzağı:** App DB'de `statement_timeout=50s` aktif (aşağıdaki operasyonel bakım notu). Bu, **uzun bir DDL'i (büyük tabloda `CREATE INDEX`) 50s'de İPTAL EDER** (doğrulandı: `canceling statement due to statement timeout`). Yüz binlerce+ satıra index ekleyen migration'ın EN BAŞINA `SET statement_timeout = 0;` koy — yoksa migration yarıda kesilir. (Boş/yeni kurulumda risk yok; toplu veri biriktikten sonra index eklerken kritik.)

## Operasyonel Bakım

- **`statement_timeout=50s`** aktif (uzun sorgu otomatik iptal; `pg_db_role_setting`'den 2026-06-12 doğrulandı). DB-level: `ALTER DATABASE <db> SET statement_timeout = '50s'` — migration ile değil, manuel uygulanır. DB adı ortama göre: dev=`adnansahin_db` (.env), sahadaki Windows sunucu=**`tekserp`** (PostgreSQL 16.9, `C:\Etkili-Yazilim\pgsql`; eski installer'ın `TeksErpDb` adı kullanılmadı). Detay: ARCHITECTURE.md §10.1 + `docs/ops/DEPLOY-RUNBOOK.md` "Sahadaki kurulum" tablosu.
- **Slow query log** (`>500ms`) PostgreSQL log dosyasına düşer — **yalnız üretim kurulumunda** (`postgresql.conf` → `log_min_duration_statement=500`; değerlerin kaydı `docs/ops/DEPLOY-RUNBOOK.md §6`). Dev'de kapalı (`-1`); açmak istersen `ALTER DATABASE adnansahin_db SET log_min_duration_statement = 500` (D-16).
- **Yedekleme backend'e ait** (2026-07-30): `services/backup.service.ts` + `jobs/backup-scheduler.ts` — `pg_dump` ayrı child process'te koşar (backend bloklanmaz), sonra bütünlük doğrulama (`verifyBackupFile` → `pg_restore --list`) → 14'lük rotasyon → offsite kopya. `BACKUP_DIR` tanımsızsa **yedek alınmaz**. Yedek saati `SystemSetting backup.hour` (panelden ayarlanır, restart gerekmez). Eski `manage.ps1` + Görev Zamanlayıcı zinciri kaldırıldı.
- **Gece yedeğinin sahibi ORTAMA GÖRE değişir (2026-07-31):** sahadaki sunucuda yedeği bağımsız bir Windows Görev Zamanlayıcı görevi alıyor (`TeksERP-DB-Backup` → `yedekle.ps1`, 02:00, 30 gün) — **backend çökmüşken bile yedek alınsın** diye bilinçli. Orada backend zamanlayıcısı `BACKUP_SCHEDULE_ENABLED=false` ile KAPALI; ikisi birden açık kalırsa her gece iki dump alınır. Saklama **GÜN bazlı** (`BACKUP_RETENTION_DAYS`, varsayılan 30) — eski "en yeni 14 dosya" politikası aynı klasöre yazan harici script'in 30 günlük geçmişini sessizce siliyordu. Yaşına bakılmaksızın en yeni 3 dosya korunur (sistem saati kayması sigortası).
- **Yedek ön ekleri = yaşam döngüsü** (`services/helpers/backup-naming.helper.ts` TEK KAYNAK): `tekserp_` rotasyona **girer** (silinebilir) · `premigrate_` ve `pre-restore_` rotasyon **dışı**. Rotasyon filtresi yalnız `tekserp_`'e bakar — bu, geri yükleme güvenlik ağının dayandığı invariant. Cutoff çözümlemesi `min(ad damgası, mtime)`: ad damgası dump BAŞLANGICI (pg_dump snapshot'ı orada alır), mtime BİTİŞ; mtime tek başına kullanılırsa dump süresince oluşan kayıtlar "kaybolmayacak" sayılır.
- **Kopyaya geri yükleme** (2026-07-30, `db-copy.service.ts` + `db-copy-verify.service.ts` + `routes/db-copy.routes.ts`): yedek CANLI DB'ye değil `<canlı>_restore_<damga>` adlı yeni bir veritabanına yüklenir, doğrulanır, sonra iki `ALTER DATABASE RENAME` ile takas edilir (`DATABASE_URL` değişmez, geri alma = ters rename). **Üç sezgiye aykırı kural:** (1) per-DB ayarlar (`statement_timeout`) `pg_db_role_setting.setdatabase` **OID**'sine bağlı → rename ile TAŞINMAZ, Faz A replay eder ve doğrulama eşitliği `fail` sayar; (2) `CREATE DATABASE` **`TEMPLATE template0`** şart — PG farklı locale'i yalnız onunla kabul eder, canlıyı şablon almak backend bağlı olduğu için hep patlar; (3) doğrulamada **`applied_steps_count` KULLANILMAZ** (D-23: 130 migration'ın 8'i meşru sıfır). Silme **ALLOWLIST**'lidir (`isRestoreCopyName`), `_old_` DB'lerinin silme ucu YOK. Otomatik retention YOK.
- **Geri yükleme bilinçli olarak backend'de DEĞİL** (elle, `pm2 stop` + `pg_restore`) — `pg_restore --clean` şemayı düşürür, backend kendi havuzu ayaktayken bunu güvenilir yapamaz. Panel üç katmanlı onay verir: kayıp önizlemesi (`backup-impact.service.ts`, `GET /api/admin/backups/:name/restore-impact`) → yazarak onaylama (DB adı) → doğrulanmış güvenlik yedeği. **Sayımlar yalnız INSERT yakalar**; UPDATE hacmi audit rollup'ından gelir ve audit kapsamı yetmezse **"ölçülemedi" yazılır, 0 YAZILMAZ**. Komut bloğunun `$LASTEXITCODE = 1` sıfırlaması + `if ($ok)` guard'ı load-bearing (bkz. `docs/ops/DEPLOY-RUNBOOK.md §5`).
- **SystemLog arşivi OTOMATİK** (`jobs/archive-scheduler.ts`, `server.ts`'te aktif — server start +60sn, 24 saatte bir kontrol, 30 günde bir 6 aydan eskiyi taşır). Manuel `POST /api/admin/system-logs/archive { "monthsToKeep": 6 }` yalnız acil disk baskısında (idempotent, `archived=0` dönene kadar). (B-11: eskiden manuel talimattı, artık otomasyon önde.)
- **6 ayda bir** (arşivle birlikte) `POST /api/admin/sessions/purge { "olderThanDays": 90 }` — jti registry'nin ölü satırları temizlenir; aktif oturumlar matematiksel kapsam dışı.
- **3 ayda bir** ARCHITECTURE.md §10.2 sağlık kontrolü + **`psql <db> -f scripts/consistency-check.sql`** (D-9: shippedQty mutabakatı — DB seddi olmayan tek denormalize alan; drift olursa karşılanma/MRP sessizce yanlışlanır). **Artık takvime bağlı DEĞİL:** aynı sorgular `scripts/test_consistency.ts` ile `npm test`'te koşar ve drift = KIRMIZI (psql her durumda `exit 0` verdiği için elle koşum tek başına sessizdi). SQL dosyası operatörün elle koşup **satırları görmesi** için duruyor; bir bölümün mantığı değişecekse ÖNCE orada değişir, sonra test'e kopyalanır. Test ayrıca **§20**'yi ekler: `WorkOrderStep.status` (recomputeStepStatus ile türetilen, sedsiz ikinci denormalize alan) mutabakatı.
- **Şema tip konvansiyonu (O-11) — 2026-08-01'de KÖKTEN ÇÖZÜLDÜ:** artık **her** `DateTime` kolonu `timestamptz`'dir (`20260801040000_timestamptz_conversion`: 80 tablo / 183 kolon; şemada 192 alan `@db.Timestamptz`). Tek bilinçli istisna `EndpointLatencyDaily.day` (`@db.Date` — saat taşımayan takvim günü; timestamptz'ye çevirme, gün sınırı tz'ye bağlanır ve rollup anahtarı kayar). Yeni `DateTime` alanı eklerken `@db.Timestamptz` **zorunlu** (bekçi: `scripts/test_timestamptz_contract.ts`). Yeni UUID taşıyan kolon FK olmasa bile `@db.Uuid` (D-14).
    - **Neden yapısal:** `timestamptz` MUTLAK ANI saklar → kim yazarsa yazsın (Prisma, `NOW()`, `CURRENT_TIMESTAMP`, kolon DEFAULT'u) aynı doğru değer çıkar; oturumun saat dilimi yalnız GÖSTERİMİ etkiler. Öncesindeki doğruluk "herkes UTC yazsın" **disiplinine** bağlıydı ve fiilen kırıldı (aşağı). Dönüşüm boş-tablo penceresinde yapıldı: veri biriktikten sonra her ALTER tam tablo yeniden yazımı + ACCESS EXCLUSIVE kilit demekti.
    - **⚠️ GERİ ALMA ileri yönün aynası DEĞİL (2026-08-01 çapraz doğrulamada ölçüldü).** Ters ALTER listesi (`TYPE timestamp USING "kolon" AT TIME ZONE 'UTC'`) Istanbul oturumunda **PATLAR**: `work_order_steps_time_order` CHECK'i iki tarih kolonunu karşılaştırır (`completedAt >= startedAt`) ve ALTER'lar kolon kolon koştuğu için arada **karışık tip** anı doğar; PG tz'siz tarafı **oturum saat diliminde** yorumlar. İleri yönde alfabetik sıra sayesinde henüz çevrilmemiş `startedAt` 3 saat erken görünür → kısıt **daha kolay** sağlanır (ileri migration Istanbul oturumunda temiz koştu, doğrulandı). Geri yönde ise çevrilmiş `completedAt` 3 saat erken görünür → gerçek gap'i 3 saatten kısa her satır kısıtı **ihlal eder**. Çözüm: geri alma script'inin başına **`SET timezone='UTC';` + `BEGIN;`** (ikisi de zorunlu — biri doğruluk, diğeri yarı-çevrilmiş DB'ye karşı). Genel ders: **iki tarih kolonunu karşılaştıran her CHECK, tip geçişlerinde oturum saat dilimine duyarlıdır**; bugün böyle tek kısıt var, yenisi eklenirse `docs/ops/SURUM-2026-07-31-DEPLOY.md §1b` güncellenmeli.
    - **Dönüşüm maliyeti ölçüldü:** dolu dev DB'sinde (38k `system_logs` / 21 MB, 15k `rolls` / 12 MB) 183 kolon **≈2,1 sn**; tekil ALTER'lar 1–5 ms, `system_logs`'un iki kolonu 401/489 ms. Maliyet satır sayısıyla **doğrusal** (tam tablo yeniden yazımı + ACCESS EXCLUSIVE) — `roll_movements` milyona çıktığında dakikalar sürer ve vardiya durur.
    - **⚠️ Dönüşümün `USING`'i load-bearing:** `ALTER ... TYPE timestamptz` **USING'siz** yazılırsa PG mevcut değerleri OTURUM saat diliminde yorumlar ve Europe/Istanbul'da hepsini 3 saat kaydırır. Doğrusu `USING c AT TIME ZONE 'UTC'` ("bu değerler UTC'dir" beyanı, çünkü Prisma UTC yazmıştı). Doğrulandı: 183 kolonun count/sum/min/max epoch parmak izi dönüşüm öncesi/sonrası **birebir aynı** (md5 eşit).
    - **⚠️⚠️ `@prisma/adapter-pg` OTURUMUN UTC OLDUĞUNU VARSAYAR — `src/lib/prisma.ts` havuzundaki `options: "-c timezone=UTC"` SÜS DEĞİL, SİLME.** Adapter timestamptz okurken PG'nin döndürdüğü metnin **offset'ini ATAR** ve yerine körlemesine `+00:00` yazar (`dist/index.js` → `normalize_timestamptz`). Europe/Istanbul oturumunda PG `2026-07-30 15:20:08.255+03` döner, adapter `...15:20:08.255+00:00` yapar → **okunan her tarih +3 saat kayar**. Ölçüldü (2026-08-01): düz `pg` 12:20:08Z okurken Prisma ORM 15:20:08Z veriyordu; `options` eklenince sapma 0 sn. Dönüşümden ÖNCE de timestamptz olan 9 kolonu (users/label_templates/peripheral_devices `deletedAt`, kursun_bypass_assignments ×5, swatch_stock_reductions) bu hata **sessizce bozuyordu** — yani bu satır eski bir gizli bug'ı da kapattı.
    - **Bugünden sonra ham SQL'de çıplak `now()` GÜVENLİ** (kolon timestamptz) — ve **TERCİH EDİLEN yazım budur**. Eski 13 `now() AT TIME ZONE 'UTC'` yazımı UTC oturumunda **kimlik dönüşümüdür** (ölçüldü: sapma 0 sn) ama `timestamptz → timestamp → timestamptz` turunun ikinci çevrimi oturum tz'sinde yorumlandığı için **kırılgan olan taraf artık BU**. **3 OKUMA noktası temizlendi** (`getRollAging` ×2, `getLateDeliveries` — gerekçeli `-- tz-ok:` işaretiyle çıplak `now()`); geriye **10 YAZMA noktası** kaldı (`SET "exitedAt" = (now() AT TIME ZONE 'UTC')`; workorder ×4, subcontractor ×4, kursun-bypass, kursun-qc) — bugün doğru, acil değil, aynı desenle temizlenebilir.
        - `test_raw_sql_hygiene.ts` **her ikisini de kabul eder** (çıplak `NOW()` yalnız gerekçeli `-- tz-ok:` ile geçer). Bekçi hâlâ çıplak `NOW()`'ı işaretler ama **sebebi değişti ve dosya başlığında yazılıdır (2026-08-01)**: gerekçe artık "yanlış olabilir" değil **TUTARLILIK** — kolon tipini SQL metninden çıkaramayan bir bekçi için ulaşılabilir en iyi garanti, her ham zaman fonksiyonunun yanında kararın YAZILI olmasıdır. Başlıktaki "DOĞRU KULLANIM = `AT TIME ZONE 'UTC'`" reçetesi kaldırıldı (dönüşüm sonrası yanlış yazımı öğretiyordu); `~90 tz'siz kolon DEFAULT'u` ve `12 kolon timestamptz` gibi bayat sayılar da düzeltildi. Asıl yapısal güvence `test_timestamptz_contract.ts`tedir.
    - **⚠️ ESKİ BOZULMA (2026-08-01, düzeltildi) — geçmiş satırlar HÂLÂ ŞİŞKİN.** 10 yazma noktası `roll_movements."exitedAt"`e çıplak `NOW()` yazıyordu: Prisma aynı kolona UTC yazdığı için **tek kolonda iki saat** oluşmuştu (ölçüm: `enteredAt` max 01:25 UTC ↔ `exitedAt` max 04:25 yerel). Sonuç `AVG(exitedAt - enteredAt)` istasyon süresinde **+10800 sn sessiz şişme**; hata yok, log yok. Üç okuma noktası da (`getRollAging` ×2, `getLateDeliveries`) tz'siz kolonu `NOW()` ile karşılaştırıp eşiği 3 saat kaydırıyordu. **Geçmiş satırlar bilinçli olarak DÜZELTİLMEDİ** (canlı veriye dokunma kararı) — timestamptz dönüşümü bu satırları OLDUĞU GİBİ taşıdı (epoch korunur), yani eski hareketlerin süre raporu hâlâ şişkin.
    - **Mekanik bekçi: `scripts/test_raw_sql_hygiene.ts`** (`npm test`). `src/` altındaki ham SQL şablonlarını TS AST ile tarar, çıplak `NOW()`/`CURRENT_TIMESTAMP`/`LOCALTIMESTAMP`/`CURRENT_DATE`/`clock_timestamp()` arar. Kolon gerçekten `timestamptz` ise SQL'in içine **gerekçeli** `-- tz-ok: <neden>` yaz (gerekçesiz işaret testi DÜŞÜRÜR; muafların listesi her koşumda basılır). Bugünkü tek muaf: `src/app.ts` `/health` sorgusu (`pg_stat_activity.query_start` timestamptz). **Şablon içi Türkçe açıklamada backtick kullanma** — JS template literal'ı ortadan böler.
    - ~~**Bekçinin GÖREMEDİĞİ ikinci yol — ham `INSERT`'te ATLANAN zaman kolonu.**~~ Bu delik timestamptz dönüşümüyle **kapandı**: `DEFAULT CURRENT_TIMESTAMP` taşıyan ~90 kolon artık timestamptz olduğu için default tetiklense de doğru anı yazar. Ham INSERT'te zaman kolonunu atlamak artık güvenli.
    - **Mekanik bekçi #2: `scripts/test_timestamptz_contract.ts`** (`npm test`, 13 kontrol) — **timestamptz'nin TEK bekçisi; ikincisini yazma.** Dört cepheyi birden kilitler: (1) DB'de `timestamp without time zone` kolon KALMAMALI, (2) `schema.prisma`'daki her `DateTime` `@db.Timestamptz` taşımalı (taşımazsa `migrate dev` bir sonraki diff'te kolonu tz'sizE GERİ ÇEVİRİR — yani şema tarafı 1. maddeyi sessizce bozar), (3) havuz oturumunun `TimeZone`'u UTC olmalı (adapter varsayımı) ve `new Pool(` kuran her dosya `PG_SESSION_OPTIONS` geçmeli, (4) **İKİ YÖNLÜ sürücü turu** — bilinen bir anı yazıp okur. Ayrı bir "şema bekçisi" dosyası açmak cazip ama YANLIŞ: aynı invariant'ı iki dosya iddia edince muaf listeleri kaçınılmaz olarak birbirinden ayrışır, biri meşru sebeple kırmızıya döner ve ekip **kırmızı bekçiyi görmezden gelmeyi** öğrenir.
        - **4. madde neden İKİ yön ve neden ortamdan bağımsız (2026-08-01 çapraz doğrulamada sertleştirildi):** adapter'ın hatası **simetrik değil, iki ayrı mekanizmadır** — YAZMA'da Prisma `Date`'i UTC duvar-saati metni gönderir ve Istanbul oturumu onu yerel sanar (**−10800 sn**), OKUMA'da adapter dönen metnin ofsetini atıp `+00:00` yazar (**+10800 sn**). İkisi de ölçüldü (`options` verilmeyen havuzla negatif sınama). Tek yön test edilseydi diğeri kaçardı. Bölüm **bind parametresi + literal** ile çalışır — tablo/fixture/TEMP tablo YOK (havuz sorguları farklı bağlantılara dağıtabildiği için TEMP tablo güvenilmez) → **boş bir CI veritabanında da tam koşar**. Eskiden bu bölüm `roll_movements.findFirst()`e dayanıyordu ve tablo boşsa **sessizce atlanıyordu** (CLAUDE.md "Ortamdaki veriye BAĞIMLI OLMA" ihlali): temiz CI DB'sinde en tehlikeli sessiz hatanın bekçisi hiç koşmuyordu. Gerçek satır mutabakatı **4b'ye bonus** olarak alındı — veri yoksa yalnız o atlanır, güvence atlanmaz.
        - **Körlük zemini (bu bekçinin en kolay kaybedilen özelliği):** her sayım kontrolünün alt sınırı vardır — taranan `DateTime` alanı >150, bulunan havuz kurulumu >=5, DB'deki timestamptz kolonu >150. Neden: bir refactor tarayıcıyı boşa düşürürse (şema çok-dosyaya bölünür, dizin adı değişir, regex eşleşmez) "ihlal bulunamadı" ile "hiçbir şeye bakılmadı" **aynı yeşile** çıkar. Ölçüldü: 2 alanlık sahte şemayla "tümü işaretli" kontrolü vakumen YEŞİL kaldı, testi yalnız zemin düşürdü.
        - **Muaflar keşfedilir, elle listelenmez.** Havuz denetimi `src/` + `prisma/` + `scripts/` ağacını tarar (504 dosya); eski hâli 5 dosyalık **elle** listeydi ve tam da korkulan olayı — *yeni* bir dosyanın havuz kurmasını — göremiyordu. İki muaf kümesi (`DATE_ONLY_FIELDS`, `POOL_EXEMPT`) gerekçelidir, **her koşumda basılır** ve **bayatlığa karşı denetlenir**: muaf edilen alan şemada yoksa / artık `@db.Date` değilse, muaf edilen dosya artık havuz kurmuyorsa test DÜŞER (ölü muaf, gerçek bir ihlali sessizce kapsam dışında tutar).
        - **Negatif sınandı (2026-08-01), varsayılmadı:** ① şemadan bir `@db.Timestamptz` çıkarıldı → `❌ … RollMovement.enteredAt`, exit 1; ② `public`'e tz'siz kolonlu sonda tablo açıldı → `❌ … _tz_guard_probe.createdAt`; ③ şema 2 alanlık sahte dosyayla değiştirildi → körlük zemini düştü; ④ `PG_SESSION_OPTIONS`'sız yeni havuz dosyası eklendi → `❌ … prisma/_sonda-yeni-havuz.ts` (eski elle liste bunu ATLARDI); ⑤ sahte bayat muaflar eklendi → iki muaf kontrolü de düştü. Her sondadan sonra dosyalar md5 ile birebir geri yüklendi. Bekçiyi değiştirirsen **aynı beşini tekrarla** — "kırmızı verebiliyor mu" kanıtlanmamış bekçi, bekçi değil süstür.
- **Fabrika günü = `Europe/Istanbul` takvim günü — TEK KAYNAK `src/constants/time.ts` (2026-08-01, O-11'in devamı):** timestamptz'ye geçince "bu olay hangi GÜNE ait" bir **iş sorusu** oldu ve açıkça yazılmak zorunda. `DATE_TRUNC('day', tstz_kolon)` günü **oturum** saat diliminde keser; havuz oturumu bilinçli olarak UTC (adapter varsayımı) → gün sınırı sessizce UTC'ye bağlanmıştı ve **yerel 00:00–03:00 arasındaki her olay (yani gece vardiyasının ortası) bir ÖNCEKİ güne** yazılıyordu. Kural: `'Europe/Istanbul'` literalini **hiçbir yere kopyalama** — `FACTORY_TIMEZONE` + `factoryDaySql()` (SQL gruplama) / `factoryDayStart()` (Prisma `gte` sınırı) / `factoryDayKeyUtcMidnight()` (`@db.Date` anahtarı) / `factoryYmd()` (etiket) kullan. Çok-şubeli/çok-saat-dilimli senaryo doğarsa tek noktadan çözülür.
    - **İki soruyu ayır:** *TAKVİM GÜNÜ* ("bugünkü sayaç", günlük grafik çubuğu, belge numarasındaki GGAAYY) saat dilimine BAĞLIDIR → açık yaz. *MUTLAK PENCERE* ("son 72 saat", stok yaşlandırma kovaları, "termini geçti mi", `daysOpen`/`daysLate`) iki an arasındaki farktır, saat diliminden BAĞIMSIZDIR → dokunma, yalnız `-- tz-ok:` gerekçesiyle belirt.
    - **`resolveDateRange` sınırı İSTEMCİNİNDİR:** rapor `dateFrom`/`dateTo`'su mutlak an'dır ve Electron filtresi seçilen günün **yerel** 00:00 / 23:59:59.999 anını gönderir (`useReportDateRange.ts`). Backend ekstra gün yuvarlaması **yapmaz** — yaparsa istemcinin niyeti iki kez yorumlanır. Gruplama ayrı sorudur ve fabrika gününe göre kesilir.
    - **⚠️ `sl_day_exact` ifade istatistiği gruplama ifadesine BAĞLIDIR.** Audit `daily` sorgusunun GROUP BY ifadesi değişirse istatistik **sessizce** devre dışı kalır (sonuç doğru, sorgu ~2× yavaş). `20260801050000_system_log_daily_stats_tz` onu fabrika saat dilimli ifadeye taşıdı; `factoryDaySql`'in ürettiği metni değiştirirsen **yeni bir migration da yaz**.
    - **Mekanik bekçi: `scripts/test_report_day_boundary.ts`** (`npm test`). Beş cephe: (1) JS yardımcıları süreç `TZ`'sinden bağımsız mı, (2) `factoryDaySql` canlı PG'de gece-vardiyası anını doğru güne yazıyor mu (aynı satırda çıplak `DATE_TRUNC` ile farkı da KANITLAR), (3) uçtan uca audit `daily` serisi, (4) **`src/` içinde `factoryDaySql`'i bypass eden elle `DATE_TRUNC('day'…)`/`CURRENT_DATE` kaldı mı** — yeni gelen biri yazdığı gün kırmızı verir, (5) istatistik nesnesi fabrika saat dilimini içeriyor mu. Ayrıca PG `date` → JS `Date`'in UTC-gece-yarısı geldiğini doğrular; bu varsayım kırılırsa **tüm günlük seriler bir gün kayar**.
- **Bloat ölçülünce** (takvimle değil) `REINDEX INDEX CONCURRENTLY` — `scripts/index-health.sql` §8 (ölü-satır proxy) + §9 (pgstattuple kesin bloat) ile şişen indeksi tespit et, sadece onu reindex et. Tipik eşik: indeks boş-alan >%30 veya tablo ölü-satır >%20. Canlı/dolu DB'de CONCURRENTLY şart (yazma kilidi almaz).

## Yeni Endpoint Kontrol Listesi

- [ ] Yeni FK için `@@index([fkColumn])` eklendi
- [ ] `prisma generate` çalıştırıldı
- [ ] Service: transaction + `AuditService.log()` her CUD'de
- [ ] Controller: Zod validate + service çağır
- [ ] Route: `verifyToken` + `requirePermission(kod)` + Swagger JSDoc — kod `src/constants/permission-catalog.ts`'te **olmalı** (bekçi: `scripts/test_permission_catalog.ts`)
- [ ] `app.ts`'e `app.use("/api/...", routes)` eklendi
- [ ] Fiziksel DELETE değil `isActive: false` veya status değişikliği
- [ ] `any` yok
- [ ] `tx` içinde `Promise.all([tx.*])` yok
- [ ] Dış referans ID'leri (`itemId`/`colorId`/`propertyId`...) var-mı + `isActive` doğrulandı
- [ ] `@unique` numara/barkod üretiyorsa `withBarcodeRetry` + sequence okuma closure/tx İÇİNDE (`utils/barcode-retry.ts`)
- [ ] Durum geçişi/tüketim → **atomik claim**: `updateMany WHERE {id, beklenen-durum}` + `count===0` → 409; `findUnique→if→update` check-then-act YASAK (claim sonrası içerik tx İÇİNDE taze yüklenir)
- [ ] Mobil ekranın dokunacağı endpoint → `requireAnyPermission('<web-izni>', ...MOBILE_X)` (sadece `requirePermission` = saha kullanıcısı 403)
- [ ] Decimal kolonda JS float aritmetiği yok — DB-side `increment`/`decrement` veya `Prisma.Decimal` (`.plus()/.minus()`)
- [ ] Depo çuvalı içeriğine dokunuyorsa önce `touchWarehouseSackTx` (WHERE shipmentId IS NULL — sevkiyata atanmış çuvalı reddeder); PLANNED sevkiyatın çuval kümesini değiştiriyorsan `touchShipmentPlannedTx`; çuval içeriği değişiyorsa `resetSackWeightsTx` (bayat kg irsaliyeye gitmesin)
      - **BİLİNÇLİ İSTİSNA — `Sack.notes` (çuval notu):** `setSackNotes` bu guard'ı **KULLANMAZ** ve `resetSackWeightsTx` de nota **DOKUNMAZ**. Not ne ölçüm ne içeriktir (annotation, `Shipment.dispatchNote` ile aynı gerekçe) → sevkiyata atanmış / sevk EDİLMİŞ çuvala da yazılabilir ("müşteri şikayet etti"). Guard'ı "eksik" sanıp **EKLEME** — eklersen özellik sessizce 409'a düşer. Regresyon testi: `scripts/test_sack_notes.ts` (8b/9).

## Mobil güncelleme + istemci sürüm politikası

İki şey backend'de yaşıyor ama **sahibi mobil taraftır**; buraya dokunmadan önce
[`docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`](../docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md) oku.

**① `/api/mobile/updates/*` — LAN ikizi.** Tabletler güncellemeyi normalde İNTERNETTEN
(VPS) alır; bu uçlar internetsiz bir kurulum için aynı depoyu LAN'dan servis eder.
⚠️ **Sunucu manifest ÜRETMEZ, donmuş baytları servis eder** — kod imzalama gövdenin HAM
baytları üzerinden doğrulandığı için manifest yayın anında dondurulur (üreten tek yer
`mobil/scripts/lib/manifest.mjs`). Buraya "render eden" bir kod eklemek imzayı geçersiz
kılar ve tabletler paketi sessizce REDDEDER. Uçlar bilerek **PUBLIC** (tablet güncellemeyi
giriş ekranından ÖNCE sorar; koruma kimlik değil kod imzalamadır) ve
`test_route_auth_coverage` muaf listesinde gerekçeleriyle kayıtlı.
Bekçi: `scripts/test_mobile_update.ts` (37 kontrol; backend ↔ mobil ↔ nginx sınırlayıcı
tutarlılığını da ölçer).

**② `src/config/client-version-policy.ts` — "bu backend hangi istemciyi bekliyor".**
Deploy sırası backend ÖNCE olduğu için sahada bir süre eski istemciler çalışır; politika o
boşluğu kapatır. Yeni istemci = kayıt defterine bir satır (route'a dokunma).
⚠️ **Mobilde İKİ sürüm ekseni var:** `minVersion` (APK) + `minPaketTarihi` (uzak paket) —
JS düzeltmesi `versionName`i değiştirmeden sahaya gider, tek eksen bunu ifade edemez.
⚠️ `minVersion`/`minPaketTarihi` yükseltmeden ÖNCE onu karşılayan paketi yayınla; tersi
tabletleri indirecek bir şey olmadan kilitler. Bekçi: `scripts/test_client_policy.ts`.

## Test Scriptleri

Test altyapısı `scripts/test_*.ts` dosyalarıdır — **jest/vitest YOK, kurma** (Allowed Packages listesi). Sözleşme:

- Server'sız entegrasyon: service sınıfı + prisma doğrudan import edilir, HTTP yok; `npx tsx scripts/test_X.ts` ile tek tek koşar. **Toplu koşucu:** `npm test` = `tsx scripts/run-all-tests.ts` (tüm `test_*.ts`'i toplar).
- Fixture: seed master-data'sı business-key ile çözülür (**hardcoded UUID yazma** — reseed'de kırılır); üretilen veri `TEST-` prefix'li benzersiz kodlarla.
  - **⚠️ Business-key "var" demek, "KULLANILABİLİR" demek DEĞİL (2026-08-02).** Fabrika
    paneli master-data'yı pasife alabilir; `findFirst({ code: "X" })` kaydı yine bulur, test
    kurulumu geçer, ilk servis çağrısı "… pasif durumda" ile patlar. **Fason firma** bu yüzden
    seed'den ÇÖZÜLMEZ, `scripts/fixture-subcontractor.ts` ile test tarafından ÜRETİLİR
    (`ensureTestDyeHouse()` = eski `BOYER`, `ensureTestSander()` = eski `KESTEL`,
    `ensureTestKartela()` = eski `KARTELAAS`) — sabit `TEST-FASON-*` kodlu, idempotent
    `upsert`, kalıcı (paylaşılan olduğu için SİLİNMEZ; dosya başındaki gerekçeye bak).
  - **"Herhangi bir aktif firma bul" ÇÖZÜM DEĞİLDİR** — belirsizlik açık kırmızıdan
    tehlikelidir: yanlış kategorideki firma testi yanlış şeyi doğrulayarak GEÇİRİR.
    Filtresiz varyantı daha da kötüdür ve sahada ısırdı: dört test firmasını
    `subcontractorToCategory.findFirst({ categoryId: <appliesColor kategorisi> })` ile
    seçiyordu — `isActive` süzgeci YOK — ve tam da pasif `BOYER`'i buluyordu
    (`test_split_card_lineage`, `test_split_per_roll`, `test_wo_branch_redye`,
    `test_wo_branch_split`). Bu dosyalar `code:"BOYER"` aramadıkları için "BOYER'e bağlı
    testler" taramasına da YAKALANMIYORDU. Fason/kartela firması artık **yalnız** fixture
    yardımcısından çözülür; `requiredCategoryId` de aynı yardımcının döndürdüğü
    `categoryId`'den yazılır (tek kaynak → "firma bu kategoride değil" sapması imkânsız).
  - Aynı sınıf kırılganlık **`admin` / `123123`** için hâlâ AÇIK: `test_direct_ship_api`,
    `test_quickstart_dispatch_api`, `test_http_api`, `smoke_fason_http` HTTP login'i seed
    şifresine güveniyor; bu geliştirme DB'sinde şifre değiştirilmiş ve dördü de düşüyor.
    Doğru çözüm aynı desen: test kendi kullanıcısını yaratıp onunla login olsun
    (`test_direct_ship_api` "izinsiz kullanıcı" için bunu zaten yapıyor).
- Çıktı: ✅/❌ `check(label, ok)` sayaçları + sonda `=== Sonuç: N geçti, M başarısız ===` + `process.exit(fail > 0 ? 1 : 0)`.
- Cleanup `finally` bloğunda (test kendi yarattığını siler) + `prisma.$disconnect()`.
- **⚠️ ÇIKIŞ: `$disconnect()` TEK BAŞINA YETMEZ.** `lib/prisma.ts` havuzu
  `idleTimeoutMillis: 600_000` ile kuruyor → idle client handle'ı event loop'u 10 dk
  açık tutabilir ve script "bitti ama çıkmadı" durumunda kalır (koşucu 180sn'de
  SIGTERM'ler, test ZAMAN AŞIMI sayılır). İki geçerli kapanış: `process.exit(fail>0?1:0)`
  (çoğu test böyle) **ya da** `await prisma.$disconnect(); await pool.end();`. Uzun
  rapor basan scriptlerde `pool.end()` tercih edilir — `process.exit` boruya yazarken
  stdout'u kırpabilir. (2026-07-30: `test_qc2_idempotency.ts` CI'da tam bu yüzden
  180sn takıldı; yerelde görünmedi çünkü dev DB dolu olduğu için erken-dönüş yoluna
  hiç girilmiyordu.)
- **Ortamdaki veriye BAĞIMLI OLMA.** `findFirst()` ile "herhangi bir çuval/top" bulup
  üzerine test kurma — dev DB dolu olduğu için yerelde geçer, TEMİZ CI DB'sinde düşer.
  Fixture'ı test kendisi yaratır. (CI seed'i `npm run seed` + `npm run seed:fixtures`
  koşar: ilki temiz fabrika, ikincisi PATOS/MAVI/MUS-001 gibi iş fixture'ları.)

## Version Gotchas

- **Zod v4:** `z.record(z.string(), z.unknown())` — iki arg.
- **Express 5:** `req.params.id` bazen `as string` cast ister.
- **Prisma 7:** Şema değişikliği sonrası `npm run prisma:generate` zorunlu.
