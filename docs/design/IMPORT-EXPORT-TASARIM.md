# İçe / Dışa Aktarım (Import/Export) — Sistem Geneli Tasarım

> Tarih: 2026-08-19 · Durum: **✅ UYGULANDI ve SAHAYA ÇIKTI** (SURUM-2.9.0, 2026-08-24). §0 tablosundaki "bizde bugün YOK" satırları 2026-08-19 envanteridir.
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
- ⚠️ **İzin hizası ölçülür, okunmaz** (`test_import_permissions.ts`): adaptörün `writePermission`'ı varlığın POST rotasındaki izinle aynı OLMALI. 2026-08-19'da iki adaptörde ayrışmıştı ve ikincisi ciddiydi — `data:import` + `quality:write` taşıyan biri panelden tek renk açamazken TOPLU renk yükleyebiliyordu (canlı sonda ölçtü: tekil 403, toplu **200**). Yeni adaptör eklerken izni rotadan kopyala, adaptör komşusundan değil.

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
| Panel — içe aktarım | `Electron/src/lib/import/{parse,template,overrides,lookup-create,group-issues}.ts`, `components/import/{ImportDialog,RowIssueCell,QuickCreateLookup,ColumnMappingStep,ImportSpecPreview,EntityPreviewDialog}.tsx`, `services/{importService,configBundleService}.ts`, `pages/System/DataImport/*` |
| Bekçiler — backend | `test_import_framework.ts` (51) · `test_import_fix_hints.ts` (20) · `test_import_permissions.ts` (10, **canlı 403 sondası dahil**) · `test_config_bundle.ts` (27) |
| Bekçiler — panel | `lib/import/{parse,overrides,group-issues,no-message-parsing}.test.ts` · `components/import/ImportDialog.test.tsx` (8 RTL) · `lib/list-export.test.ts` |

**Bekçilerin böldüğü sorular** (aynı invariant'ı iki dosyaya yaymamak için):
`test_import_permissions` iznin hem BEYAN edildiğini (adaptör ↔ rota kaynağı,
statik) hem de UYGULANDIĞINI (gerçek app + gerçek token, iki yönlü) ölçer —
ikisi ayrı sorudur, bu yüzden aynı dosyada durur. `no-message-parsing.test.ts`
ise tek bir mimari kararı kilitler: değer yalnız sunucunun `issue.fix.value`
alanından okunur, Türkçe hata cümlesinden ASLA.

### 7d. Desteklenen varlıklar (17)

`item` · `customer` · `customerBranch` · `color` · `fabricProperty` ·
`qualityGrade` · `defectType` · `returnReason` · `station` · `machine` ·
`subcontractorCategory` · `subcontractor` · `customerItemAlias` ·
`customerColorAlias` · `productRecipe` · `route` (gruplu) · `order` (gruplu,
yalnız oluşturur)

Yapılandırma paketi türleri (5): `LABEL_TEMPLATE` · `TRAVELER_TEMPLATE` ·
`DOCUMENT_PROFILE` · `FREE_DOCUMENT` · `PERMISSION_TEMPLATE`

## 8. ③ İÇE AKTARIM GERİ SARMA SÖZLEŞMESİ (2026-09-12, migration'dan ÖNCE)

> Kod yazılmadan önce okunur. Kullanıcı kapsamı onayladı ("defter + güvenli geri sarma").
> Doktrin çerçevesi `docs/kurallar/defter.md`. Ölçümler 17 adaptörün tamamı okunarak
> yapıldı (2026-09-12); her iddianın yanında `dosya:satır` çapası vardır.

### 8.0 Doktrin çerçevesi (değişmez)

- `ImportRun` satırı "OLDU" kaydıdır: geri sarma onu NE SİLER NE DEĞİŞTİRİR. Geri sarma
  BUGÜNE yazılan karşı kayıttır (`revertedAt`/`revertedById`/`revertReason` + satır
  bazında ters kayıt).
- `importedAt` benzeri ileri damgalar `null`'lanmaz.
- Master data bir DURUM tablosudur; önceki değere dönmesi meşrudur — ama o dönüşün
  KENDİSİ defterde satır olarak görünür ("kim geri sardı, hangi alanı neye döndürdü"
  sorusu audit'e uzanmaz).

### 8.1 Motor gerçekleri (hepsine uygulanır)

1. **Tek tx YOK:** yazım döngüsü satır satır `createOne`/`updateOne` çağırır
   (`import.service.ts:571-607`); ilk yazma hatasında döngü KIRILIR, koşum `PARTIAL`
   olur ve `stoppedAtRowNo` yazılır. Yani bir koşumun yazdığı küme dosyanın ÖN EKİ
   olabilir — geri sarma "tüm dosya" değil YAZILAN SATIRLAR üzerinden çalışır.
2. **Motorun audit satırında `oldData` YOK** (`import.service.ts:585-594`): önceki
   değerler yalnız SERVİSLERİN kendi audit satırlarında var, onlar da 6 ayda arşivlenir.
3. Bir koşumun yazdığı kayıtların izi bugün TEK yerde: audit. `getRunRecords`
   `system_logs`u `newData.importRunId` + ±10 dk penceresiyle okuyor ve dönüşünde
   `archivedAfterMonths: 6` taşıyor (`import.service.ts:733-779`). Kök kuralın tanımı:
   *audit'e uzanma ihtiyacı bir defter eksikliğinin işaretidir.*
4. `/api/import/runs/:id/records` ucu VAR ama panelde tüketicisi YOK → "motor var,
   çıkış yüzeyi yok" ⇒ o yetenek bugün **VAR SAYILMAZ**. Geri sarma önizlemesi bu ucu
   yüzeye çıkarır, yeni bir per-record kavramı icat etmez.
5. `nameFold`/`aliasFold`/`cityFold` DB-üretimlidir (`@default(dbgenerated())`) —
   uygulama yazmaz, geri de yazamaz; geri sarma onlara dokunmaz.
6. **DİRİLTME TUZAĞI:** kodu DOSYADAN gelen varlıklarda (item manuel kodla,
   qualityGrade, subcontractorCategory, subcontractor) pasif bir kaydın kodu gelirse
   servis onu DİRİLTİR ve bazı yollarda çocuk pivotlarını SİLER
   (`item.service.ts:252-264`, `base.service.ts:1052-1062`,
   `subcontractor-management.service.ts:533-542`). Önizleme "CREATE" der ama yapılan
   şey UPDATE+REVIVE'dır ⇒ geri sarma `isActive:false` ile YANLIŞ olur.

### 8.2 17 varlık × ters yol matrisi

| # | entity | yaratılan satırın tersi | güncellenen satırın tersi | GERİ ALINAMAZ / risk |
|---|---|---|---|---|
| 1 | item | `isActive:false` (hard delete RESTRICT'lerle reddedilir) | alan-bazlı EVET | izin listesi (`ItemAllowedColor/Property`) REPLACE ediliyor ve eski küme hiçbir audit yükünde YOK (`item.service.ts:470-483`, 495-505) → **`ImportRunLine` yazım anında fotoğraflamalı**; diriltme dalı pivotları siler |
| 2 | customer | `isActive:false` | EVET (BaseService `oldData`+`changes`) | kod dizisi yanar (kod yeniden kullanılmaz) — zararsız |
| 3 | customerBranch | `isActive:false` — **hard delete YASAK** | EVET (tam `oldData`) | ona bakan FK'ların HEPSİ opsiyonel (`Order.branchId` 2382, `Shipment` 5094, `Sack` 4805, `DirectShipment` 3984) ⇒ hard delete reddedilmez, canlı belgeleri SESSİZCE null'lar |
| 4 | color | `isActive:false` | EVET | ad yazımda yeniden normalize edilir (`055 BEYAZ`), dosya hücresiyle birebir değil; `Roll.colorId` opsiyonel ⇒ hard delete tarihi boyar |
| 5 | fabricProperty | `isActive:false` | skaler EVET · `values` EVET (soft) · **istasyon linkleri HAYIR** | `StationProperty` replace eski kümeyi yok eder ve audit'te yok (`fabric-property.service.ts:384-390`) |
| 6 | qualityGrade | dirilttiyse `isActive:false` YANLIŞ → önceki alan değerleri geri yazılır | EVET | `targetStatus` üretim davranışıdır (Tambur topu nereye düşürür); kod insan anahtarı ("A1") ve araya başkası girebilir |
| 7 | defectType | `isActive:false` | EVET | `RollError.defectTypeId` opsiyonel ⇒ hard delete geçmiş atfı null'lar |
| 8 | returnReason | `isActive:false` | EVET | `RollReturn.reasonId` opsiyonel ⇒ aynı sınıf |
| 9 | station | `isActive:false` (hard delete reddedilir) | EVET | `appliesColor/Quality` kapanırken açıkken doğmuş satırlar geri alınmaz |
| 10 | machine | `isActive:false` (kullanılmışsa hard delete reddedilir) | EVET | istasyon taşımasını geri almak `@@unique([stationId,nameFold])`e çarpabilir |
| 11 | subcontractorCategory | `isActive:false` — **hard delete YASAK** | kısmi (`oldData` 6 alan) | hiçbir zorunlu FK bakmıyor ⇒ hard delete reddedilmez ve firma-kategori linklerini CASCADE siler |
| 12 | subcontractor | `isActive:false` (hard delete reddedilir) | skaler kısmi · **kategori kümesi HAYIR** | diriltme dalı mevcut linkleri siler; `oldData` kategorileri taşımıyor (`…:607-610`) |
| 13 | customerItemAlias | pivot, soft-delete YOK ⇒ **fiziksel silme** (FK-güvenli, yalnız KOŞUMUN YARATTIĞI satır) | `alias` EVET (kolon NOT NULL, eski değer audit'te `oldData:{alias}`) | import bu tabloda silme yüzeyi sunmuyor; fiziksel silme ③b sınıfıyla AÇIKÇA sahiplenilir (§8.3a) |
| 14 | customerColorAlias | pivot, soft-delete YOK ⇒ **fiziksel silme** (yalnız koşumun yarattığı satır; ölçüm: import yalnız `alias` yazar, `assigned` varsayılan `false` kalır ⇒ yarattığı satır HER ZAMAN `assigned:false`) | `alias` EVET — kolon **nullable** (`String?`), yani önceki değer `null` ise ona da dönülür | koşumdan ÖNCE var olan satır (ör. `assigned:true`, alias boş) import tarafından yalnız GÜNCELLENİR; tersi "alias'ı eski haline (null'a) döndür"dür, satır SİLİNMEZ — silmek müşteriye özel rengi kamuya açardı |
| 15 | productRecipe | `isActive:false` | skaler EVET · **özellik kümesi HAYIR** | `properties: { deleteMany: {}, create: … }` eski kümeyi yok eder (`product-recipe.service.ts:147-150`) |
| 16 | route | `isActive:false` | başlık skalerleri EVET · **adım ağacı HAYIR** | `steps: { deleteMany: {}, create: … }` TÜM adımları siler, id'ler değişir, eski ağaç audit'te yok (`route.adapter.ts:294-298`) |
| 17 | order | `isActive` YOK ⇒ mevcut İPTAL yolu (`status=CANCELLED` + `cancelledAt/cancelReason`, satırlarda `OrderLine.cancelled*`) | — (adaptör UPDATE yapmaz, her grup CREATE) | sevkiyat/WO/tahsis bağı varsa hard delete reddedilir ve iptal İŞ KARARIDIR; ayrıca `promoteCustomerAliases` BAŞKA varlığın master satırlarını yazar (`order.service.ts:683-755`) ve sipariş iptalinden sonra da YAŞAR |

**Hiçbir kutu BOŞ kalmadı** (1e'nin durma koşulu): her varlık için hem yaratma hem
güncelleme tersi tanımlı. Ama beş varlıkta (item · fabricProperty · subcontractor ·
productRecipe · route) "güncellemenin tersi" ANCAK yazım anında fotoğraf alınırsa
mümkündür — bu yüzden `ImportRunLine` fotoğrafı ZORUNLU alandır, opsiyonel değil.

**Fiziksel silmenin YASAK olduğu varlıklar** (hard delete reddedilmez ama canlı
belgeleri sessizce null'lar/cascade'ler): `customerBranch` · `qualityGrade` ·
`defectType` · `returnReason` · `subcontractorCategory` · `route` · `productRecipe`.
Geri sarma bu yedisinde YALNIZ `isActive:false` yazar.

### 8.2a İki alias pivotunda FİZİKSEL SİLME — sınıf ③b (yapılandırma pivotu)

`customerItemAlias` ve `customerColorAlias` soft-delete kolonu TAŞIMIYOR
(`schema.prisma` `customer_item_aliases` / `customer_color_aliases`), bu yüzden
koşumun YARATTIĞI bir alias satırını geri almanın tek yolu fiziksel silmedir. Bu,
hard delete'in ③b sınıfına (**saf yapılandırma pivotu**) girer ve üç sınırla sahiplenilir:

1. **Yalnız O KOŞUMUN YARATTIĞI satır silinir.** Koşumdan önce var olan satıra
   dokunulmaz: import onu yalnız GÜNCELLEMİŞTİR (`alias` yazmıştır) ve tersi eski
   değeri geri yazmaktır — `customerColorAlias.alias` NULLABLE olduğu için eski değer
   `null` olsa bile dönülebilir; `customerItemAlias.alias` NOT NULL'dur ve eski değer
   her zaman bir metindir. Yani "geri alınamaz" kovası bu iki tabloda BOŞ.
2. **Geçmiş belge bozulmaz:** müşteri belgesindeki ad DONMUŞTUR (`docs/kurallar/belge-etiket.md`
   "müşterideki ad donar, rejim donmaz") — alias satırı silinse bile basılmış/dondurulmuş
   belgelerdeki ad değişmez. Alias satırı yalnız BUNDAN SONRAKİ belgelerin adını seçer.
3. Satırın parasal/ticari/kalite sonucu yoktur (yalnız müşterinin bizim kayda verdiği ad)
   ve değişikliğin KENDİSİ `ImportRunLine`da defterli kalır — ③b'nin "değişiklik karar
   defterine yazılır" şartı böyle karşılanır.

⚠️ `assigned` ile `alias` BAĞIMSIZDIR (şema yorumu üç kombinasyonu sayıyor). Ölçüm:
import yalnız `alias` yazar (`customer-alias.service.ts` upsert), `assigned` varsayılan
`false` kalır ⇒ koşumun yarattığı satır HER ZAMAN `assigned:false`'tur; müşteriye özel
renk (`assigned:true`) satırı import tarafından yaratılmış OLAMAZ, dolayısıyla geri sarma
onu hiç silmez.

### 8.3 `ImportRunLine` ne saklar — TAM SATIR DEĞİL, DOKUNULAN ALANLAR + YOK EDİLEN ÇOCUKLAR

| Alan | Neden |
|---|---|
| `importRunId` | koşum bağı (RESTRICT) |
| `rowNo` (+ `rowNos` gruplu şablonda) | kullanıcı satırı DOSYADA bulabilsin (`ImportRowResult` ile aynı kimlik) |
| `entity`, `tableName`, `recordId` | hangi kayıt, hangi tablo |
| `action`: `CREATE` · `UPDATE` · **`REVIVE`** | ters yol dalı bundan seçilir; `REVIVE` §8.1/6 tuzağının tek dürüst karşılığıdır |

**`REVIVE`ın tersi PASİFE ATMA DEĞİLDİR.** `CREATE`in tersi "kaydı pasife al"dır; `REVIVE`ın
tersi **"önceki alan değerlerini geri yaz + kaydı import'tan ÖNCEKİ pasif/aktif durumuna
döndür"**dür. İkisini karıştırmak, import'tan önce de VAR OLAN bir kaydı pasife atmak
demektir — yani geri sarma, geri almadığı bir şeyi bozar. Diriltme dalında çocuk pivotları
da silinmiş olabileceği için (`item.service.ts:252-264`,
`subcontractor-management.service.ts:533-542`) `childSnapshot` bu dalda da ZORUNLUDUR.
| `keyValue`, `label` | anahtar + insan-okunur ad (önizleme satırı tanıtır) |
| `changedFields Json` | **yalnız dokunulan alanlar**: `{alan: {from, to}}` |
| `childSnapshot Json?` | REPLACE edilen çocuk koleksiyonunun YOK EDİLEN hali (item izin listeleri · fabricProperty istasyon linkleri · subcontractor kategorileri · productRecipe özellikleri · route adım ağacı). **YENİDEN KURMAYA YETECEK KADAR**, satırın kopyası DEĞİL: id + kuruluma giren alanlar. Ölçüm (2026-09-12, fabrika kopyası): en büyük fotoğraf `route` adım ağacı — `RouteStep` 17 alanlı, rota başına EN ÇOK 4 adım (3 rota / 9 adım toplam) ve adım-özelliği 0 ⇒ fotoğraf ~1 KB mertebesinde. **Audit'e GİRMEZ**, `ImportRunLine`da yaşar (audit 6 ayda arşivlenir, geri sarma ondan sonra da mümkün olmalı). Kişisel veri taşıyan alanlar fotoğrafta da aynı izin kuralına tabidir. |
| `sideEffects Json?` | başka varlığa yazılan yan satırlar (sipariş → `promoteCustomerAliases`) |
| `revertedAt`, `revertedById`, `revertSkipReason` | geri sarma damgası / atlanma gerekçesi |

**Tam satır fotoğrafı SAKLANMAZ:** (i) önizleme katmanı zaten alan-bazlı farkı üretiyor
(`ImportRowResult.changes: Record<string, {from,to}>`) — aynı soruyu iki biçimde saklamak
tek-kaynak kuralını kırar; (ii) tam fotoğraf, import'un DOKUNMADIĞI alanları da geri
yazma riskini getirir (aradaki meşru değişiklik sessizce ezilir); (iii) satır şişer.
ÇOCUK koleksiyonu istisnadır: replace semantiği eski satırları YOK ETTİĞİ için fotoğraf
olmadan geri dönüş imkânsızdır (ölçüm: beş varlıkta eski küme hiçbir audit yükünde yok).

**Sır hijyeni:** 17 adaptörün hiçbiri parola/PIN/token sütunu taşımıyor (tüm `COLUMNS`
dizileri okundu). Kural yine yazılı: `changedFields`e sır alanı YAZILMAZ; böyle bir sütun
bir gün import'a girerse defterde MASKELENİR (`"***"`). ⚠️ KİŞİSEL VERİ vardır
(`taxNumber`, `phone`, `email`, `address`): önizleme ve dışa aktarım bunları yeni bir
sızma yüzeyine çevirmez — geri sarma önizlemesi yalnız ALAN ADI + "değişti" bilgisini
basar, değerleri yalnız ilgili varlığın write iznine sahip kullanıcıya gösterir.

### 8.4 "Yalnız o alan hâlâ aynıysa" — ATOMİK CLAIM

```ts
const claim = await tx.<model>.updateMany({
  where: { id: line.recordId, <alan>: line.changedFields[<alan>].to },  // hâlâ import'un yazdığı değer
  data: { <alan>: line.changedFields[<alan>].from },                    // önceki değere dön
});
if (claim.count === 0) skipped.push({ line, reason: "Kayıt içe aktarımdan sonra değişti" });
```

`findUnique→if→update` YASAK. `count === 0` bir HATA değil bir DALDIR: satır "atlandı"
listesine GEREKÇESİYLE girer, geri sarma devam eder (tek değişmiş alan tüm koşumu geri
alınamaz yapmamalı) ve gerekçe `ImportRunLine.revertSkipReason`a YAZILIR — "neden
atlandı" sorusu da deftere düşer.

### 8.5 Önizleme ucu ve per-record seçim

- `GET /api/import/runs/:id/revert-preview` — izin `data:import` + varlığın kendi write
  izni (mevcut çift-kapı düzeni; YENİ izin kodu AÇILMAZ).
- Dönüş satır satır: `rowNo`, `entity`, `recordId`, `label`, `action`, yapılacak işlem
  (`DEACTIVATE` · `RESTORE_FIELDS` · `RESTORE_CHILDREN` · `CANCEL_DOCUMENT` ·
  `DELETE_PIVOT`) ve geri alınamayanlar için `blocker` metni.
- **Atlama gerekçeleri AYRI AYRI** görünür ("kayıt sonradan değişti" · "sipariş sevk
  edildi" · "kayıt zaten pasif" · "çocuk satırlarını başkası değiştirdi" · "satırın
  yazarı import değil"). Tek bir "atlandı" kovası kullanılmaz; "12 satır atlanacak"
  ÖZETİ YETMEZ (emsal: `ReverseStockCountDialog`, `MergeHistoryDialog`, kartela
  `blocked` listesi).
- `sideEffects` satırları önizlemede AYRI BÖLÜM: sipariş geri sarılırken doğan alias
  master satırları ne silinir ne sessizce bırakılır — kullanıcıya "bunlar kalacak"
  denir (silmek başka varlığın ana verisini import kararıyla yok etmek olurdu).
- `POST /api/import/runs/:id/revert` gövdesi: `reason` (≥10 karakter) + `selectedRowNos`
  — seçim BOŞSA 400 (sessiz tam-geri-sarma riski).
- Yüzey `DataImportPage` koşum geçmişinde; bugünkü `ImportRunDetail`
  (`options`/`errorReport`/`clientToken`) genişletilir, yeni ekran açılmaz.

### 8.6 Migration bandı, izin, kapılar

- Migration **`20260912160200`**: `ImportRunLine` + `ImportRun`a `revertedAt`/
  `revertedById`/`revertReason`. İlk tahsis `130200` idi, ölçümle değişti: dizinde
  `20260912150300` vardı ⇒ `130200` uygulanmış migration'ların ADINDAN önce gelir,
  Prisma'nın sırası ad tabanlı olduğu için temiz DB'de önce, canlıda sonra uygulanır
  (aynı şema iki farklı sırayla kurulur). İkinci tahsis (`160000`) da tutmadı:
  01'in `20260912160100`ü araya girdi ⇒ bant ÜÇÜNCÜ kez taşındı. Aynı bandın üç kez
  kayması, sorunun tahsis disiplini değil KAPI YOKLUĞU olduğunun ölçümüdür.
- **Aynı dilimde kapatılacak KAPI BOŞLUĞU:** `test_migration_hygiene.ts` pending /
  elle-resolve / dizin okunabilirliği soruyor ama AD SIRASI sormuyor. Eklenecek
  kontrol: *dizindeki uygulanmamış bir migration'ın adı, uygulanmış en büyük addan
  BÜYÜK olmalı.* Negatif sonda: bilerek geriye düşen ad → kırmızı. (Ölçüm: bugün
  pending migration yok, en büyük ad `20260912150300` — kontrol yeşil başlar.)
- İzin: YENİ KOD YOK (`data:import` + varlığın write izni).
- APK: YOK. Panel sürümü gerekir (geri sarma diyaloğu).
- Bekçi `test_import_revert.ts`: her uygulanan satır bir `ImportRunLine` (CREATE ·
  UPDATE · REVIVE) · yaratılan kayıt pasife alınır · güncellenen kayıt alan-bazlı döner ·
  çocuk fotoğrafı geri yazılır (route adım ağacı) · "alan değişmiş" atlama dalı ·
  diriltme dalı `isActive:false` YAPMAZ · sipariş dalı mevcut iptal yolunu kullanır ·
  alias pivotunda `assigned:true` satır SİLİNMEZ · çift geri sarma 409 · önizleme ↔
  işlem aynı planı görür. Negatif sondalar: atomik claim'i `findUnique→if→update` yap →
  atlama dalı kırmızı · `childSnapshot` yazımını kaldır → route adım geri yazımı kırmızı ·
  `REVIVE` dalını `CREATE`e düşür → diriltme kontrolü kırmızı.

### 8.7 Uygulama kararları — kod indiğinde ÖLÇÜLEN, sözleşmeyi DARALTAN noktalar

> §8.0–§8.6 koddan ÖNCE yazıldı. Aşağıdakiler yazarken ölçüldü ve bazıları yukarıyı
> daraltıyor; çelişen cümle bırakılmadı.

1. **Çocuk anahtarları `changedFields`ten ÇIKARILIR**, `childSnapshot`a **`{from,to}`
   çifti** olarak girer. Ölçüm: motorun diff'i `changes[k] = {from: found[k], to: v}`
   yazıyor (`import.service.ts:272-274`) ve `findExisting` beş varlıkta eski çocuk
   kümesini KOD LİSTESİ olarak zaten sunuyor (`item.adapter.ts:121-122`,
   `fabric-property.adapter.ts:106-107`, `product-recipe.adapter.ts:113`,
   `subcontractor.adapter.ts:131`, `route.adapter.ts:188-196`) ⇒ aynı gerçek İKİ
   kolonda dururdu, §8.3'ün (i) gerekçesi bunu yasaklıyor. `to` tarafı SAKLANIR
   çünkü **çocuğun claim'i odur**: "küme hâlâ import'un yazdığı mı?" sorusu onsuz
   sorulamaz ve geri yazım körleşirdi.
2. **Adaptör sözleşmesi DEĞİŞMEDİ.** Fotoğraf `PreparedRow.existing`ten türüyor;
   yeni bir `childSnapshot()` kancası gerekmedi. Geri yazım da KODLARLA yapılır
   (id'lerle değil) — adaptörün kendi yolu kodu id'ye çeviriyor, id'ler ise silinmiş
   olabilir.
3. **Defter satırları koşum satırının `upsert`i İÇİNDE** iç içe `createMany` ile
   yazılır. Tek ifade ⇒ "koşum var ama defteri yok" durumu TEMSİL EDİLEMEZ (ayrı bir
   `createMany` düşerse geri sarma "hiçbir şey yazılmamış" diye yanlış cevap verirdi).
   FK'yi Prisma ebeveynden türettiği için yük FK'sizdir.
4. **`REVIVE` yalnız GÖZLENEBİLİR durumda yazılır** (`changedFields.isActive`
   `false → true`). Ölçüm: `findExisting` pasif kaydı da döndürüyor, bu yüzden
   diriltme normalde UPDATE'e düşer; servisin CREATE yolundaki `REACTIVATE` dikişi
   (`base.service.ts` ~1040-1070) motordan GÖRÜNMÜYOR ve o dal bugün `CREATE`
   kaydedilir. Uydurma tespit yazılmadı — kapatılması servisin "dirilttim" bilgisini
   DÖNDÜRMESİNİ gerektirir (ayrı iş). §8.1/6'nın "önizleme CREATE der" cümlesi bu
   ölçümle sınırlanır.
5. **Çocuk geri yazımı KENDİNİ DOĞRULAYAN yazımdır:** adaptörün `updateOne`'ı koşar
   (guard'lar + kod→id çözümü korunur), sonra sonuç `findExisting` ile OKUNUR;
   beklenen kümeye eşit değilse tx düşer ve satır gerekçesiyle atlanır. Sessiz yanlış
   geri yazım imkânsız.
6. **Sipariş dalı `OrderService.softDelete`** (mevcut iptal yolu: atomik claim +
   iş emri/sevkiyat guard'ları). Servis katmanı route'tan import ETMEZ — yerel örnek
   `{modelName:"order", tableName:"ORDER"}` ile kurulur; iptal yolu `this.config`ten
   YALNIZ `tableName` okuyor (ölçüldü `order.service.ts:2899`).
7. Plan tablosu **`REVERT_PLAN` (17 varlık)** `import-revert.service.ts`te; dal
   yazımları `import-revert.branches.ts`te.
8. **Çift geri sarma SATIR bazlıdır** (`updateMany WHERE {id, revertedAt:null}`):
   seçilenlerin HEPSİ geri sarılmışsa 409. Kısmi seçim meşru olduğu için (5 satır
   şimdi, 5 satır sonra) koşum damgası ancak geri sarılmamış satır kalmadığında konur.
9. Bekçi **`test_import_revert.ts` 40/0** (`tekserp_ea_test`); kırmızısı ÖNCE ölçüldü
   (servis yokken 3 kontrol kırmızı, saf yük + motor kontrolleri yeşil).
   **KÖRLÜK ZEMİNİ:** route adım ağacının ve alias pivotunun DB geri yazımı fixture'la
   KOŞULMUYOR (istasyon/müşteri fixture'ı gerekir) — o iki dal plan tablosu ve saf yük
   üzerinden ölçülür ve bu cümle bekçinin ÇIKTISINDA da basılır.
10. Panel: `ImportRevertDialog` koşum geçmişinden açılır (yeni ekran yok).
    `ImportLineAction` etiketleri **audit sözlüğünden** okunur (`enumValueLabel`);
    ikinci bir etiket haritası AÇILMADI — reçetenin `types/enums.ts` aynası yalnız
    panel o enum'a göre DALLANDIĞINDA gerekir, burada yalnız gösteriliyor.
