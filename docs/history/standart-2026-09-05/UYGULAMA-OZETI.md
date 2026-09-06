# Kod Yazım Standardı — uygulama özeti (2026-09-05)

Planı Fable, uygulaması Opus. Girdi: `PROMPT.md` (bu dizinde) ve `kesif/` altındaki on ajanlık salt-okunur ölçüm. Bu dosya **ne yapıldığını ve neyin yapılmadığını** kaydeder; kuralların kendisi `docs/standart/` altındadır.

---

## 1 · Sonuç

| Teslimat | Durum |
|---|---|
| `docs/standart/` kural kitabı (9 dosya) | ✅ |
| Üç projede ölçülü ESLint + `lint-baseline.json` cırcırı | ✅ |
| main'deki kırmızıların yeşile çekilmesi | ✅ |
| Kimlik etiketli kod düzeltmeleri | ✅ |
| Reçeteler · CI · commit kapısı · `.claude/rules` | ✅ |
| Belge düzeltmeleri (ölçümle çürüyen cümleler) | ✅ |

## 2 · Önce kapılar: main'de duran kırmızılar

Standart yazmadan önce, standardı ölçecek kapıların kendisi onarıldı. Hepsi devralınan durumdu.

| Kimlik | Bulgu | Yapılan |
|---|---|---|
| Y-01 | CI'ın Electron tip adımı **hiçbir dosyayı derlemiyordu** (kök `tsconfig.json` `files:[]` + `references`, `-b` yok) ve main'de 9 tip hatası bir gündür duruyordu | Üç hata düzeltildi (`SackCustomerPage` import eksik · test dosyasında `EditorTarget` tipi ve indeksli erişim · `onConfirm` `Promise\|null` dönüyordu); CI adımı `npm run typecheck` yapıldı |
| Y-02 | Electron vitest main'de 7 test kırmızı | İki test-ortamı boşluğu stub'landı: Node 22'nin deneysel `localStorage`'ı jsdom'unkini gölgeliyor (zustand `persist` deposu `undefined`), ve jsdom `AbortSignal` ile Node/undici `Request` marka kontrolü uyuşmuyor (react-router gezinmesi sessizce iptal oluyordu). 208 dosya / 2266 test yeşil |
| Y-03 | Dev DB iki migration gerideyken 453 bekçinin **134'ü** kırmızı veriyor ve teşhis `TableDoesNotExist` yığını olarak bırakılıyordu | `run-all-tests.ts`e **migration durumu kapısı** (tam pakette koşar, tek testte atlanır, kaçış `SKIP_MIGRATION_GATE=1`) |
| Y-04 | Beş bekçi HTTP bölümünü sunucu yoksa atlıyor, özet satırındaki ", N atlandı" koşucu tarafından **yutuluyordu** | Koşucu atlanan kontrolü dosya satırında ve özette basıyor. Ölçüm: 8 dosyada **65 kontrol** sessizce atlanıyormuş |

Ardından 14 bekçi kırmızısı teşhis edildi ve **13'ü yeşile çekildi, 1'i görünür atlamaya çevrildi**:

| Sınıf | Adet | Kök neden |
|---|---|---|
| Kalıntı fixture | 3 | Fixture **kodu** damgalıyor ama **adı** damgalamıyordu; ad üzerinde 15 canlı UNIQUE sed var (`colors_nameFoldColor_key` gibi ifade-UNIQUE'ler şemada görünmez) → yarım kalan bir koşumdan sonra ikinci koşum P2002 ile çöküyordu |
| Bayat bekçi | 5 | Ölçü ortamdaki veriye yaslanmıştı ("ilk iki aktif özellik", "künyesi dolu herhangi bir müşteri", "DB genelinde deposuz top yok", karne servisinin tek süzgeci tarih) |
| Kod hatası | 3 | `mockPayload` iki katalog alanını doldurmuyordu · `db-guard.ts` izin listesi eski dev DB adını taşıyordu ve ikinci bir kapı aynı adı ÜRETİM sayıyordu · master-data birleştirme haritasında 7 FK eksikti (birleştirme onları sessizce atlıyor, satırlar tombstone kayda bakmaya devam ediyordu) |
| İş kararı → görünür atlama | 1 | `test_scrap_grade_label` §5/§5b fabrikanın canlı etiket **şablonunu** ölçüyordu; şablon verisi bu bekçinin sahibi olduğu bir şey değil → kırmızı yerine gerekçeli ATLANDI |

## 3 · ESLint ve lint tavanı

Karar ölçütü `docs/standart/README.md`'de: ihlal 0 → `error` · ≤15 → düzelt ve `error` · >15 → `warn` + tavan · ölçüm kuralı çürütüyorsa **kural yazılmaz ve gerekçe config başlığına yazılır**.

**Backend** — kapsam `src` iken `src scripts prisma` oldu (554 bekçi dosyası ve seed'ler bugüne dek **hiç** lint edilmiyordu; aynı boşluk tsc'de 87 tip hatası biriktirmişti).
- Yeni `error` yasakları: `kind === "PROCESS_QC"` (boğaz ikiz) · `!== "mobile"` · `body.code` okuma · `applied_steps_count` · çıplak `DATE_TRUNC` · `now() AT TIME ZONE 'UTC'` · Türkçe tanımlayıcı · `naming-convention` · `no-explicit-any` · `no-floating-promises` (tip bilgili) · `no-require-imports` · ölü `eslint-disable`.
- ⚠️ Ölçüm, **tanımlı ama hiç koşmayan** bir kural buldu: `BARE_DATE_TRUNC` yasak listesine hiç eklenmemişti; kök CLAUDE.md yasağı yazıyordu, mekanik kapı ölüydü.
- Düzeltilen ihlaller: 11 `now() AT TIME ZONE 'UTC'` yazımı düz `now()` + gerekçeli `-- tz-ok:` işaretine çevrildi (kolon timestamptz, oturum tz UTC; eşdeğerlik DB'de ölçüldü — eski sarmal doğruluğu oturum saat dilimine bağlıyordu), 8 Türkçe tanımlayıcı, 4 `'Europe/Istanbul'` literali, 2 `W`/`H` parametresi, 14 ölü direktif.
- Reddedilen kurallar ve gerekçeleri config başlığında: `toLocaleUpperCase("tr")` · `z.enum([...])` Prisma aynası · `findUnique→if→update` · backend `no-console`.

**Cırcır mekanizması** — `scripts/check-lint-baseline.mjs`: `eslint -f json` çıktısını kural bazında sayar, `<proje>/lint-baseline.json` tavanıyla kıyaslar, tavan **yalnız düşer**. Körlük zemini var (kapsam daralırsa "0 ihlal" yeşili değil kırmızı verir). Commit kapısında ve CI'da koşar.

## 4 · Kod düzeltmeleri

Her düzeltme kendi bekçisiyle ve **negatif sondayla** doğrulandı (kasten bozuldu, kırmızı ölçüldü, geri alındı).

### Eşzamanlılık ve güvenlik

| Kimlik | Yapılan |
|---|---|
| **İ-10** | Kilit uzayı çakışması giderildi: `CODE_UNIQUE_LOCK_NS` 8026 → **8029**, `MERGE_LOCK_NS` 8027 → **8030**. Envanter `period-guard.helper.ts` başlığında 10 satıra tamamlandı ve makine-okunur biçime çevrildi; 7 dosyadaki **kopya envanter listeleri** tek-kaynak işaretçisine indirildi (üçü zaten yanlıştı). Yeni bekçi `test_advisory_lock_namespaces.ts` (14 kontrol, 6 negatif sonda): tek sahiplik · envanter↔kod iki yönlü · çıplak sayıyla kilit yasağı · kopya liste seddi · körlük zemini |
| **İ-11** | `traveler-card.service.reprint` check-then-act → atomik claim (`updateMany where {id, status, version}` + `count===0 → 409`). Asıl zarar arşiv `upsert`'inde açığa çıkıyordu: iki eşzamanlı baskı tek `[docType, sourceId, version]` satırına çöküp birincinin içeriğini siliyordu. **Yarış sondası** elle açık tutulan tx + `FOR NO KEY UPDATE` ile kuruldu |
| **İ-12** | `reconcileRoleTemplates` (boot uzlaştırması) üç modeli tx'siz yazıyordu → `reconcileRoleTemplatesTx(tx)` |
| **İ-13** | `subcontractor.updateInstruction` tx dışı check-then-act → tek tx + atomik claim (P4 kilit koşulları claim WHERE'ine taşındı) |
| **İ-26** | Boğaz ikiz (`stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE`) artık AST bekçili: aynı dosyada mı, yan yana mı, `satisfies` ile mi (3 negatif sonda) |
| **İ-04** | `requireFinanceEnabled` (30 mount) kardeş kapıların `details.code:"MODULE_DISABLED"` sözleşmesini taşımıyordu; eklendi |
| **İ-14** | **Güvenlik:** İstasyon Yetkinlikleri ekranında yazma yüzeyi izin kapısızdı (route `station:read` ile açılıyordu) → `station:write` kapısı iki noktada + bekçi (zemin ölçümü dahil: kapı her koşulda kapalı olsaydı test vakumen yeşil kalırdı) |

### Panel ve tablet

| Kimlik | Yapılan |
|---|---|
| İ-15 | En yeni 4 çift-toast ihlali düzeltildi (kalan 22 baseline'da) |
| İ-16 | Bulgunun **adresi yanlıştı, sınıfı doğruydu**: `Customers/schema.ts` `max(50)`'nin aynası `Customer.code` değil `CustomerBranch.code`; sınıfı mekanikleştiren `schema-varchar-mirror.test.ts` yazıldı |
| İ-17 | 8 rapor hub'ı ortak iskelete (`PageShell`/`PageBody`) çekildi |
| İ-18 | 3 `service.ts`ten React hook'ları `hooks.ts`e taşındı |
| İ-19 | Gerekçesiz `as any` kaldırıldı, tip düzeltildi |
| **İ-20** | Okutma geri bildirimi üç ekranda `signalScan`e çevrildi. Sahadaki asıl zarar `KursunQcScreen`'de bulundu: "Kart zaten açık" dalı hem sessizdi hem sinyalsizdi. Yeni AST bekçisi `scan-haptics.guard.test.ts` |
| İ-21 | Kuyruksuz (online-only) istasyon mutasyonlarına gerekçe satırları |
| İ-22 | Ham RN `<Modal` kullanımları `AppModal`a çekildi ya da gerekçelendirildi |
| İ-23 | `ReasonPresetPicker` tek bileşene toplandı |

Mobil değişikliklerin tamamı saf JS → **OTA ile gider, APK gerekmez**.

### Şema (üç additive migration)

| Kimlik | Yapılan |
|---|---|
| **M-01** | 5 index'siz domain FK kapatıldı; `NOT NULL` olan düz index, nullable ve null-yoğun 4 kolon **kısmi** index aldı (ev emsali korundu). Migration başlığında prova notu var. ⚠️ 2026-09-05 düzeltmesi: migration'lar `kur.ps1`'de pm2 durdurulduktan SONRA koşar ([4/9] → [7/9]), yani kilit kimseyi bloklamaz; ölçülmeyen şey saha kesintisi değil kurulum penceresinin uzaması |
| **M-05** | `SackTag.name` için yumuşak kapılı UNIQUE sed (`nameFold` emsali: mükerrer varsa NOTICE + atla); uygulama guard'ı kalır, mesajı o verir |
| **M-02** | 10 model tek tek sınıflandırıldı. Yalnız **1'i** gerçek unutulmaydı (`ImportRun` → `updatedAt` eklendi); kalan 9 append-only/pivot olarak `///` gerekçesiyle şemaya yazıldı. **Karar: 10 tabloya kolon eklemek yerine istisnayı belgelemek** |

### Kural kitabından doğan iki mekanik düzeltme (turun sonunda)

| Kimlik | Yapılan |
|---|---|
| **İ-02** | Transaction alan 13 fonksiyon `*Tx` soneğine çevrildi (`recomputeOrderStatus` → `recomputeOrderStatusTx` gibi); 45 dosya, iki tanesi bilinçli DIŞARIDA bırakıldı — `batchLoadAliases` ve `resolveSupplierParty` **esnek istemci** alır (tx ya da prisma), onlarda sonek yanlış olurdu. Canlı tasarım belgelerindeki atıflar da güncellendi |
| **İ-05** | İki yazma ucu gövdeyi ham cast ile okuyordu (`body.kind as never`) → Zod şemasına bağlandı; `kind` tek kaynaktan (`labelKindSchema`) türer. ⚠️ `.strict()` bilerek konmadı: bu uçları sahadaki tablet ve panel zaten çağırıyor, bilinmeyen anahtarı 400'e çevirmek eski istemciyi kırardı |

### Kütüphane

Ölü paketler üç kanaldan yeniden doğrulanarak kaldırıldı (Electron: `@radix-ui/react-avatar`, `react-scroll-area`, `react-switch`, `@fontsource/roboto`, `electron-window-state` ve diğerleri). **Kaldırılmayanlar gerekçeli:** `react-native-ble-plx` CANLI çıktı (`bluetooth.service.ts` statik import + `app.json` config plugin) — keşif "ölü" demişti, üç kanal ölçümü çürüttü. Yeni bekçi `test_dependency_contract.ts`: sabit sürüm koruması · backend CommonJS invariantı · `KUTUPHANELER.md` tablosu ↔ `package.json` iki yönlü fark.

## 5 · Reçeteler, CI ve harness

- **`docs/RECETELER.md`** — yeni reçeteler: yeni servis metodu (13 adım) · yeni Prisma modeli (15 adım, en büyük boşluktu) · yeni bağımlılık · ölü paket kaldırma · yeni ESLint kuralı.
- **CI** (`.github/workflows/ci.yml`) — emekli `adnansahin` dalı kaldırıldı; Electron tip adımı gerçek `npm run typecheck` oldu; üç job'a **lint tavanı** adımı eklendi; **mobil job'ı** eklendi (lint + tip + jest).
- **Commit kapısı** — `.githooks/pre-commit` + `scripts/hooks/pre-commit.mjs` (zero-dep, husky yok). Değişene orantılı koşar: o alt projede tip + lint + lint tavanı + hızlı test paketi; migration/bekçi dokunulduysa hijyen, `.md` dokunulduysa doküman kapısı. Kurulum `node scripts/hooks-kur.mjs`, kaçış `TEKSERP_HOOK_SKIP=1`.
- **Tek kaynak** — Claude'un Bash hook'u artık kendi adım listesini taşımıyor, aynı `pre-commit.mjs`i çağırıyor ve git kapısı kuruluysa susuyor (adımlar iki kez koşmasın).
- **`.claude/rules/`** — dört ince işaretçi (`backend-standart`, `electron-standart`, `mobil-standart`, `kutuphane`), hepsi `paths:` frontmatter'lı (yolsuz kural dosyası her oturumda yüklenir, yasak).
- **`scripts/check-docs.mjs`** — `docs/standart/*.md` için 24 KB tavanı eklendi.

## 6 · Belge düzeltmeleri — ölçümle çürüyen cümleler

| Dosya | Eski cümle | Ölçüm |
|---|---|---|
| kök `CLAUDE.md` | "clientToken 16 model" | 15 (şemada sayıldı) |
| kök `CLAUDE.md` | Kilit uzayı envanteri 7 uzay + "merge 8027'yi paylaşıyor" | Kodda **10** sabit ve **İKİ** çakışma (8026 ve 8027); numaralandırma yeniden verildi |
| kök `CLAUDE.md` | "`npm test` saatler sürer" | **6 dk 28 sn** (453 dosya) |
| `Teks-Erp/CLAUDE.md` | "Controller'sız uç bilinçli istisnadır" | 80 route dosyasının 45'i, 672 handler'ın 323'ü controller'sız — **norm** |
| `Teks-Erp/CLAUDE.md` | Şema-dışı nesne envanteri "beş liste" | **dokuz** liste |
| `Teks-Erp/CLAUDE.md` | Modül kapısı listesi | En çok kullanılan kapı (`requireFinanceEnabled`, 30 mount) listede yoktu |
| `Teks-Erp/CLAUDE.md` | "Sadece izinli liste; alternatif tanıtma" | Politika **kayıtlı kararla açık** (kullanıcı kararı) |
| `Electron/CLAUDE.md` | "`schema.ts` zod backend'le uyumlu" | Backend master-data CRUD'da Zod **yok** (`BaseController` gövdeyi doğrudan geçirir) → panel şeması TEK kapı |
| `Electron/CLAUDE.md` | stryker/e2e komut listesinde kapı gibi duruyordu | Stryker CI'da hiç koşmuyor, e2e `continue-on-error` |
| `mobil/CLAUDE.md` | "font ≥16sp" | 1.163 `fontSize` bildiriminin %83'ü 16 altında; kural ölçülebilir hâle getirildi |
| `mobil/CLAUDE.md` | "ekranlar `Haptics`i doğrudan çağırmaz" | 11 dosya çağırıyor; o ekranlarda "mükerrer" sinyali ve ses ayarı çalışmıyor |
| `mobil/CLAUDE.md` | "`react-native-vector-icons` peer artığı" | Paper'ın peer'ı **değil** ve kullanılmıyor |

## 7 · Bilinen borç (bilinçli, kapsam dışı)

`docs/standart/README.md` § "Bu standardın kapsamı dışında" ile aynı liste; ek olarak bu turda ortaya çıkanlar:

- **Bekçi paketi paralelleştirmesi şema izolasyonuyla ÇÖZÜLMEZ** — `pg_advisory_xact_lock` veritabanı kapsamlıdır; DB-per-worker gerekir. Bu tur ayrıca şunu ölçtü: paket koşarken **başka bir süreç aynı dev DB'ye yazarsa** ilgisiz bir bekçi kırmızı verir (tam koşumda bir kez yaşandı, tek başına yeşil).
- ~~Swagger'da ~60 belgesiz uç ve `test_swagger_spec` zemininin ısırmaması.~~ **Kapatma turunda kapandı** (aşağıda §12): bekçi uç↔`@openapi` eşlemesine çevrildi, 117 devralınan belgesiz uç `Teks-Erp/swagger-belgesiz-baseline.json`da donduruldu. Toplu belgeleme hâlâ ayrı iş.
- Route katmanından 10 audit çağrısı (3 dosya) — kural yazıldı, düzeltme ayrı iş.
- Backend'de yapılandırılmış logger yok (137 `console`); mobilde şema doğrulama katmanı yok (`zod` bağımlılığı bile yok).
- 4 tablet ucu `clientToken` taşımıyor (SubcontractorDispatch · KartelaDispatch · KartelaReceipt · StockCount) — kolon + replay + APK ister.

## 8 · Kabul ölçütleri

⚠️ Bu tablo 2026-09-05 kapatma turunda **yeniden ölçüldü ve düşürüldü**: ilk hâli on ölçütün onunu da ✅ sayıyordu. Kendi kabul tablosunu şişiren bir rapor, raporun tamamına olan güveni düşürür — ölçüt kısmen karşılandıysa ⚠, karşılanmadıysa ❌ yazılır.

| # | Ölçüt | Durum | Gerekçe (ölçüm) |
|---|---|---|---|
| 1 | main-kaynaklı kırmızılar yeşil | ✅ | Electron tip 0 hata · vitest 211 dosya/2283 test · backend 455/455 (temiz koşum, 447 sn). Kayıt: paket koşarken aynı dev DB'ye başka süreç yazarsa ilgisiz bir bekçi kırmızı verir (§7). |
| 2 | `docs/standart/` 9 dosya, etiketli + kanıtlı, ≤24 KB | ⚠ | 267 kuralın hepsi `zorlama:` etiketli, `bekçi:` etiketlerinin işaret ettiği dosyaların hepsi mevcut, `check-docs` rc 0. Ama **etiketin doğruluğu tek tek denetlenmedi**: kapatma turu iki sapma buldu — `[BE-40]`ın kapısı yoktu (kuruldu), `[MO-40]`ın kanıtı bayat ("8 ihlal"; yeniden ölçümde 0, kural `allow:[warn,error]` ile yazıldı). |
| 3 | Üç projede lint yeşil + `lint-baseline.json` + tavan kapısı | ✅ | Tavan dosyalarından okundu: backend 442 (3 kural/1026 dosya) · Electron 666 (7 kural/1396) · mobil 2.783 (10 kural/399); üçünde de 0 error. |
| 4 | Kimliklerin akıbeti raporda | ✅ | Kapatma turunda eklendi: §10 altmış kimliğin tamamını (İ/M/B/K/E/Y/ES/BELİRSİZ) durum + tek cümleyle listeler. **İlk hâlde ❌ idi**: §4 ve §7 kimliklerin ~yarısını anıyordu. |
| 5 | Reçeteler + `.claude/rules` + CLAUDE.md bağları | ⚠ | Reçeteler ve dört `.claude/rules` işaretçisi yerinde. **K-05 açık**: `docs/KOD-KURALLARI.md` "mekanik zorlananlar" listesi hâlâ kütüphane sınıfından kural/bekçi taşımıyor (`test_dependency_contract` o dosyada 0 vuruş) — plan bunu "K-03 ile kapanır" saymıştı, kapanmamış. |
| 6 | CI YAML geçerli, `adnansahin` yok, mobil job var | ✅ | `on.push.branches: [main]` (gerekçe yorumuyla); job'lar: docs · backend · load-test · electron · mobile. |
| 7 | Migration'lar dev'de uygulandı, kapılar yeşil | ⚠ | Üç additive migration dev'e uygulandı, `test_db_invariants` · `test_schema_drift` · `check-migrations` yeşil. Ama **[DB-29b] süre ölçümü koşulmadı** — ama bu bir engel değil: dağıtım sırası ölçüldü, migration uygulama DURMUŞKEN koşuyor. Ölçülmeyen şey kurulum penceresinin kaç saniye uzadığıdır. |
| 8 | Paket kaldırma sonrası üç proje yeşil | ⚠ | Taban ölçümü kaldırmadan ÖNCE alındı, üç proje kaldırma sonrası yeşil. Ama kaldırma **tam değil**: 3 mobil ölü paket native değişiklik olduğu için sonraki APK'ya bırakıldı, `react-native-ble-plx` ise ölçümle CANLI çıktı (keşif iddiası çürüdü). |
| 9 | Dokunulan alanların bekçileri yeşil | ⚠ | §4'teki her satırın bekçisi ve negatif sondası var. Ama §4 iki kimliği "yapıldı" sayıyordu, ölçüm dosyası "kismen-yapildi" diyor: **İ-21** (13 istasyon mutasyonunun 8'ine gerekçe yazıldı) ve **İ-23** (iki elle çizilen seçiciden biri çevrildi, `TamburScreen` ReasonStep açık). |
| 10 | Faz başına commit + `UYGULAMA-OZETI.md` | ❌ | Plan sekiz faz tanımlıyordu; git'te iki commit var: `6afa188c` (kapılar) + `cdcb73f4` (turun tamamı). Faz başına commit yapılmadı; geri alma birimi tek dev commit. |

## 8b · Eleştirmen turundan sonra kapatılanlar

Bitmiş sayılan iş bir **tamlık eleştirmenine** verildi; ölçerek 10 zorunlu bulgu çıkardı ve hepsi kapatıldı:

- **Sondasız kapılar** — 12 backend ESLint kuralının negatif sondası koşuldu ve kaydedildi; `check-migrations` GATE 5, `check-lint-baseline` ve commit kapısının kendisi ilk kez **kırmızı görüldü** (dört sonda, hepsi geri alındı). Ölçüm bir yan bulgu da verdi: `warn` seviyeli kurallar için düz `eslint` çıkış kodu 0 döner — o kuralların gerçek kapısı `check-lint-baseline`'dır ve etiketler bunu zaten doğru söylüyordu.
- **Yalan zorlama etiketleri** — `max-params` (error↔warn), mobil Türkçe-tanımlayıcı kuralının adı, iki yerde 400↔300 tavan sapması, altı yanlış bekçi bağı ve bayat `dosya:satır` atıfları düzeltildi. `DATE_TRUNC` sınıfının ikinci örneği de bulundu: config başlığı bekçi kapsamında `naming-convention` koştuğunu söylüyordu, kural o bloğa hiç yazılmamıştı.
- **Belge çelişkileri** — `docs/KOD-KURALLARI.md` yeni dört kademeli ESLint ölçütüne bağlandı; `BEKCI-HARITASI.md` bu turda doğan altı bekçiyi ve gerçek dosya sayısını aldı; `GELISTIRME-DONGUSU.md`'ye commit kapısı adımı girdi.
- **Düşen işler** — Swagger kapsam bekçisi yazıldı (uç ↔ `@openapi` eşlemesi + devralınan allowlist), migration reçetesi çekirdek adımlara indi, soft-delete istisna listesi ölçülen sınıflara göre güncellendi.
- **İ-25 (eleştirmenin bulduğu canlı sapma)** — `NotificationBell.tsx` izin ölçümünü üç dallı `includes` zinciriyle yapıyordu; tek yükleme (`matchesPermission`) çevrildi. Kural yazılmış ama ihlal düzeltilmemişti.
- **Ortam bağımlı bir bekçi daha** — `test_subcontract_scorecard` "açık sevk listede" kontrolü, raporun **en eski 25** açık sevki döndürmesine karşın 2096 tarihli bir fixture arıyordu; dev DB'de 260 açık sevk olunca kırmızıya düştü. Rapor davranışı doğru (açık sevk listesi dönem süzgecinden geçmez); kontrol koşullu ATLAMAYA çevrildi ve listenin kendi sözleşmesini (sıralı + 25 tavanı) ölçen iki kontrol eklendi.

## 9 · Bu turun kendi dersleri

1. **Kapıyı kurmadan kuralı yazma.** Bu turda yazılan hemen her kural zaten uygulanıyordu; eksik olan yazılı karşılık ve mekanik kapıydı. Buna karşılık, yazılı olup **hiç koşmayan** bir kural da bulundu (`DATE_TRUNC`) — kural metni bir kapı olduğunu KANITLAMAZ.
2. **Damga kaydın tamamına konur.** Fixture'ın kodunu damgalayıp adını damgalamamak, ad üzerindeki ifade-UNIQUE sedleri yüzünden ikinci koşumu düşürür; ve ifade-UNIQUE şemada görünmez, kanonik kaynak `pg_indexes` / `test_db_invariants`.
3. **"Yeşil" ile "kapsandı" ayrı şeylerdir.** Koşucu atlanan kontrolü basmaya başlayınca 65 ölçülmemiş kontrol görünür oldu.
4. **Yorumu boyuta saymak, en iyi kalıbı cezalandırır.** `skipComments` açık ölçüm 145 → 90 dosya, 391 → 305 fonksiyon: aradaki fark, kararını kodun yanına yazan dosyalardı.

---

## 10 · Kimlik akıbet tablosu (plan §2'nin tamamı)

Plan altmış kimlik tanımladı. Durum sözlüğü: **yapıldı** (kod/şema değişti) · **kurala alındı** (davranış değişmedi, `docs/standart/` altında kural + devralınan tavan) · **listeye alındı** (bilinen borç, gerekçeli) · **kısmen** (bir bölümü yapıldı, kalanı yazılı) · **düştü** (plandan çıktı) · **iddia çürüdü** (ölçüm bulguyu yanlışladı). Kaynak: `olcum/*.json` ve `PROMPT.md` §2.

### Backend servis / katman (İ-01…İ-09)

| Kimlik | Durum | Tek cümle |
|---|---|---|
| İ-01 | kurala alındı | `Promise<ApiResponse<unknown>>` yeni kodda yasak ([BE-25]); 199 devralınan imza ölçüldü, tavansız kayıt olarak duruyor. |
| İ-02 | yapıldı | Tx alan 13 fonksiyon `*Tx` soneğine çevrildi (45 dosya); 2'si bilinçli dışarıda — `batchLoadAliases` ve `resolveSupplierParty` esnek istemci alır. |
| İ-03 | kurala alındı | Zarfı SERVİS kurar ([BE-18]), `reportEnvelope` tek meşru istisna ([BE-19]); 106 inline route + 36 controller satırı baseline'da. |
| İ-04 | yapıldı | `requireFinanceEnabled` (30 mount) kardeş kapıların `details.code:"MODULE_DISABLED"` sözleşmesini aldı. |
| İ-05 | yapıldı | 4 Zod'suz gövdenin 2'si (`peripheral.routes.ts:133,184`) şemaya bağlandı; kalan 2 `base.controller.ts:97,109` bilinçli — master-data CRUD'da tek kapı panel şemasıdır ([B-08]). |
| İ-06 | kurala alındı | Yeni şema `.strict()` ile yazılır, devralınana sonradan EKLENMEZ ([BE-38]); 158 şema baseline'da. |
| İ-07 | kurala alındı | Route/controller'dan `AuditService` çağrılmaz ([BE-05]); 10 devralınan çağrı (3 dosya) listede, düzeltme ayrı iş. |
| İ-08 | kurala alındı | Servis Express `Request` tipi almaz ([BE-07]); 22 imza / 11 dosya devralınan. |
| İ-09 | **düştü → kapatma turunda yapıldı** | `test_swagger_spec.ts` uç↔`@openapi` eşlemesine çevrildi; 117 belgesiz uç donduruldu, 3 hayalet blok silindi (§12). |

### Eşzamanlılık ve güvenlik (İ-10…İ-14, İ-26)

| Kimlik | Durum | Tek cümle |
|---|---|---|
| İ-10 | yapıldı | İki kilit uzayı çakışması giderildi (8026→8029, 8027→8030), envanter 10 satıra tamamlandı, yeni bekçi `test_advisory_lock_namespaces.ts`. |
| İ-11 | yapıldı | `traveler-card.reprint` check-then-act → atomik claim; asıl zarar arşiv `upsert`'inde açığa çıktı, yarış sondasıyla doğrulandı. |
| İ-12 | yapıldı | `reconcileRoleTemplates` üç modeli tx'siz yazıyordu → `reconcileRoleTemplatesTx(tx)`. |
| İ-13 | yapıldı | `subcontractor.updateInstruction` tek tx + atomik claim (guard koşulları claim WHERE'ine taşındı). |
| İ-14 | yapıldı | **Güvenlik:** İstasyon Yetkinlikleri yazma yüzeyi `station:write` kapısına alındı (iki nokta) + bekçi, zemin ölçümü dahil. |
| İ-26 | yapıldı | Boğaz ikiz (`stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE`) AST bekçili: aynı dosya · yan yana · `satisfies` (3 negatif sonda). |

### Panel (İ-15…İ-19, İ-25)

| Kimlik | Durum | Tek cümle |
|---|---|---|
| İ-15 | kısmen (tavan MEŞRU) | 26 çift-toast ölçüldü; plan ölçütü ">15 → `warn` + tavan" olduğu için en yeni 4'ü düzeltildi, 22'si `yerel/mutation-onerror-toast: 22` tavanında dondu. |
| İ-16 | iddia çürüdü + sınıf mekanikleşti | `Customers/schema.ts:21 max(50)`ın aynası `Customer.code` değil `CustomerBranch.code` (VarChar 50) — bulgu YANLIŞ POZİTİF; sınıfı ölçen `schema-varchar-mirror.test.ts` yazıldı. |
| İ-17 | yapıldı | 8 rapor hub'ı ortak `PageShell`/`PageBody` iskeletine çekildi (tek dosya değişti). |
| İ-18 | yapıldı | Üç `service.ts`ten React hook'ları `hooks.ts`e taşındı. |
| İ-19 | yapıldı | Gerekçesiz `as any` ve ölü `eslint-disable` kaldırıldı, tip düzeltildi. |
| İ-25 | düştü → kapatma turunda düzeltildi | `NotificationBell.tsx`in üç dallı `includes` zinciri `matchesPermission(permissions, "admin:settings")`e çevrildi (kapatma turunun panel ajanı; çalışma ağacında). |

### Tablet (İ-20…İ-24)

| Kimlik | Durum | Tek cümle |
|---|---|---|
| İ-20 | yapıldı | Üç ekran `signalScan`e çevrildi (asıl zarar `KursunQcScreen`in sessiz "Kart zaten açık" dalıydı); AST bekçisi `scan-haptics.guard.test.ts`, kalan 6 dosya bekçinin DEVRALINAN listesinde (iki yönlü). |
| İ-21 | kısmen | Kapsamdaki 4 dosyanın 13 istasyon mutasyonundan 8'ine online-only gerekçesi yazıldı (2'sinde zaten vardı); ⚠️ `MOBIL.md` borç satırındaki "11 gerekçesiz" bu düzeltmeden ÖNCEKİ sayıdır. |
| İ-22 | yapıldı (ölçüm düzeltmesiyle) | 3 ham `<Modal` iddiasının 2'si yanlış pozitif (`<ModalTextInput` alt dizisi); gerçek tek yer `AppMenu.tsx:168` ve ona gerekçeli muafiyet yazıldı (çapa konumu `AppModal`ın üç yerleşimiyle ifade edilemez). |
| İ-23 | kısmen | `FasonKabulScreen` ortak `ReasonPresetPicker`e çevrildi; `TamburScreen` ReasonStep karar bekliyor. |
| İ-24 | kurala alındı | Yeni kodda `exhaustive-deps` bastırılmaz ([MO-41]); 23 canlı bastırma devralınan, 3 ölü direktif silindi. |

### Şema (M-01…M-05)

| Kimlik | Durum | Tek cümle |
|---|---|---|
| M-01 | yapıldı | 5 index'siz domain FK kapatıldı (NOT NULL olan düz, null-yoğun 4'ü kısmi index); ⚠️ canlı maliyet ÖLÇÜLMEDİ, migration başlığında prova notu var. |
| M-02 | yapıldı (karar) | 10 model tek tek sınıflandı: 1 gerçek unutulma (`ImportRun` → `updatedAt`), 9'u append-only/pivot olarak `///` gerekçesiyle şemada donduruldu. |
| M-03 | listeye alındı | `system_logs.newData ->> 'event'` sorgusu GIN'siz (24.482 satır) — `VERITABANI.md` §12 bilinen boşluk, vardiya dışı iş. |
| M-04 | yapıldı (kapatma turunda tamamlandı) | Sekiz hard delete sitesinin sekizi de meşru çıktı ve dört sınıfa ayrıldı (`VERITABANI.md` §9); kök `CLAUDE.md` listesi bu turda o dört sınıfa göre yeniden yazıldı. |
| M-05 | yapıldı | `SackTag.name` için yumuşak kapılı UNIQUE sed (`nameFold` emsali; mükerrer varsa NOTICE + atla). |

### Belge ve reçete (B-01…B-11)

| Kimlik | Durum | Tek cümle |
|---|---|---|
| B-01 | yapıldı | "Yeni servis metodu" reçetesi 13 adım olarak yazıldı (advisory kilit adımı eklendi). |
| B-02 | yapıldı | `Teks-Erp/CLAUDE.md`in "controller'sız uç bilinçli istisnadır" cümlesi düzeltildi: 672 handler'ın 323'ü inline, NORM. |
| B-03 | yapıldı (iki parça) | "Yeni Prisma modeli" reçetesi (15 adım) yazıldı; **B-03/2** kapatma turunda: "yeni migration" reçetesi 23 → **13 çekirdek adım** + "koşula bağlı ek adımlar" tablosu. |
| B-04 | yapıldı | Şema-dışı nesne envanteri "beş liste" → **dokuz** liste (kanonik sayı bekçinin kendisi). |
| B-05 | yapıldı | "Elle migration SQL'i İDEMPOTENT yazılır" kuralı yazıldı ([DB-23]) ve reçetenin 3. adımı oldu. |
| B-06 | yapıldı | İki istisna kayda geçti: `PermissionCategory` küçük-harf enum ([DB-16]) · `endpoint_latency_daily` tekil `@@map` ([DB-02]) — tekrarlanmaz. |
| B-07 | yapıldı | `clientToken` 16 → **15** model; "çapraz uzay çifti yok" → var; "isolationLevel kullanılmıyor" → 1 salt-okuma istisnası ([ES-01]). |
| B-08 | yapıldı | `Electron/CLAUDE.md`: backend master-data CRUD'da Zod YOK, panel şeması TEK kapıdır (Prisma `VarChar` aynası). |
| B-09 | yapıldı | Electron boyut kuralı bekçilendi: `max-lines` 300 + `src/pages/**/*Page.tsx`/`*FormDialog.tsx` için 200 override, ikisi de tavanla. |
| B-10 | yapıldı | `mobil/CLAUDE.md` "font ≥16sp" ölçüme çekildi (1.163 bildirimin %83'ü 16 altı); "test/ dizini" → yan yana test. |
| B-11 | yapıldı | "`npm test` saatler sürer" → **6 dk 28 sn** (453 dosya); üç belgede düzeltildi. |

### Kütüphane (K-01…K-05)

| Kimlik | Durum | Tek cümle |
|---|---|---|
| K-01 | kısmen | Electron ölü paketleri üç kanaldan doğrulanarak kaldırıldı; 3 mobil ölü paket native değişiklik olduğu için sonraki APK'ya bırakıldı. |
| K-01/ble | iddia çürüdü | `react-native-ble-plx` "ölü" sanılıyordu; `bluetooth.service.ts` statik import + `app.json` config plugin ile CANLI çıktı, kaldırılmadı. |
| K-02 | yapıldı | "importFiles: 0 ≠ ölü" — üç kanallı ölü paket teşhisi `KUTUPHANELER.md` §6'ya ve reçeteye yazıldı. |
| K-03 | yapıldı | `test_dependency_contract.ts`: sabit sürüm koruması · backend CommonJS invariantı · tablo ↔ `package.json` iki yönlü fark (5 negatif sonda). |
| K-04 | listeye alındı | Araç zinciri drifti (TS 6.0/5.6/5.9 · ESLint 10/9/9) kayda geçti; **hizalama bu turda YAPILMADI**, Electron'un tilde gerekçesi önce yazılmalı. |
| K-05 | **AÇIK** | `docs/KOD-KURALLARI.md` "mekanik zorlananlar" listesi hâlâ kütüphane sınıfından kural taşımıyor (`test_dependency_contract` o dosyada 0 vuruş); plan bunu K-03 ile kapanmış saymıştı. |

### ESLint kapsamı (E-01…E-05)

| Kimlik | Durum | Tek cümle |
|---|---|---|
| E-01 | yapıldı | Backend lint kapsamı `src` → `src scripts prisma` (554 bekçi dosyası ve seed'ler hiç lint edilmiyordu). |
| E-02 | yapıldı | Tip bilgili parser (`parserOptions.projectService`) üç projede, yalnız gereken bloklarda; mobilde maliyeti ölçüldü (+3,3 sn). |
| E-03 | yapıldı | `reportUnusedDisableDirectives: "error"` üç projede; backend'de 14 ölü direktif silindi, taşıdıkları bilgi düz yoruma çevrildi. |
| E-04 | yapıldı | Mobil CI ve hook aynı komutu koşuyor (`eslint .`, `expo lint` değil); `scripts/lib/feed.cjs` yeşil. |
| E-05 | yapıldı | `scripts/check-lint-baseline.mjs` (kural bazında sayım, tavan yalnız düşer, körlük zemini) + commit kapısı + CI adımı + reçete. |

### Kapılar (Y-01…Y-04) ve eşzamanlılık boşlukları (ES-01…ES-03) · BELİRSİZ-01

| Kimlik | Durum | Tek cümle |
|---|---|---|
| Y-01 | yapıldı | CI'ın Electron tip adımı hiçbir dosyayı derlemiyordu → `npm run typecheck`; main'de bir gündür duran 9 tip hatası kapandı. |
| Y-02 | yapıldı | Electron vitest kırmızıları: Node 22'nin deneysel `localStorage`'ı ve jsdom `AbortSignal` marka uyuşmazlığı stub'landı. |
| Y-03 | yapıldı | `run-all-tests.ts`e migration durumu kapısı (tam pakette koşar, kaçış `SKIP_MIGRATION_GATE=1`). |
| Y-04 | yapıldı | Atlanan HTTP kontrolleri artık dosya satırında ve özette basılıyor — 8 dosyada 65 kontrol sessizce atlanıyormuş. |
| ES-01 | listeye alındı | "Ölü replay" yüklemi 15 token'lı modelin 3'ünde; 12 ucun her birinde "ölü" tanımı ayrı, tek turda ölçülemedi (`ESZAMANLILIK.md` AÇIK-1). |
| ES-02 | listeye alındı | 4 tablet ucu `clientToken`'sız — kolon + replay + istemci token gönderimi APK ister (AÇIK-2). |
| ES-03 | listeye alındı | 36 tx-dışı `findUnique→if→update` sitesi (yönetim/master-data), toplu kampanya yok; yeni kodda atomik claim zorunlu (AÇIK-3). |
| BELİRSİZ-01 | iddia çürüdü | Electron `pages/` altındaki 296 `.filter(` ölçüldü: **cursor'lu hiçbir listede istemci süzmesi yok**. |

## 11 · ESLint karar tablosu

Ölçüt (`docs/standart/README.md`): ihlal **0 → `error`** · **≤15 → düzelt ve `error`** · **>15 → `warn` + tavan** · **ölçüm kuralı çürütüyorsa yazılmaz**, gerekçe config başlığına. "Sonda" sütunu negatif sondanın (kasıtlı ihlal → lint kırmızı → geri al) sonucudur. Kaynak: `olcum/eslint-*.json` ve `olcum/eslint-*-sonuc.json`.

| Kural | Backend | Electron | mobil | Karar | Sonda |
|---|---|---|---|---|---|
| `kind === "PROCESS_QC"` (helper dışı) | 2 | – | – | `error`; 2 fixture çağrısı gerekçeli disable (ikisi de boğaz-ikizin sorusunu SORMUYOR) | kırmızı |
| `!== "mobile"` · `applied_steps_count` | 0 | – | – | `error` | kırmızı |
| `body.code` okuma | 2 | – | – | `error`; iki okuma tek satıra indirilip oraya disable | kırmızı |
| Çıplak `DATE_TRUNC` (time.ts dışı) | 0 | – | – | `error` — ⚠️ kural **tanımlıydı ama yasak listesine hiç eklenmemişti** (ölü kapı) | kırmızı (src + scripts) |
| `now() AT TIME ZONE 'UTC'` | 11 | – | – | 11'i düz `now()` + `-- tz-ok:` işaretine çevrildi → `error` | kırmızı |
| `'Europe/Istanbul'` literali | 4 | – | – | `FACTORY_TIMEZONE` importuna çevrildi → `error` | kırmızı |
| Türkçe tanımlayıcı | 8 | 7 | 2 | Hepsi yeniden adlandırıldı → `error`. Electron'da HAM selector 24 isabetin 22'si yanlış pozitifti (TR veri anahtarı) → DAR selector | kırmızı |
| `naming-convention` (biçim + ASCII) | 7 | 0 | 2 | `error` (`__…ForTests` allow). ⚠️ **Mobilde ilk sonda kuralı ÇÜRÜTTÜ**: `custom` yalnız `default` kaydındayken 4 ihlalin 3'ü sessizce geçti (kural bir tanımlayıcıya YALNIZ tek kayıt uygular) → `custom` her kayda tekrarlandı | kırmızı (ikinci turda) |
| `no-explicit-any` | 0 (`src`) | zaten `error` | 12 | mobilde 12'si tiplendi → `error`; backend'de bekçi kapsamındaki 28 ihlal için kural AÇILMADI (yeni borç kaydı açardı) | kırmızı |
| `no-floating-promises` (tip bilgili) | 0 | 35 | 291 | backend `error`; Electron ve mobil `warn` + tavan (35 / 277) | – |
| `no-console` | 137 (HARİÇ) | 3 | 0 | Electron + mobil `error` (`allow:[warn,error]`); backend HARİÇ — yapılandırılmış logger yok, karar ayrı iş | kırmızı |
| `reportUnusedDisableDirectives` | 6 ölü | 0 | 0 | üç projede `error`; ölü direktifler silindi, taşıdıkları bilgi düz yoruma çevrildi | kırmızı |
| `localStorage`'a token/jwt anahtarı | – | 0 | – | `error` (dar selector; `sidebar.collapsed` yakalanmıyor) | kırmızı |
| Paper `Card` + `onPress` | – | – | 0 | `error` — ama `no-restricted-syntax` yuvası ham hex'in `warn`ına ait olduğu için `react/forbid-component-props` altına yazıldı | – |
| `max-lines` 300 (`skipComments`+`skipBlankLines`) | 90 | 107 | 44 | `warn` + tavan; yorumu saymak en iyi kalıbı cezalandırıyordu (145→90) | kırmızı (311 satırlık sonda) |
| `max-lines` 200 override (`*Page.tsx`/`*FormDialog.tsx`) | – | 41 | – | `warn` + tavan (ESLint tek ruleId altında sayar); desen `src/pages/**` — ortak sarmalayıcılar kapsam dışı | kırmızı (210 satırlık sonda) |
| `max-lines-per-function` 80 | 305 | 454 | 162 | `warn` + tavan (391→305: fark, kararını yanına yazan dosyalar) | – |
| `max-params` | 47 | 10 | – | `warn` + tavan | – |
| Mutation `onError` içinde `toast.error` (yerel kural) | – | 26 | – | 4'ü düzeltildi, 22'si tavanda (>15 kovası) | – |
| Ham hex `Literal` | – | – | 2.166 | `warn` + tavan; yeni ekranlarda 0 | – |
| `import/no-cycle` | 1 | 2 | 0 | **YAZILMADI** — plugin + TS resolver ister, alias çözülmezse kural sessizce 0 döner; varsayılan derinlikte 1.888 döngüsel kenar (registry topolojisi kasıtlı). Açık iş: bağımlılıksız bekçi | – |
| `toLocaleUpperCase("tr")` | 56–59 meşru | – | – | **YAZILMADI** — yasak dar okunmuştu; gerekçe config başlığında | – |
| `z.enum([...])` Prisma aynası | 47 | – | – | **YAZILMADI** (baseline'a alınmadı; ayrı karar) | – |
| `findUnique→if→update` | AST adayı 5 (2'si yanlış pozitif) | – | – | **YAZILMADI** — AST güvenilmez; kural `KOD-KURALLARI` yasağı olarak kalır | – |
| Boyut kuralları `scripts/`+`prisma/` kapsamı | 341 fonksiyon | – | – | **AÇILMADI** — bekçiler uzun ve konuşkandır, mevcut karar korundu | – |

## 12 · Sonraki adımlar (kapatma turunda kapanan ve kapanmayanlar)

**Bu kapatma turunda kapananlar:**

| İş | Yapılan | Kapı |
|---|---|---|
| İ-09 · Swagger kapsam bekçisi | `test_swagger_spec.ts` artık Express router ağacından uç listesi çıkarıyor (`Router.prototype.use` yaması; Express 5 Layer mount yolunu saklamaz) ve spec ile iki yönlü karşılaştırıyor. 3 hayalet `@openapi` bloğu silindi (`reports/production.routes.ts`: `station-efficiency` · `machine-usage` · `scrap` — Swagger UI 404 veren uç ilan ediyordu). | `npx tsx scripts/run-all-tests.ts swagger` → 7/7, rc 0 · 4 negatif sonda (yeni belgesiz uç · hayalet blok · bayat baseline satırı · yama ölürse körlük zemini) hepsi kırmızı verdi |
| B-03/2 · Migration reçetesi | 23 adım → **13 çekirdek adım** + 8 satırlık "koşula bağlı ek adımlar" tablosu; hiçbir adım kaybolmadı. Reçetenin sonundaki "belgesiz kalan adımlar" bloğu ölçülerek budandı: 9 maddenin 8'i artık `VERITABANI.md` §7'de ya da reçetenin kendisinde yazılı (bayat), kalan 1'i (`apply-migration.ts` ön koşulları) 5. adıma girdi. | `node scripts/check-docs.mjs` rc 0 |
| M-04 · Soft-delete istisna listesi | Kök `CLAUDE.md`in 5 kalemlik listesi ölçülen **dört sınıfa** göre yeniden yazıldı ve ayrıntı `VERITABANI.md` §9'a bağlandı. | `check-docs` rc 0 · `CLAUDE.md` 19 KB (tavan 36 KB) |
| İ-15 · gerekçe | 22 çift-toast'ın tavanda kalması ölçütün kendisidir (26 > 15 → `warn` + tavan); ekstra düzeltme yapılmadı, gerekçe `olcum/kapatma-dusen-is.json`a yazıldı. | `Electron/lint-baseline.json` › `yerel/mutation-onerror-toast: 22` |
| Rapor · §8 | Kabul tablosu 10/10 ✅'ten **3 ✅ / 6 ⚠ / 1 ❌**'e düzeltildi; §10 kimlik akıbet tablosu ve §11 ESLint karar tablosu eklendi. | — |

**Kapanmayanlar (sıradaki iş):**

1. **K-05 · `docs/KOD-KURALLARI.md` mekanik listesi** — kütüphane sınıfından hiçbir kural/bekçi atfı yok; `test_dependency_contract.ts` o dosyada geçmiyor. Plan bunu "K-03 ile kapanır" saymıştı; tek satırlık iş.
2. **`[MO-40]` kanıtı bayat** — kural metni "`console` çıkış kanalı değildir" diyor, config `allow:[warn,error]` ile yazıldı ve `src` altındaki 11 çağrının hepsi `console.warn`; kanıttaki "8 ihlal / 6 dosya" karar ÖNCESİ sayıdır.
3. **`MOBIL.md` borç satırı bayat** — "11 gerekçesiz kuyruksuz mutasyon (İ-21)" düzeltmeden önceki sayı; bugünkü açık 3.
4. **İ-21 / İ-23 kalanı** — 3 istasyon mutasyonuna online-only gerekçesi, `TamburScreen` ReasonStep'in `ReasonPresetPicker`e geçişi.
5. **Swagger toplu belgeleme** — 117 belgesiz uç donduruldu; yoğunlaştığı yerler `shipping` 33 · `finance` 24 · `reports` 13 · `admin` 10.
6. **[DB-29b] süre ölçümü** — M-01'in index migration'ının kurulum penceresini ne kadar uzattığı ölçülmedi. Kullanıcı kararı (2026-09-05): süre engel değil, kazanç yeterli. Dump eldeyken ölçülür.
7. **Faz başına commit** — bu tur iki commit'le kapandı; geri alma birimi tek dev commit (§8 ölçüt 10).
