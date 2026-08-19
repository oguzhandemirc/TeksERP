# İçe / Dışa Aktarım (Import/Export) — Sistem Geneli Tasarım

> Tarih: 2026-08-19 · Durum: **UYGULANDI (2026-08-19) — F0–F4 tamam, deploy bekliyor**
> Deploy reçetesi: [`docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md`](../ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md)
> Kararlar (hepsi §5'teki ÖNERİLEN şık): D1 XLSX+CSV · D2 ya hep ya hiç (atla opsiyon) · D3 boş=dokunma, `NULL`=temizle · D4 mevcut servis yolu · D5 `ImportRun` tablosu · D6 export ek izin YOK · D7 Route/Recipe F2'de kompozit satır · D8 sipariş import EVET, açılış stoğu ayrı tur · D9 F0→F1→F2→F3→F4
> Kapsam: Teks-Erp (backend) + Electron (panel). Mobil kapsam DIŞI (sektörde de saha uygulamasında toplu içe/dışa aktarım yoktur; paylaşım/print zaten var).

---

## 0. Bir bakışta

| Katman | Sektör standardı (SAP / Odoo / Dynamics / NetSuite) | Bizde bugün | Plan |
|---|---|---|---|
| **A. Liste dışa aktarımı** | Her listeden, **mevcut filtreyle TÜM kayıtlar**, Excel/CSV/PDF | 13 CrudPage + 8 operasyon listesinde Excel/PDF var ama **yalnız yüklü satırlar** (fetchAll 2 sayfada); 12 ekranda hiç yok; 5 rapor exportsuz | **F0** — 1 gün, tek noktadan (CrudPage/Toolbar) |
| **B. Ana veri içe aktarımı** | Şablon indir → doldur → yükle → **önizleme (satır satır CREATE/UPDATE/SKIP/HATA)** → uygula; anahtar = kod; audit + geçmiş | **YOK** (tek importer etiket şablonu JSON) | **F1–F2** — çerçeve + 13 varlık |
| **C. Konfigürasyon paketi (JSON)** | Şablon/profil/rol/rota tanımlarını kurulumlar arası taşıma | Yalnız `LabelTemplate` (`/export`, `/import`) | **F3** — 8 tip + "tüm tanımlar" paketi |
| **D. İşlem verisi içe aktarımı** | Sipariş yükleme (müşteri excel'i), açılış stoğu (go-live) | YOK | **F4** — karar (D8) |
| **E. Denetim/KVKK dışa aktarımı** | Kullanıcı bazlı log/veri dökümü | YOK | **ERTELENDİ** (kullanıcı kararı 2026-08-19, `audit-kunye` yol haritası) |

Yapısal kısıt (pazarlık dışı, `CLAUDE.md` Allowed Packages): backend'de **CSV/XLSX/multipart paketi YOK ve EKLENMEYECEK**; Electron'da `exceljs` var (okur+yazar). Bu yüzden desen: **dosyayı PANEL ayrıştırır → JSON satırlar backend'e → backend doğrular/uygular.** Backend spec verir, panel şablon üretir. (Emsal: `accounting-export` JSON döner, xlsx panelde kurulur.)

---

## 1. Envanter (2026-08-19 taraması — kanıt)

### 1a. Mevcut yüzeyler
- `GET /api/label-templates/:id/export` + `POST /api/label-templates/import` (JSON zarf, ad çakışması dedup, `event:"IMPORT"` audit) — **tek importer**. Panel: gizli `<input type=file>` + `file.text()` + `JSON.parse` (`LabelTemplatesPage.tsx:107`). Bekçi: `scripts/test_label_template_io.ts`.
- `GET /api/shipping/accounting-export` — JSON, xlsx panelde (`useAccountingExport.ts`); sert sınırlar (`MAX_SHIPMENTS=2000`, 366 gün).
- Panel jenerik: `DataTable` + `DataTableTools` → PDF/XLSX (`lib/table-export.ts`, `lib/xlsx-export.ts`); `useDataTable.fetchAll` (cursor drain, 500'lük sayfa, ilerleme) **yalnız Rolls + Kartela**'da bağlı. `ReportExportBar` (Excel/PDF/Yazdır tek spec) 8 raporda.
- Backup indirme (`res.download`, tek yer), db-copy — DB seviyesi, kapsam dışı.

### 1b. Boşluklar — dışa aktarım
| Ekran | Durum |
|---|---|
| 13 CrudPage tanım ekranı (Items, Customers, Machines, Peripherals, Routes, ProductRecipes, DefectTypes, Colors, ReturnReasons, FabricProperties, SubcontractorCategories, Subcontractors) + QualityGrades | Excel/PDF var, **fetchAll YOK** → büyük listede eksik dosya (kullanıcı fark etmez!) |
| Orders, WorkOrders, Returns, Shipments, AccountingDispatch, SackContentEdit, RollArchive, KartelaTabs | aynı — fetchAll YOK |
| Stations (`ProductionStationsPage`), StationCapabilities (matris), ProductBalance, Access/Users, Access/Templates, Access/Permissions, Devices, System/Activity, WorkSessions, Perf | **hiç export yok** (ham `<Table>`/kart) |
| Raporlar: OperatorPerformance, TravelerTrace, OrderProfile, SystemLogSummary, UserActivity | `ReportExportBar` YOK |
| Format | CSV yok (yalnız XLSX/PDF) |

### 1c. Boşluklar — içe aktarım
Hiçbir ana veri ekranında yok. Backend'de bulk create/upsert primitifi yok (`BaseService` tek satır, tx dışı, tek audit). Var olan yararlı primitifler: `uniqueField` reactivate-on-duplicate (kod ile upsert'e en yakın şey), `sanitizeWriteData` DMMF allowlist, `assertNameNotDuplicate`, `withActor`, `AuditService.logMany`, `decideCodeUniqueness`, kod regex `^[A-Za-z0-9_-]+$` (yorumu zaten "import/export'ta güvenli" diyor), preview→apply deseni (~12 uç), `--apply` script deseni.

### 1d. Konfigürasyon nesneleri
Export/import olmayanlar: `TravelerCardTemplate`, `DocumentProfile` (+ `documentsConfig`/`travelerCardConfig` ayarları), `PermissionTemplate`, `Route`(+steps), `ProductRecipe`, `FreeDocument`, feature flag / SystemSetting demeti, `StationCapability` matrisi. `traveler-templates/inspect` ucu (yalnız doğrulama) preflight emsali.

### 1e. Yetki
Katalogda `import`/`export` kodu YOK; mevcut export'lar read izniyle, import write izniyle. `record-info.routes.ts` `TABLE_PERMISSIONS` haritası varlık→read izni için hazır emsal.

---

## 2. Sektör standardı — neyi hedefliyoruz

Odoo (import wizard), SAP (Migration Cockpit/LSMW, ALV export), Dynamics 365 (Data Management, Excel add-in), NetSuite (CSV Import Assistant) ortak asgarisi:

1. **Şablon indir** — başlıklar + zorunluluk + tip + örnek satır + kabul edilen değer listeleri (enum/lookup) **aynı dosyada** (ayrı sayfa).
2. **Sütun eşleme** — başlık adı/etiket üzerinden otomatik; ekstra sütun yok sayılır (uyarı), eksik zorunlu sütun hata.
3. **Doğrulama önizlemesi (dry-run)** — satır bazlı sonuç: `CREATE / UPDATE / SKIP(aynı) / ERROR`, alan bazlı Türkçe hata; dosya içi mükerrer anahtar tespiti; referans çözümü (kod → id).
4. **Uygulama modu** — varsayılan **ya hep ya hiç** (tek tx); opsiyon "hatalı satırları atla". Anahtar = iş kodu (external id); anahtar varsa GÜNCELLE, yoksa OLUŞTUR (upsert). "Yalnız yeni ekle / yalnız güncelle" modları.
5. **Sonuç raporu + geçmiş** — oluşturuldu/güncellendi/atlandı/hata sayıları; hatalı satırlar **indirilebilir** (aynı dosya + "Hata" sütunu); geçmiş listesi (kim, ne zaman, hangi dosya, kaç satır).
6. **Dışa aktarım içe aktarımla UYUMLU** (round-trip): dışa aktarılan dosya düzenlenip geri yüklenebilir → export'un "veri biçimi" varyantı import şablonuyla aynı sütunları taşır.
7. **Yetki ayrımı** — toplu içe aktarım ayrı yetkidir (Odoo `group_allow_export`, SAP rol); export okuma yetkisiyle serbest.
8. **Yerelleştirme** — Türk Excel'i: `;` ayraç, ondalık virgül (`1.234,50`), tarih `dd.MM.yyyy`, UTF-8 BOM. Ayraç/ondalık otomatik algılanır.
9. **Sınırlar** — parça parça yükleme, satır tavanı, zaman aşımı; kısmi sonuç sessiz kalmaz.
10. **Konfigürasyon taşıma** — şablon/rol/profil JSON paketi, sürüm damgalı (`schemaVersion`), kimlik yerine iş anahtarı, çakışmada yeniden adlandır/üstüne yaz seçimi.

---

## 3. Mimari

### 3a. Veri akışı (B — ana veri)
```
Panel: dosya seç (.xlsx/.csv) → exceljs / kendi CSV parser → satır[] (string hücreler)
  → POST /api/import/:entity/preview {rows, options}   (JSON; import router'ı için express.json limit 10 MB, satır tavanı 10.000)
  ← {rows:[{rowNo, action, key, diff?, errors[], warnings[]}], summary}
Panel: önizleme tablosu (süz: yalnız hatalar) → "Uygula" (hata varsa ve mod=all-or-nothing → buton kapalı)
  → POST /api/import/:entity/apply {rows, options}      (sıfırdan yeniden doğrular — önizlemeye güvenmez; emsal cancel-preview/cancel)
  ← {runId, created, updated, skipped, failed, errors[]}
Panel: sonuç kartı + "Hata raporunu indir" (aynı satırlar + Hata sütunu, xlsx)
```
- **Panel tarafı tek modül:** `Electron/src/lib/import/` — `parseSpreadsheet(file)` (xlsx via exceljs, csv kendi parser: BOM, `;`/`,`/`\t` sniff, tırnak), `normalizeCell` (TR sayı/tarih), `buildTemplateWorkbook(spec)` (Başlıklar + Örnek + "Açıklama" sayfası + "Değerler" sayfası: enum/lookup listeleri).
- **Ortak bileşen:** `components/import/ImportDialog.tsx` — 3 adım (Dosya → Önizleme → Sonuç); `CrudPage`'e `importEntity?: string` prop'u → başlığa "İçe Aktar" düğmesi (`PermissionGate` `data:import` + entity write).

### 3b. Backend
- `src/services/import/import-registry.ts` — varlık adaptörleri:
  ```ts
  interface ImportAdapter<Row> {
    entity: "item" | "customer" | ...;
    tableName: string;                       // audit
    writePermission: string;                 // entity write izni
    keyColumns: string[];                    // "code" (Customer: code | taxNumber; Branch: customerCode+code)
    columns: ImportColumn[];                 // {key, label, required, type: text|number|int|bool|date|enum|lookup, enumValues?, lookup?: {entity, by:"code"|"name"}, maxLen}
    validate(rows, ctx): Promise<RowResult[]>;   // dosya-içi dup + FK çözümü + iş kuralları (mevcut servis guard'larını ÇAĞIRIR, kopyalamaz)
    apply(tx, plan, ctx): Promise<ApplySummary>; // createMany/tek tek servis üzerinden — bkz. D4
    exportSelect: Prisma select;             // round-trip için "veri biçimi" export'u
  }
  ```
- Uçlar (`src/routes/import.routes.ts`, `app.use("/api/import", …)`):
  - `GET /api/import/entities` → izinli varlık listesi
  - `GET /api/import/:entity/template` → kolon spec (+ enum/lookup değerleri) — panel xlsx üretir
  - `POST /api/import/:entity/preview` → `data:import` + entity write
  - `POST /api/import/:entity/apply` → aynı
  - `GET /api/import/runs?entity=` / `GET /api/import/runs/:id` → geçmiş (`admin:settings` DEĞİL — `data:import` yeter)
  - `GET /api/export/:entity` (import-uyumlu veri biçimi, cursor'lu; read izni `TABLE_PERMISSIONS` benzeri harita) — round-trip için. Liste export'u zaten `fetchAll` ile mevcut listelerden; bu uç yalnız "veri biçimi"ni sunar.
- **`ImportRun` modeli** (migration): `id, entity, userId(FK), fileName, fileHash, rowCount, created, updated, skipped, failed, status(APPLIED|FAILED|PREVIEW_ONLY), options Json, errorReport Json?, durationMs, createdAt` + `@@index([entity, createdAt])`, `@@index([userId])`. Audit 6 ayda arşivlendiği için kalıcı geçmiş buradadır (`createdById` kararıyla aynı gerekçe). Ayrıca `logEvent SYSTEM IMPORT_RUN {runId, entity, sayılar}` + satır bazlı `logMany` (CREATE/UPDATE, `newData.importRunId` ile ilişkilendirme).
- **Anahtar/upsert kuralı:** anahtar kolon dolu + eşleşme var → UPDATE (yalnız dosyada VERİLEN kolonlar dokunur; boş hücre = "dokunma", `NULL` sabiti = "temizle" — üçlü sözleşme, `foldType` dersi); eşleşme yok → CREATE. autoCode modellerinde (Color `RNK`, Station `IST`, Machine `MAK`, DefectType `HATA`, ReturnReason `IADE`, Route `ROT`, Recipe `REC`, Customer `MUS`, FabricProperty) kod hücresi boşsa sunucu üretir; doluysa yalnız **eşleştirme** için kullanılır — eşleşmeyen dolu kod → hata ("bu model kodu kendisi üretir; yeni kayıt için kodu boş bırak") — sessizce yeniden numaralamak round-trip'i bozar. Item ve QualityGrade/Peripheral/Subcontractor kod kabul eder (mevcut davranış).
- **Referans çözümü:** kod birincil (`item.code`, `color.code`, `station.code`, `customer.code`); ikincil ad ile **tekil katlanmış** eşleşme (`foldNameForCompare`) → WARNING "ad ile eşleşti"; çoklu → ERROR. Pasif kayda referans → ERROR (checklist kuralı: var-mı + isActive).
- **Ad-mükerrer guard'ı** uygulama seviyesinde (DB unique bilinçli yok) → importer mevcut `assertNameNotDuplicate`/`assertSubNameAvailable`/`assertTaxNumberAvailable`'ı **çağırır**; ham Prisma ile yazıp guard'ı atlamak YASAK.
- **Sınırlar:** 10.000 satır/istek (üstü panelde reddedilir, mesajla), preview ≤ 30 sn hedef, apply tek tx (all-or-nothing) — 10k Item'da ölçülecek; aşarsa 1.000'lik tx parçaları + `ImportRun.status=PARTIAL` görünür (sessiz değil).
- **İdempotens:** `apply` `clientToken` taşır (`ImportRun.clientToken @unique`) — timeout-retry ikinci koşum 409 döner, sonuç `runId` ile okunur.

### 3c. Konfigürasyon paketi (C)
- Ortak zarf: `{ schemaVersion: 1, kind: "TRAVELER_TEMPLATE"|…, exportedAt, app: "TeksERP", payload }` — `LabelTemplate` zarfı da `schemaVersion` alır (geriye uyumlu: alan yoksa v0 kabul).
- Her tip için `GET /api/<res>/:id/export` + `POST /api/<res>/import` (LabelTemplate deseni birebir); çakışma stratejisi body'de: `onConflict: "rename" | "overwrite" | "skip"` (varsayılan rename — bugünkü davranış).
- **"Tüm tanımlar" paketi:** `GET /api/config-bundle/export?kinds=…` → tek JSON (label+traveler+document profiles+documentsConfig/travelerCardConfig+permission templates+routes+recipes+free documents; kimlikler iş anahtarına çevrilir) · `POST /api/config-bundle/preview` + `/apply` (aynı preview→apply çerçevesi, tür başına sayım). SaaS/çok-kurulum planına (`SAAS-TASARIM.md`) doğrudan girdi.
- Güvenlik: RAW_HTML/şablon içerikleri import'ta da `sanitizeTemplateHtml`'den geçer (zaten render'da koşuyor); JSON'da script taşımak mümkün değil ama HTML alanları var.

### 3d. Yetki
- Yeni katalog satırı: **`data:import`** (module ADMIN, category **web**) — "Toplu içe aktarım (Excel/CSV/JSON paket)". Kural: import = `data:import` **VE** varlığın write izni (`requireAllPermissions` yoksa route'ta iki `requirePermission`; F287 emsali). `admin:*` bunu **vermez** (settings:workstation ile aynı gerekçe: yıkıcı toplu yazma bilinçli atanır).
- Export: **ek izin YOK** (mevcut davranış; read izni yeter) — D6'da seçenek.
- Rol kataloğu: `data:import` yalnız Süpervizör/Yönetim masaüstü rollerine; diğerleri için `ROLE_COVERAGE_EXEMPT` **DEĞİL** (kapsam bekçisi geçsin diye en az bir role konur).

---

## 4. Fazlar ve iş listesi

### F0 — Dışa aktarım örtüsü (~1 gün, migration/izin YOK)
1. `CrudPage`: `fetchAll` destructure + `DataTableToolbar` → `DataTableTools fetchAll` geçişi (13 ekran birden "Tüm listeyi indir" olur). `DataTableToolbar`'a `fetchAll?` prop'u.
2. Aynı geçiş: Orders, WorkOrders, Returns, Shipments, AccountingDispatch, SackContentEdit(SacksListView), QualityGrades, RollArchive, KartelaTabs.
3. Export'suz ekranlara `ExportMenu` (Excel/PDF): Access/Users, Access/Templates (rol → izin listesi satırları), Access/Permissions, Devices, ProductionStations (istasyon+makine düz liste), StationCapabilities (matris → uzun biçim), ProductBalance, WorkSessions, System/Activity (mevcut filtre, tavan 10k + uyarı), Perf.
4. Raporlar: `ReportExportBar` → OperatorPerformance, TravelerTrace, OrderProfile, SystemLogSummary, UserActivity (`reportExport.test.ts` kolon eşitliği bekçisi otomatik kapsar).
5. Format: `table-export.ts`'e **CSV** (UTF-8 BOM, `;` ayraç — Türk Excel'i çift tık ile açsın) — ExportMenu'ye üçüncü madde. Sayılar CSV'de ham (`1234.5`), Excel'de sayı hücresi (mevcut).
6. Dosya adı standardı zaten `exportListName` — filtre özeti (tarih aralığı) dosya adına eklensin (`Siparisler_2026-08-01_2026-08-19.xlsx`).
7. Bekçi: `Electron` tarafında `table-export.test.ts` (CSV kaçış/BOM/ayraç), mevcut `reportExport.test.ts`.

### F1 — İçe aktarım çerçevesi + 3 pilot (Item, Customer(+Branch), Color)
- Backend: registry, 3 adaptör, `ImportRun` migration, `data:import` katalog satırı + rol kataloğu, `/api/import/*` + `/api/export/:entity`, route-bazlı `express.json({limit:"10mb"})`.
- Panel: `lib/import/*`, `ImportDialog`, `CrudPage.importEntity`, "İçe Aktarım Geçmişi" (System hub altına küçük sayfa; `data:import`).
- Item adaptörü: `code?, name*, unit, category?, width?, weight?, isActive, allowedColors(kod listesi `;`)…` — `ItemService.create/update` yolundan (advisory lock + kod üretimi korunur), `pendingReview` mass-assignment guard'ı **korunur** (import'ta o alan yok).
- Customer adaptörü: `code?, name*, taxNumber, taxOffice, phone, email, address, branchCode?, branchName?…` — bir dosyada müşteri + N şube satırı (aynı müşteri kodu tekrar → şube ekle); `assertTaxNumberAvailable` çağrılır.
- Color adaptörü: `code?, name*, hex?, isActive` — `normalizeColorName` + `assertNameAvailable`.
- Bekçiler: `scripts/test_import_framework.ts` (önizleme=uygulama tutarlılığı, dosya-içi dup, üçlü boş/NULL/değer sözleşmesi, ad-guard atlanmıyor, all-or-nothing gerçekten geri alıyor — negatif sondayla), `test_import_item.ts`, `test_import_customer.ts`, `test_import_color.ts`, `test_permission_catalog`/`test_role_template_catalog` yeşil.

### F2 — Kalan ana veri adaptörleri
QualityGrade (targetStatus zorunlu), DefectType, ReturnReason, FabricProperty(+values; `stationIds` ZORUNLU — kod listesi), Subcontractor(+category kodları), SubcontractorCategory, Station, Machine (stationCode ile), CustomerItemAlias / CustomerColorAlias (upsert doğal), Route(+steps: stationCode|sequence|plannedColorCode|properties — D7), ProductRecipe(+properties), User (**yalnız oluşturma**: username, ad, rol şablonu kodu, geçici şifre zorunlu değiştirme; şifre/kart/PIN export'a ASLA girmez; `PROVENANCE`/oracle uyarısı `base.service.ts:344`).
Kapsam dışı (gerekçeli): Permission (katalog koda bağlı), Currency (statik), Order/WorkOrder/Roll (F4), SystemSetting (C paketi).

### F3 — Konfigürasyon paketleri (JSON)
TravelerCardTemplate, DocumentProfile (+ `documentsConfig`/`travelerCardConfig` — `PATCH feature-flags` anahtar-kapsamlı guard'ı KORUNUR, import aynı dar izinle), PermissionTemplate (izin kodları; katalogda olmayan kod → hata, atama TAŞINMAZ), Route, ProductRecipe, FreeDocument, LabelTemplate'e `schemaVersion` + `onConflict`, StationCapability matrisi; `config-bundle` export/preview/apply. Bekçi: `test_config_bundle_io.ts` (round-trip: export→import→export bayt-eş).

### F4 — İşlem verisi (D8 kararına bağlı)
- **Sipariş içe aktarımı:** müşteri excel'i → `Order` + satırlar (`OrderService.create` yolundan, `clientToken` ile idempotent; müşteri/kumaş/renk kod ile; sipariş no sunucudan). Önizleme müşteri alias'larını da çözer (`(Müşteride: X)` konvansiyonu).
- **Açılış stoğu (go-live / sayım):** barkodlu/barkodsuz top toplu girişi `RollStatus` seçimiyle (STOCK/WAREHOUSE/A1_STOCK), `entrySource=IMPORT` (enum eklenir), parti/kalite opsiyonel; **`roll:manual-adjust` + `data:import`**; sayaç/etiket üretmez; movement `notes='IMPORT'`. Riskli — ayrı tasarım turu ister.

---

## 5. Karar noktaları (öneri kalın)

| # | Soru | Şıklar |
|---|---|---|
| D1 | Import dosya biçimleri | **XLSX + CSV** · yalnız XLSX · + JSON satır dizisi (API kullanıcıları) |
| D2 | Uygulama modu varsayılanı | **Ya hep ya hiç (tek tx), "hatalıları atla" opsiyon** · varsayılan atla · yalnız all-or-nothing |
| D3 | Boş hücre anlamı (UPDATE'te) | **boş = dokunma, `NULL` sabiti = temizle** · boş = temizle · boş = dokunma, temizleme yok |
| D4 | Yazma yolu | **mevcut servis `create/update` (guard'lar korunur; ~10k satırda ölçülür)** · doğrudan Prisma `createMany` (hızlı, guard'lar kopyalanır — RED önerisi) |
| D5 | Geçmiş | **`ImportRun` tablosu + hata raporu indir** · yalnız SystemLog (6 ayda arşiv) |
| D6 | Export izni | **ek izin yok (read yeter)** · `data:export` ayrı izin (SoD sıkı) |
| D7 | Route/steps ve Recipe import kapsamı | **F2'de dahil (kompozit satır: rota kodu tekrar eden satırlar = adımlar)** · yalnız JSON paket (F3) |
| D8 | F4 işlem verisi | **Sipariş import EVET, açılış stoğu ayrı tasarım turu** · ikisi de şimdi · ikisi de yok |
| D9 | Sıralama | **F0 → F1 → F2 → F3 → F4** · F0 → F3 (konfig taşıma acil ise) → F1… |

---

## 6. Riskler / tuzaklar (Opus için)
- **Round-trip sessiz yeniden numaralama:** autoCode modellerinde dolu kod CREATE'te düşürülüyor (`base.service.ts:817-825`) — importer bunu HATA yapar, sessiz kabul etmez.
- **`sanitizeWriteData` fail-open** — importer alan allowlist'ini adaptör spec'inden ayrıca uygular (Zod), DMMF'ye tek başına güvenmez.
- **Ön-süzgeçli/CSV filtre dersi:** lookup kod listelerinde `;` ayraç; ham stringi `in`'e vermeden `readFilterList` benzeri normalize.
- **Fabrika verisi CANLI:** import bekçileri `TEST-` kodlu fixture ile; cleanup `finally`; `RollVariance` vb. RESTRICT FK'lara dikkat.
- **Panel dosya okuma:** DOM `<input type=file>` (Electron+web ikisinde çalışır); `files:open` IPC YOK — gerekmez.
- **10 MB JSON limiti yalnız `/api/import` router'ında** — global 1 MB değişmez (`app.ts:129` konumu load-bearing).
- **Yeni izin = katalog satırı + rol paketi + elle atama** (uzlaştırma ATAMAZ) — deploy notuna yaz.
- **Deploy sırası:** F0 saf panel; F1+ backend ÖNCE (yeni uçlar), panel sonra; APK yok.

---

## 7. UYGULAMA NOTLARI (2026-08-19 — kod yazıldıktan sonra)

Belgenin üstündeki plan gerçekleşti. Aşağıda **tasarımdan sapan** ve **tasarımda
olmayıp eklenen** noktalar var; plan metnini değil BURAYI güncel kabul edin.

### 7a. Sapmalar (gerekçeli)

| # | Plan | Gerçekleşen | Gerekçe |
|---|---|---|---|
| S1 | D2 "ya hep ya hiç (**tek tx**)" | **Ön-doğrulama tabanlı**: tüm satırlar önce doğrulanır, tek hata varsa hiçbir şey yazılmaz; yazma sırasında beklenmedik hata çıkarsa **İLK HATADA DURULUR** ve sonuç `PARTIAL` + `stoppedAtRowNo` ile bildirilir | D4 (mevcut servisleri çağır) ile tek tx **teknik olarak bağdaşmıyor**: servisler global `prisma` ile yazar, `$transaction` içine alınamaz (adapter-pg'de tx ayrı bağlantıdadır → yazımlar tx'in DIŞINA kaçar, rollback onları geri ALMAZ). Sahte bir "atomik" vaadi gerçek kısmi yazımdan kötüdür. Gerçek atomiklik için BaseService'in tx-farkında olması gerekirdi — canlı sistemde 13 servisi etkileyen bir ameliyat, gözetimsiz bir gecede yapılmamalı. Kısmi sonuç **asla sessiz değil**: API, panel sonuç kartı ve `ImportRun` satırı üçü birden söyler. |
| S2 | Müşteri + şubeler **tek dosyada** | **İki ayrı şablon** (`customer`, `customerBranch`) | Motorun sözleşmesi "bir satır = bir kayıt". Aynı müşteri kodunu tekrar eden satırlar mükerrer anahtar olarak reddedilirdi. Şube anahtarı sentetik: `CariKodu\|Şube Adı`. |
| S3 | `GET /api/export/:entity` ayrı mount | `GET /api/import/:entity/export` | Tek router, tek izin haritası. İkinci bir mount ikinci bir guard kopyası demekti. |
| S4 | Kalite Sınıfları ekranına "İçe Aktar" | Ekranda **YOK**, yalnız Veri Aktarımı ekranından | O liste bilinçli olarak salt-okunur ("seed'den yönetilir"); ekrana buton koymak o kararı sessizce devirirdi. |
| S5 | CSV'de sayılar **ham** (`1234.5`) | **TR ondalık** (`1234,5`) | `;` ayraç + BOM ile birlikte tek bir sözleşme: tr-TR Excel'de nokta yazılırsa hücre METNE düşer ve `SUM` sessizce çalışmaz. İçe aktarıcı ayracı+ondalığı otomatik algıladığı için round-trip bozulmaz. Bekçi: `Electron/src/lib/list-export.test.ts`. |
| S6 | Sipariş içe aktarımı upsert | **Yalnız OLUŞTURUR** | Sipariş bir işlem kaydıdır (üzerine iş emri açılır, sevkiyat bağlanır, `shippedQty` denormalize edilir). Bir Excel satırını "kaynak doğru" sayıp mevcut siparişi ezmek üretimi olmuş kaydı sessizce değiştirmek olurdu. Mükerrer koruması **uyarı** düzeyinde (aynı müşteri + aynı toplam metraj, son 90 gün). |
| S7 | Açılış stoğu (F4b) | **YAPILMADI** (D8 kararı) | Ayrı tasarım turu ister. |

### 7b. Tasarımda olmayıp eklenenler

- **Gruplu şablon desteği** (`ImportAdapter.grouped` + `child` sütunlar): aynı
  anahtarı taşıyan satırlar TEK kayıt olur. Rota (adımlar) ve Sipariş (kalemler)
  bunu kullanır. Çocuk listesi **replace** semantiğindedir ve diff iki tarafı
  **kanonikleştirerek** karşılaştırır — yoksa hiç değişmemiş rota her yüklemede
  yeniden yazılır (`updatedAt` kayması, envanter listeleri ona göre sıralanıyor).
- **Merkezî "Veri Aktarımı" ekranı** (`/system/data-import`, `data:import`):
  varlık kartları (şablon indir · veriyi indir · içe aktar) + yapılandırma
  paketi + koşum geçmişi. Sektör emsali SAP Migration Cockpit / Dynamics Data
  Management workspace.
- **`SystemTile.permission`**: Sistem hub'ı karoları artık kendi iznini
  taşıyabiliyor; karo + komut paleti + route AYNI kapıyı kullanır (ayrışırsa
  kullanıcı kartı görür, tıklar, `/forbidden`'a düşer).
- **İzin bekçisine "kapsam devri"** (`test_permission_catalog.ts`): izinleri tek
  bir sabitte durmayan dosyalar (registry deseni) kapsamı başka bir bekçiye
  devredebilir. Devir **ölü olamaz** — hedef bekçi dosyası yoksa test düşer
  (negatif sondayla doğrulandı).

### 7c. Ne nerede

| Katman | Dosyalar |
|---|---|
| Motor | `Teks-Erp/src/services/import/{import.types,import-coerce,import-lookup,import.service,import-registry}.ts` |
| Adaptörler (17) | `Teks-Erp/src/services/import/adapters/*.adapter.ts` |
| Yapılandırma paketi | `Teks-Erp/src/services/import/config-bundle.service.ts` + `routes/config-bundle.routes.ts` |
| Uçlar | `Teks-Erp/src/routes/import.routes.ts` (`/api/import/*`), `/api/config-bundle/*` |
| Şema | `ImportRun` + `ImportRunStatus` (migration `20260819120000_import_runs`) |
| Panel — dışa aktarım | `Electron/src/lib/{list-export,table-export,file-save}.ts`, `components/data-table/{ListExportMenu,ExportMenu,DataTableTools}.tsx`, `hooks/{useTableExportAll,useExportRange}.ts` |
| Panel — içe aktarım | `Electron/src/lib/import/{parse,template}.ts`, `components/import/ImportDialog.tsx`, `services/{importService,configBundleService}.ts`, `pages/System/DataImport/*` |
| Bekçiler | `Teks-Erp/scripts/test_import_framework.ts` (45), `test_config_bundle.ts` (27), `Electron/src/lib/list-export.test.ts` (8), `lib/import/parse.test.ts` (13) |

### 7d. Desteklenen varlıklar (17)

`item` · `customer` · `customerBranch` · `color` · `fabricProperty` ·
`qualityGrade` · `defectType` · `returnReason` · `station` · `machine` ·
`subcontractorCategory` · `subcontractor` · `customerItemAlias` ·
`customerColorAlias` · `productRecipe` · `route` (gruplu) · `order` (gruplu,
yalnız oluşturur)

Yapılandırma paketi türleri (5): `LABEL_TEMPLATE` · `TRAVELER_TEMPLATE` ·
`DOCUMENT_PROFILE` · `FREE_DOCUMENT` · `PERMISSION_TEMPLATE`
