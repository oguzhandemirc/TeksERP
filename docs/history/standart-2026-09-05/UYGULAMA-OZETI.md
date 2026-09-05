# Kod Yazım Standardı — uygulama özeti (2026-09-05)

Planı Fable, uygulaması Opus. Girdi: `PROMPT.md` (bu dizinde) ve `kesif/` altındaki on ajanlık salt-okunur ölçüm. Bu dosya **ne yapıldığını ve neyin yapılmadığını** kaydeder; kuralların kendisi `docs/standart/` altındadır.

---

## 1 · Sonuç

| Teslimat | Durum |
|---|---|
| `docs/standart/` kural kitabı (10 dosya) | ✅ |
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
| **M-01** | 5 index'siz domain FK kapatıldı; `NOT NULL` olan düz index, nullable ve null-yoğun 4 kolon **kısmi** index aldı (ev emsali korundu). Migration başlığında "en eski canlı dump'ta prova + süre ölçümü zorunlu" notu var — canlı maliyet ölçülmedi |
| **M-05** | `SackTag.name` için yumuşak kapılı UNIQUE sed (`nameFold` emsali: mükerrer varsa NOTICE + atla); uygulama guard'ı kalır, mesajı o verir |
| **M-02** | 10 model tek tek sınıflandırıldı. Yalnız **1'i** gerçek unutulmaydı (`ImportRun` → `updatedAt` eklendi); kalan 9 append-only/pivot olarak `///` gerekçesiyle şemaya yazıldı. **Karar: 10 tabloya kolon eklemek yerine istisnayı belgelemek** |

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
- Swagger'da ~60 belgesiz uç ve `test_swagger_spec` zemininin (`PATH_COUNT_FLOOR=120`, gerçek 502) ısırmaması.
- Route katmanından 10 audit çağrısı (3 dosya) — kural yazıldı, düzeltme ayrı iş.
- Backend'de yapılandırılmış logger yok (137 `console`); mobilde şema doğrulama katmanı yok (`zod` bağımlılığı bile yok).
- 4 tablet ucu `clientToken` taşımıyor (SubcontractorDispatch · KartelaDispatch · KartelaReceipt · StockCount) — kolon + replay + APK ister.

## 8 · Kabul ölçütleri

| # | Ölçüt | Durum |
|---|---|---|
| 1 | main-kaynaklı kırmızılar yeşil | ✅ Electron tip 0 hata · vitest 211 dosya/2283 test · backend **455/455** (temiz koşum, 447 sn) |
| 2 | `docs/standart/` 10 dosya, etiketli + kanıtlı, ≤24 KB | ✅ `check-docs` rc 0 |
| 3 | Üç projede lint yeşil + `lint-baseline.json` + tavan kapısı | ✅ backend 442 · Electron 666 · mobil 2.783 uyarı donduruldu, 0 error |
| 4 | Kimliklerin akıbeti raporda | ✅ §4 ve §7 |
| 5 | Reçeteler + `.claude/rules` + CLAUDE.md bağları | ✅ §5, §6 |
| 6 | CI YAML geçerli, `adnansahin` yok, mobil job var | ✅ `js-yaml` ile parse edildi: docs · backend · load-test · electron · mobile · e2e |
| 7 | Migration'lar dev'de uygulandı, kapılar yeşil | ✅ `test_db_invariants` · `test_schema_drift` · `check-migrations` |
| 8 | Paket kaldırma sonrası üç proje yeşil | ✅ (taban ölçümü kaldırmadan ÖNCE alındı) |
| 9 | Dokunulan alanların bekçileri yeşil | ✅ §4'teki her satırda bekçi + sonda kaydı |
| 10 | Faz başına commit + `UYGULAMA-OZETI.md` | ✅ |

## 9 · Bu turun kendi dersleri

1. **Kapıyı kurmadan kuralı yazma.** Bu turda yazılan hemen her kural zaten uygulanıyordu; eksik olan yazılı karşılık ve mekanik kapıydı. Buna karşılık, yazılı olup **hiç koşmayan** bir kural da bulundu (`DATE_TRUNC`) — kural metni bir kapı olduğunu KANITLAMAZ.
2. **Damga kaydın tamamına konur.** Fixture'ın kodunu damgalayıp adını damgalamamak, ad üzerindeki ifade-UNIQUE sedleri yüzünden ikinci koşumu düşürür; ve ifade-UNIQUE şemada görünmez, kanonik kaynak `pg_indexes` / `test_db_invariants`.
3. **"Yeşil" ile "kapsandı" ayrı şeylerdir.** Koşucu atlanan kontrolü basmaya başlayınca 65 ölçülmemiş kontrol görünür oldu.
4. **Yorumu boyuta saymak, en iyi kalıbı cezalandırır.** `skipComments` açık ölçüm 145 → 90 dosya, 391 → 305 fonksiyon: aradaki fark, kararını kodun yanına yazan dosyalardı.
