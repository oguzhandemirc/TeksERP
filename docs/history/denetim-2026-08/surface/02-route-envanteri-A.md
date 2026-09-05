# Route Envanteri — GRUP A

**Kapsam:** `src/routes/admin.routes.ts`, `workorder.routes.ts`, `inventory.routes.ts`, `tambur.routes.ts`, `label.routes.ts`
**Amaç:** Denetimin nereye bakacağını belirlemek. Bu bir bulgu raporu DEĞİL, yüzey envanteri + risk işaretleridir.
**Tarih:** 2026-08-09 · **Yöntem:** salt-okuma (Read/Grep/sed). Hiçbir kod dosyası değiştirilmedi.

---

## 1. Özet

| Ölçüt | Değer | Kaynak |
|---|---|---|
| Toplam endpoint (Grup A) | **141** | `grep -cE "^\s*router\.(get\|post\|put\|patch\|delete)"` — admin 40, workorder 32, inventory 24, tambur 20, label 25 |
| Ek olarak: iç içe mount | 1 adet (`router.use("/:id/traveler-cards", …)`) → 3 endpoint, **Grup A dışı dosyada** (`traveler-card.routes.ts`) | `workorder.routes.ts:15` |
| Auth guard'ı OLMAYAN endpoint | **0** | `grep -c "verifyToken,"` her dosyada endpoint sayısına eşit (40/32/24/20/25) |
| İzin guard'ı OLMAYAN endpoint | **0** | `requirePermission` + `requireAnyPermission` sayıları endpoint sayısını karşılıyor (aşağıda §5.1 açıklaması) |
| İki izni AND'leyen endpoint | **3** (hepsi admin/backup) | admin'de 43 `requirePermission` çağrısı / 40 endpoint |
| Controller'a delege ETMEYEN inline handler | **41** (admin 40 + inventory 1) | §5.3 |
| `clientToken` idempotency taşıyan endpoint | **8** | §5.4 |
| Dış sisteme çıkan endpoint | **6** (2 RAW TCP yazıcı, 4 dosya sistemi / child process) | §5.5 |
| Route katmanından doğrudan `AuditService` çağrısı | **6 yazma + 2 okuma** (yalnız admin.routes) | `grep -n "AuditService\." src/routes/admin.routes.ts` |

**Mount yolları** (`src/app.ts:392-439`): `/api/admin` (satır 434, `/api/admin/db-copies` satır 433 ve `/api/admin/devices` satır 438 ayrı router'lar) · `/api/work-orders` (403) · `/api/rolls` (401) · `/api/tambur` (405) · `/api/labels` (421).

**Sütun sözlüğü**
- *Yan etki:* `R` salt-okuma · `W` yazma · `D` yıkıcı (iptal/sil/statü düşürme/fiziksel taşıma) · `X` dış sistem (dosya, child process, TCP).
- *İdempotent:* aynı isteğin ikinci kez gönderilmesi sistemi aynı sonuçta bırakır mı.

---

## 2. `/api/admin` — `admin.routes.ts` (40 endpoint)

> Bu dosyada **controller katmanı yoktur**; 40 handler da route içinde Zod parse edip servise delege eder. `CLAUDE.md` bunu "ince read/ayar endpoint'leri" istisnası olarak yazıyor — dosyanın gerçek içeriğiyle karşılaştırması §6-R1'de.

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Handler → Servis |
|---|---|---|---|---|---|---|---|
| 1 | GET | /api/admin/permissions | verifyToken + `admin:users` | R | evet | — | inline → `PermissionManagementService.listPermissions` |
| 2 | GET | /api/admin/users | verifyToken + `admin:users` | R | evet | — | inline → `PermissionManagementService.listUsers` |
| 3 | POST | /api/admin/users | verifyToken + `admin:users` | W | **hayır** (username `@unique`; ayrıca rastgele PIN/kart üretebilir) | — | inline → `createUser` |
| 4 | GET | /api/admin/users/:id | verifyToken + `admin:users` | R | evet | — | inline → `getUserById` |
| 5 | PATCH | /api/admin/users/:id | verifyToken + `admin:users` | W | evet (yalnız `fullName`) | — | inline → `updateUser` |
| 6 | POST | /api/admin/users/:id/deactivate | verifyToken + `admin:users` | D (oturumları düşürür) | ŞÜPHELİ — `deactivateUser` gövdesi okunmadı; `tokenVersion` tekrar artıyorsa 2. çağrı ek yan etki üretir | — | inline → `deactivateUser` |
| 7 | POST | /api/admin/users/:id/reactivate | verifyToken + `admin:users` | W | ŞÜPHELİ (aynı gerekçe) | — | inline → `reactivateUser` |
| 8 | DELETE | /api/admin/users/:id | verifyToken + `admin:users` | D (soft: `deletedAt` + username serbest bırakma + PIN/kart temizleme + tüm oturum revoke) | **evet** — `permission-management.service.ts:715` `if (existing.deletedAt) return existing` | — | inline → `deleteUser` |
| 9 | GET | /api/admin/users/:id/permissions | verifyToken + `admin:users` | R | evet | — | inline → `getUserPermissions` |
| 10 | POST | /api/admin/users/:id/permissions | verifyToken + `admin:users` | W | **evet** — `upsert` (`:176`) | — | inline → `grantPermission` |
| 11 | PUT | /api/admin/users/:id/permissions | verifyToken + `admin:users` | W (hedef-state; eksikleri KALDIRIR) | evet | — | inline → `setUserPermissions` |
| 12 | DELETE | /api/admin/users/:id/permissions/:permissionId | verifyToken + `admin:users` | D (yetki iptali) | evet | — | inline → `revokePermission` |
| 13 | POST | /api/admin/users/:id/reset-password | verifyToken + `admin:users` | D (tüm oturumları düşürür) | ŞÜPHELİ — sonuç durumu aynı ama yan etki (oturum revoke + `tokenVersion++`) her çağrıda tekrarlar | — | inline → `resetUserPassword` |
| 14 | POST | /api/admin/users/:id/card-token | verifyToken + `admin:users` | W (sır rotasyonu) | **hayır** — her çağrı yeni 32-hex token, eski kart anında geçersiz | — | inline → `AuthService.rotateCardToken` |
| 15 | GET | /api/admin/users/:id/credentials | verifyToken + `admin:users` | R (**hassas**: düz hızlı PIN + kart kodu döner) | evet | — | inline → `AuthService.getUserCredentials` |
| 16 | POST | /api/admin/users/:id/quick-pin | verifyToken + `admin:users` | W | **koşullu** — `pin` verilirse evet; verilmezse rastgele üretir → hayır | — | inline → `AuthService.setQuickPin` |
| 17 | POST | /api/admin/users/:id/apply-template | verifyToken + `admin:users` | W (`mode=replace` → mevcut yetkileri siler) | evet (aynı şablon+mod) | — | inline → `applyTemplate` |
| 18 | GET | /api/admin/permission-templates | verifyToken + `admin:users` | R | evet | — | inline → `listTemplates` |
| 19 | GET | /api/admin/permission-templates/:id | verifyToken + `admin:users` | R | evet | — | inline → `getTemplate` |
| 20 | POST | /api/admin/permission-templates | verifyToken + `admin:users` | W | **hayır** (her çağrı yeni satır) | — | inline → `createTemplate` |
| 21 | PATCH | /api/admin/permission-templates/:id | verifyToken + `admin:users` | W | evet | — | inline → `updateTemplate` |
| 22 | DELETE | /api/admin/permission-templates/:id | verifyToken + `admin:users` | D (sistem rolünde pasifleştirme) | evet | — | inline → `deleteTemplate` |
| 23 | GET | /api/admin/perf | verifyToken + `admin:settings` | R (bellek) | evet | — | inline → `latency-stats` + `latency-persist` |
| 24 | GET | /api/admin/perf/history | verifyToken + `admin:settings` | R | evet | — | inline → `latencyHistory` / `latencyHistoryRoutes` |
| 25 | POST | /api/admin/perf/reset | verifyToken + `admin:settings` | W (bellek sayaç sıfırlama) + **route'ta audit** | evet | — | inline → `resetLatencyStats` + `AuditService.log` |
| 26 | POST | /api/admin/sessions/purge | verifyToken + `admin:settings` | **D + fiziksel DELETE** | evet (2. koşum 0 satır) | — | inline → `SessionRegistryService.purgeDeadSessions` |
| 27 | POST | /api/admin/system-logs/archive | verifyToken + `admin:settings` | **D** (satırları arşiv tablosuna TAŞIR) | evet | — | inline → `AuditService.archiveOlderThan` |
| 28 | GET | /api/admin/system-logs/stats | verifyToken + `admin:settings` | R | evet | — | inline → `AuditService.getLogStats` |
| 29 | GET | /api/admin/system-logs | verifyToken + `admin:settings` | R (cursor) | evet | — | inline → `SystemLogService.list` |
| 30 | GET | /api/admin/system-logs/users | verifyToken + `admin:settings` | R | evet | — | inline → `SystemLogService.listActiveUsers` |
| 31 | GET | /api/admin/system-logs/tables | verifyToken + `admin:settings` | R | evet | — | inline → `SystemLogService.listActiveTables` |
| 32 | GET | /api/admin/system-logs/archive | verifyToken + `admin:settings` | R | evet | — | inline → `SystemLogService.listArchive` |
| 33 | GET | /api/admin/system-logs/archive/:id | verifyToken + `admin:settings` | R | evet | — | inline → `SystemLogService.findArchiveById` |
| 34 | GET | /api/admin/system-logs/:id | verifyToken + `admin:settings` | R | evet | — | inline → `SystemLogService.findById` — ⚠ literal kardeşlerinden SONRA tanımlı (doğru sıra, §5.2) |
| 35 | GET | /api/admin/settings | verifyToken + `admin:settings` | R | evet | — | inline → `systemSettingService.list` |
| 36 | PUT | /api/admin/settings/:key | verifyToken + `admin:settings` | W (jenerik key-value; `STRUCTURED_SETTING_KEYS` → 400) | evet | — | inline → `systemSettingService.set` |
| 37 | POST | /api/admin/backup | verifyToken + `admin:settings` | **W + X** (`pg_dump` child process, dosya yazma, rotasyon, offsite kopya) | **hayır** (her çağrı yeni dump; "sürüyor" hâlinde 400) | — | inline → `backup.service.triggerManualBackup` |
| 38 | GET | /api/admin/backups | verifyToken + `admin:settings` **AND** `admin:users` | R + X (dosya sistemi) | evet | — | inline → `listBackups` |
| 39 | GET | /api/admin/backups/:name/download | verifyToken + `admin:settings` **AND** `admin:users` | R + X (**hassas** dump akışı) | evet | — | inline → `resolveBackupPath` + `res.download` |
| 40 | GET | /api/admin/backups/:name/restore-impact | verifyToken + `admin:settings` **AND** `admin:users` | R (+ audit yazar) | evet | — | inline → `backup-impact.service.getRestoreImpact` |

**Not (doğrulandı, risk DEĞİL):** `resolveBackupPath` (`backup.service.ts:427-436`) path traversal'a kapalı — `path.basename` + `!== name` karşılaştırması + `.dump` uzantı zorunluluğu + `root + sep` ön ek kontrolü + `existsSync`.

---

## 3. `/api/work-orders` — `workorder.routes.ts` (32 endpoint + 1 iç içe mount)

Controller: `WorkOrderController` → `WorkOrderService` (tamamı). Kısaltma: `WO:r` = `workorder:read`, `WO:w` = `workorder:write`, `M:hie` = `mobile:hizli-is-emri`, `M:fs` = `mobile:fason-sevk`, `M:fk` = `mobile:fason-kabul`.

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Servis metodu |
|---|---|---|---|---|---|---|---|
| — | USE | /api/work-orders/:id/traveler-cards | (alt router) | — | — | — | `traveler-card.routes.workOrderTravelerRouter` — 3 endpoint (POST `/`, POST `/reprint`, GET `/history`), **Grup A dışı** |
| 1 | GET | / | verifyToken + any(`WO:r`, `M:fs`, `M:hie`) | R | evet | — | `findAll` |
| 2 | GET | /check-batch-number | any(`WO:r`, `WO:w`, `M:hie`) | R | evet | — | `checkBatchNumber` |
| 3 | GET | /:id | any(`WO:r`, `M:fs`, `M:hie`) | R | evet | — | `findById` |
| 4 | GET | /:id/branches | any(`WO:r`, `M:hie`) | R | evet | — | `getBranches` |
| 5 | GET | /:id/batches/:batchId/timeline | any(`WO:r`, `M:hie`) | R | evet | — | `getBatchTimeline` |
| 6 | GET | /:id/split-preview | `WO:r` | R | evet | — | `getSplitPreview` |
| 7 | POST | /:id/split | `WO:w` | **W** (yeni WO yaratır, canlı topları + açık sevki taşır) | **hayır** (her çağrı yeni WO) | yok | `splitBranch` |
| 8 | POST | /:id/manual-move-preview | `WO:r` | R (**POST ama salt-okunur**) | evet | — | `getManualMovePreview` |
| 9 | POST | /:id/manual-move | `WO:w` | **W** (süpervizör override; kalite/kurşun kararları VOID olabilir, `SKIPPED` adımlar açılır) | ŞÜPHELİ — servis atomik claim kullanıyor (CLAUDE.md), 2. çağrı 409/no-op olmalı ama uçtan doğrulanmadı | yok | `manualMove` |
| 10 | GET | /:id/travel-card | any(`WO:r`, `M:hie`) | R | evet | — | `getTravelCard` |
| 11 | GET | /:id/manifest | any(`WO:r`, `M:hie`) | R | evet | — | `getManifest` |
| 12 | POST | /:id/manifest | any(`WO:w`, `M:hie`) | W (kalıcı `Manifest` snapshot) | **hayır** — Swagger'da açıkça "aynı WO için birden fazla basım alınabilir" | yok | `createManifest` |
| 13 | GET | /:id/manifests | any(`WO:r`, `M:hie`) | R | evet | — | `listManifests` |
| 14 | GET | /manifest-by-id/:manifestId | any(`WO:r`, `M:hie`) | R | evet | — | `getManifestById` |
| 15 | POST | / | `WO:w` | W | **evet — `clientToken` ile** (opsiyonel; verilmezse hayır) | ✔ opsiyonel | `create` (P2002 replay: `workorder.service.ts:943-956`) |
| 16 | POST | /quick-start | any(`WO:w`, `M:hie`) | W (WO + top bağlama tek istekte) | **evet — `clientToken` ile** (opsiyonel) | ✔ opsiyonel | `quickStart` |
| 17 | PATCH | /:id | any(`WO:w`, `M:hie`) | W | evet | yok (bilinçli — controller yorumu) | `update` |
| 18 | PUT | /:id | any(`WO:w`, `M:hie`) | **W** (full replace; `WorkOrderStep`/`WorkOrderToOrderLine`/`WorkOrderTargetProperty` drop-and-recreate) | evet | yok (bilinçli) | `replace` |
| 19 | PATCH | /:id/steps/:stepId/planning | `WO:w` | W | evet | — | `updateStepPlanning` |
| 20 | PATCH | /:id/lock | `WO:w` | W (durum geçişi) | ŞÜPHELİ (claim davranışı doğrulanmadı) | — | `lockWorkOrder` |
| 21 | GET | /:id/rolls | any(`WO:r`, `M:hie`) | R | evet | — | `getAttachedRolls` |
| 22 | GET | /:id/documents | any(`WO:r`, `WO:w`, `M:hie`, `M:fs`, `M:fk`) | R | evet | — | `getDocuments` |
| 23 | GET | /:id/cancel-impact | any(`WO:w`, `M:hie`) | R (önizleme) | evet | — | `cancelImpact` — ⚠ salt-okuma ucu **write iznine** bağlı (§6-R4) |
| 24 | GET | /:id/complete-preview | `WO:w` | R (önizleme) | evet | — | `completePreview` — aynı ⚠ |
| 25 | POST | /:id/complete | `WO:w` **+ payload'a bağlı `roll:manual-adjust`** (controller içinde, `workorder.controller.ts:777`) | **D** (kapanış dispozisyonu: `SCRAP`/`CANCELLED`/`TRANSFER`) | ŞÜPHELİ — kapsam paritesi doğrulaması 400 üretir; 2. çağrı reddedilir | yok | `completeWorkOrder` |
| 26 | POST | /:id/cancel | any(`WO:w`, `M:hie`) **+ payload'a bağlı `roll:manual-adjust`** (`:697`) | **D** | ŞÜPHELİ (aynı) | yok | `softDelete` (karar veren gövde ile) |
| 27 | GET | /:id/batches/:batchId/drop-preview | `WO:w` | R (önizleme) | evet | — | `batchDropPreview` |
| 28 | POST | /:id/batches/:batchId/drop | `WO:w` **+ payload'a bağlı `roll:manual-adjust`** (`:734`) | **D** (parti üyeliğini koparır) | ŞÜPHELİ | yok | `dropBatch` |
| 29 | DELETE | /:id | any(`WO:w`, `M:hie`) | **D** (soft cancel; gövdesiz eski APK yolu) | evet (zaten CANCELLED ise) — ŞÜPHELİ, doğrulanmadı | yok | `softDelete` |
| 30 | DELETE | /:id/permanent | `WO:w` | **D** — ⚠ **Swagger "fiziksel siler" diyor, kod ARŞİVLİYOR** (`workorder.service.ts:3798-3828`, `isActive=false` + atomik claim) | evet (`isActive` false ise 409) | yok | `hardDelete` |
| 31 | GET | /:id/target-properties/impact | `WO:r` | R | evet | — | `getTargetPropertiesImpact` |
| 32 | PATCH | /:id/target-properties | `WO:w` | W (replace + bağlı `Roll.properties` senkronu) | evet | — | `updateTargetProperties` |

---

## 4. `/api/rolls` — `inventory.routes.ts` (24 endpoint)

Controller: `InventoryController` → `InventoryService` (bir inline handler hariç).
İzin kümeleri dosyada sabit olarak tanımlı: `MOBILE_ROLL_READ` (9 mobil izin, `:13-23`), `MOBILE_ROLL_WRITE_KK1` (`mobile:kk1`), `MOBILE_ROLL_WRITE_KURSUN` (`mobile:kk2-kursun`), `MOBILE_ROLL_CANCEL` (`mobile:kk1` + `mobile:depo`, `:41`).

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Servis metodu |
|---|---|---|---|---|---|---|---|
| 1 | GET | / | verifyToken + any(`roll:read`, …MOBILE_ROLL_READ) | R | evet | — | `findAllRolls` |
| 2 | GET | /barcode/:barcode | any(`roll:read`, …READ) | R | evet | — | `findRollByBarcode` |
| 3 | GET | /barcode/:barcode/relabel-context | any(`roll:read`,`roll:write`,`label:read`,`label:edit`, …READ) | R | evet | — | `getRelabelContext` |
| 4 | GET | /:id/relabel-context | aynı geniş küme | R | evet | — | `getRelabelContextById` |
| 5 | GET | /barcode | any(`roll:read`, …READ) | R | evet | — | **inline handler** (sabit 400 + kullanım mesajı; servise gitmez) |
| 6 | GET | /stats | any(`roll:read`, …READ) | R (aggregate) | evet | — | `getRollStats` |
| 7 | POST | /stats-batch | any(`roll:read`, …READ) | R (**POST ama salt-okunur**) | evet | — | `getRollStatsBatch` |
| 8 | GET | /production-flow | any(`roll:read`, …READ) + **kolon bazlı iç filtre** (`quality:read`, `shipping:read/write` — `inventory.controller.ts:270-272`) | R | evet | — | `getProductionFlow` |
| 9 | GET | /warehouse-scope | any(`roll:read`, …READ) | R | evet | — | `getWarehouseScope` |
| 10 | GET | /subcontractor-summary | any(`roll:read`, …READ) | R | evet | — | `getSubcontractorSummary` |
| 11 | GET | /:id | any(`roll:read`, …READ) | R | evet | — | `findRollById` |
| 12 | GET | /:id/history | any(`roll:read`, `roll:history`, …READ) | R | evet | — | `getRollHistory` |
| 13 | POST | /initial-entry | any(`roll:write`, `mobile:kk1`) + **çalışma oturumu zorunlu (mobil)** `enforceForMobile` (`:220`) | **W** (yeni top + barkod) | **evet — `clientToken` ile** (opsiyonel) + ayrı `kk1.duplicateGuardEnabled` tuzağı | ✔ opsiyonel | `createInitialEntry` |
| 14 | GET | /:id/cancel-preview | any(`roll:write`, `mobile:kk1`, `mobile:depo`) | R (önizleme) | evet | — | `getCancelPreview` — ⚠ read ucu write iznine bağlı |
| 15 | DELETE | /:id | any(`roll:write`, `mobile:kk1`, `mobile:depo`) | **D** (soft → `CANCELLED`; `?confirmActive=true` gerekebilir) | ŞÜPHELİ (statü guard'ı 2. çağrıyı reddetmeli, doğrulanmadı) | yok | `softDelete` |
| 16 | POST | /:id/restore-cancel | any(`roll:write`, `mobile:kk1`, `mobile:depo`) | W (storno'nun storno'su) | ŞÜPHELİ (409 `RESTORE_BLOCKED` bekleniyor) | yok | `restoreCancelled` |
| 17 | DELETE | /:id/permanent | `roll:write` (tekil) | **D** (Swagger dürüst: "arşivle — soft, CANCELLED") | evet | — | `hardDelete` |
| 18 | PATCH | /:id/label | any(`roll:write`, `label:edit`, `mobile:tarti-paket`, `mobile:sevkiyat`) | W (renk/en/kalite/özellik + yeniden bas) | evet | — | `relabel` |
| 19 | POST | /:id/prepare-for-sale | any(`roll:write`, `mobile:tarti-paket`, `mobile:sevkiyat`, `mobile:hizli-is-emri`) | W (`STOCK` → `WAREHOUSE`) | ŞÜPHELİ (statü guard'ı) | yok | `prepareRawForSale` |
| 20 | PATCH | /:id/manual-attributes | `roll:manual-adjust` (tekil) | W (+ zorunlu sebep, audit `MANUAL_ATTRIBUTE`) | evet | — | `applyManualProperties` sarmalı |
| 21 | GET | /:id/rescue-preview | `roll:manual-adjust` (tekil) | R | evet | — | `getRescuePreview` |
| 22 | POST | /:id/rescue-stuck | `roll:manual-adjust` (tekil) | **W** (açık movement kapatır, `WAREHOUSE`'a çeker, barkod üretir, adım/WO recompute) | ŞÜPHELİ (409 bekleniyor) | yok | `rescueStuckRoll` |
| 23 | POST | /open-fabric | any(`roll:write`, `mobile:kk2-kursun`) | W (barkodsuz açık kumaş Roll) | **evet — `clientToken` ile** (opsiyonel) | ✔ opsiyonel | `createOpenFabric` — ⚠ oturum zorunluluğu YOK (kardeş uçlardan farklı) |
| 24 | POST | /:id/kursun-finish | any(`roll:write`, `mobile:kk2-kursun`) + **oturum zorunlu (mobil)** (`:182`) | W (metraj + `RollError` insert + movement kapat/aç) | **evet** — Swagger: "Roll PROCESS_QC'yi bırakmışsa 200 döner" | yok | `kursunFinish` |

---

## 5. `/api/tambur` — `tambur.routes.ts` (20 endpoint)

İki controller aynı router'da: `TamburController` → `TamburService` / `TamburUndoService` / `KursunBypassService`; `TamburManualController` → `TamburManualService`.

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Handler → Servis |
|---|---|---|---|---|---|---|---|
| 1 | GET | /pending-rolls | verifyToken + any(`quality:read`, `mobile:tambur`) | R | evet | — | `controller.getPendingRolls` → TamburService |
| 2 | GET | /recent-output-rolls | any(`quality:read`, `mobile:tambur`) | R (cursor) | evet | — | `listRecentOutputRolls` |
| 3 | GET | /by-card/:barcode | any(`quality:read`, `mobile:tambur`) | R | evet | — | `getByCardBarcode` |
| 4 | GET | /step/:stepId | any(`quality:read`, `mobile:tambur`) | R | evet | — | `getStep` |
| 5 | GET | /open-cards | any(`quality:read`, `mobile:tambur`) | R (tablet 5 sn'de bir yoklar — CLAUDE.md) | evet | — | `listOpenCards` |
| 6 | POST | /report-error | any(`quality:write`, `mobile:tambur`) | W (yeni `RollError`) | **hayır** (her çağrı yeni hata satırı) | yok | `reportError` |
| 7 | GET | /rolls/:rollId | any(`quality:read`, `mobile:tambur`) | R | evet | — | `getRollForDecision` |
| 8 | GET | /rolls/:rollId/undo-preview | any(`quality:read`, `mobile:tambur`, `mobile:tambur-duzelt`) | R (önizleme) | evet | — | `getUndoPreview` → **TamburUndoService** — path param `z.string().uuid()` ile doğrulanıyor (`:168`) |
| 9 | POST | /rolls/:rollId/undo | any(`quality:write`, `mobile:tambur`, `mobile:tambur-duzelt`) | **D** (parçaları iptal eder, kaynağı adıma döndürür, kapatılan hataları yeniden açar, tamamlanmış WO'yu diriltir) | ŞÜPHELİ (mod tx içinde taze çözülür, 409 bekleniyor) | yok | `applyUndo` → TamburUndoService |
| 10 | POST | /finalize | any(`quality:write`, `mobile:tambur`) + **oturum zorunlu (mobil)** (`:408`) | **W** (roll split: yeni barkodlu child Roll'lar) | **hayır** (clientToken yok; kesim tekrarı yeni çocuk üretir) | yok | `finalize` |
| 11 | GET | /context/:cardBarcode | any(`quality:read`, `mobile:tambur`) + **iç yetki dallanması** `allowEmptyStep` (`mobile:tambur-duzelt` \| `roll:manual-adjust`, `:268-269`) | R | evet | — | `getTamburContext` |
| 12 | POST | /bypass-complete | any(`quality:write`, `mobile:tambur`) + **oturum zorunlu (mobil)** (`:284`) | **W** (kurşun adımını kapatır, topları Tambur'a taşır) | **evet** — Swagger: `alreadyDone=true`; kapsam değiştiyse 409 | yok | `completeKursunBypass` → **KursunBypassService** |
| 13 | POST | /manual/bring-preview | any(`roll:manual-adjust`, `mobile:tambur-duzelt`) + oturum zorunlu | R (**POST ama salt-okunur**) | evet | — | `manualController.getBringPreview` → TamburManualService |
| 14 | POST | /manual/bring | any(`roll:manual-adjust`, `mobile:tambur-duzelt`) + oturum zorunlu | **W** (aynı motor: `WorkOrderManualMoveService`) | ŞÜPHELİ (atomik claim → 409 `MOVE_REJECTED`) | yok | `bringRoll` |
| 15 | POST | /manual/roll | any(`roll:manual-adjust`, `mobile:tambur-duzelt`) + oturum zorunlu | **W** — "envanter zincirindeki tek DELİK" (dosya yorumu) | **evet — `clientToken` ZORUNLU** (`tambur-manual.controller.ts:62`) | ✔ **zorunlu** | `createManualRoll` |
| 16 | POST | /manual/produce | any(`roll:manual-adjust`, `mobile:tambur-duzelt`) + oturum zorunlu | **W** (kartsız bitmiş ürün → doğrudan `WAREHOUSE`) | **evet — `clientToken` ZORUNLU** (`:121`), yanıt `idempotentReplay` | ✔ **zorunlu** | `produceFinishedRoll` |
| 17 | POST | /:id/cut | any(`quality:write`, `mobile:tambur`) | W (child Roll) | **evet — `clientToken` ile** (opsiyonel; `tambur.service.ts:2061-2069` P2002 replay) | ✔ opsiyonel | `cutOpenFabric` |
| 18 | POST | /:id/finalize-open-fabric | any(`quality:write`, `mobile:tambur`) + oturum zorunlu (`:245`) | **D/W** (parent `TAMBUR_CONSUMED`, kalan için fire kararı) | ŞÜPHELİ | yok | `finalizeOpenFabric` |
| 19 | POST | /:id/cut-warehouse | any(`quality:write`, `mobile:tambur`) | W (depo topundan child) | **evet — `clientToken` ile** (opsiyonel; `:2617-2625`) | ✔ opsiyonel | `cutWarehouseRoll` |
| 20 | POST | /:id/finalize-warehouse-cut | any(`quality:write`, `mobile:tambur`) | **D/W** (parent arşiv + kalan kararı) | ŞÜPHELİ | yok | `finalizeWarehouseCut` |

---

## 6. `/api/labels` — `label.routes.ts` (25 endpoint)

Controller: `LabelController` → `LabelService` (tamamı). `MOBILE_LABEL_PRINTERS` = `mobile:kk1`, `mobile:tambur`, `mobile:tarti-paket` (`:20`). `SACK_LABEL_READ` = any(`label:read`, `mobile:tarti-paket`, `mobile:sevkiyat`) (`:439`, üç uçta paylaşılıyor).

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Servis metodu |
|---|---|---|---|---|---|---|---|
| 1 | GET | /rolls/:id | verifyToken + any(`label:read`, …PRINTERS) | R | evet | — | `getRollLabel` |
| 2 | GET | /rolls/:id/html | any(`label:read`, …PRINTERS) | R | evet | — | `getRollLabelHtml` |
| 3 | GET | /rolls/:id/ppla | any(`label:read`, …PRINTERS) | R | evet | — | `getRollLabelPpla` |
| 4 | GET | /rolls/:id/native | any(`label:read`, …PRINTERS) | R | evet | — | `getRollLabelNative` |
| 5 | GET | /rolls/:id/preview | any(`label:read`, …PRINTERS) | R | evet | — | `getRollPreview` |
| 6 | POST | /rolls/:id/print-native | any(`label:print`, …PRINTERS) | **X + W** — RAW TCP :9100 gönderim (`device-transport.ts:41`) + audit `LABEL_NATIVE_PRINT` | **hayır** (her çağrı fiziksel etiket basar) | yok | `printRollNative` |
| 7 | GET | /peripherals/:id/sample-html | any(`label:read`, `station:read`, …PRINTERS) | R (mock veri) | evet | — | `getSampleLabelHtml` |
| 8 | POST | /test-native | any(`label:print`, `station:write`) | **X** — gövdeden gelen `printerIp` + `port`'a RAW TCP | hayır | yok | `testNativeSend` — ⚠ §7-R2 |
| 9 | POST | /rolls/bulk-html | any(`label:read`, …PRINTERS) | R (**POST ama salt-okunur** — N top → tek HTML) | evet | — | `getBulkRollLabelsHtml` |
| 10 | POST | /rolls/bulk-native | any(`label:read`, …PRINTERS) | R (üretir, göndermez) | evet | — | `getBulkRollLabelsNative` |
| 11 | POST | /preview/html | `label-template:read` (tekil) | R (kaydedilmemiş şablon önizleme) | evet | — | `getPreviewHtml` |
| 12 | POST | /preview/native-text | `label-template:read` (tekil) | R | evet | — | `getPreviewNativeText` |
| 13 | GET | /swatches/:id | any(`label:read`, `mobile:tambur`, `mobile:tarti-paket`) | R | evet | — | `getSwatchLabel` |
| 14 | GET | /swatches/:id/html | aynı | R | evet | — | `getSwatchLabelHtml` |
| 15 | GET | /swatches/:id/native | aynı | R | evet | — | `getSwatchLabelNative` |
| 16 | GET | /sacks/:id | `SACK_LABEL_READ` | R | evet | — | `getSackLabel` |
| 17 | GET | /sacks/:id/html | `SACK_LABEL_READ` | R (şablon yoksa **fail-closed 400**) | evet | — | `getSackLabelHtml` |
| 18 | GET | /sacks/:id/native | `SACK_LABEL_READ` | R | evet | — | `getSackLabelNative` |
| 19 | POST | /sacks/:id/print-event | any(`label:print`, `mobile:tarti-paket`, `mobile:sevkiyat`) | W (audit-only iz) | evet (yeni audit satırı doğar ama durum değişmez) | yok | `recordSackPrintEvent` |
| 20 | PATCH | /order-lines/:id | `label:edit` (tekil) | **W** — ⚠ `OrderLine` yazıyor (kaynak farklı domain; sipariş satırına bağlı TÜM topları etkiler) | evet | — | `updateOrderLineCustomerNames` |
| 21 | POST | /rolls/:id/print | any(`label:print`, …PRINTERS) | W (audit-only) | evet | yok | `recordPrintEvent` |
| 22 | POST | /rolls/:id/seed-snapshot | any(`label:print`, …PRINTERS) | W (`Roll.lastLabelSnapshot` yazar) | evet | yok | `seedRollLabelSnapshot` |
| 23 | GET | /standalone-templates | any(`label:print`, `label-template:read`, …PRINTERS) | R | evet | — | `listStandaloneTemplates` |
| 24 | GET | /templates/:id/native | any(`label:print`, `label-template:read`, …PRINTERS) | R (mock payload) | evet | — | `getStandaloneTemplateNative` |
| 25 | GET | /templates/:id/html | aynı | R (mock payload) | evet | — | `getStandaloneTemplateHtml` |

---

## 7. Özel işaretlemeler

### 7.1 Auth guard'ı OLMAYAN endpoint: **YOK** (0/141)

Mekanik doğrulama: her dosyada `grep -c "verifyToken,"` endpoint sayısına eşit (40/32/24/20/25). İzin guard'ı da eksiksiz — sayım şöyle kapanıyor:

| Dosya | endpoint | `requirePermission` | `requireAnyPermission` | Açıklama |
|---|---|---|---|---|
| admin | 40 | 43 | 0 | 3 fazlalık = üç yedek ucundaki **AND** zinciri (`/backups`, `/backups/:name/download`, `/backups/:name/restore-impact`) |
| workorder | 32 | 14 | 18 | 14+18 = 32 ✓ |
| inventory | 24 | 4 | 20 | 4+20 = 24 ✓ |
| tambur | 20 | 0 | 20 | 20 ✓ |
| label | 25 | 3 | 20 | 3+20 = 23; kalan 2 = `SACK_LABEL_READ` sabitini paylaşan 3 çuval ucu (tek çağrı, üç kullanım) ✓ |

> Grup A'da meşru guard'sız uç (login/health/device handshake) **hiç yok** — o uçlar başka dosyalarda (`auth.routes`, `app.ts /health`, `device` router'ları).

### 7.2 Çakışan mount / route sırası

| Durum | Değerlendirme |
|---|---|
| `/api/admin/db-copies` (app.ts:433) → `/api/admin` (434) → `/api/admin/devices` (438) | **Çakışma yok.** `admin.routes.ts` içinde `/devices` ya da catch-all yok; `db-copies` bilinçli olarak öne alınmış (satır 431-432 yorumu). `/api/admin/devices` genel admin router'ından SONRA mount edilmiş — bugün zararsız, ama admin.routes'a bir `/:something` catch-all eklenirse sessizce gölgelenir. |
| `admin.routes` `GET /system-logs/:id` (`:1010`) | Literal kardeşleri (`/system-logs/stats`, `/users`, `/tables`, `/archive`, `/archive/:id`) **daha önce** tanımlı → sıra doğru. Kırılgan: yeni bir `/system-logs/<literal>` ucu bu satırdan sonra eklenirse `:id`'ye düşer. |
| `inventory.routes` `GET /:id` (`:378`) | Tüm literal GET'ler (`/stats`, `/production-flow`, `/warehouse-scope`, `/subcontractor-summary`, `/barcode`) daha önce → sıra doğru. `POST /initial-entry` (`:466`) ve `POST /open-fabric` (`:802`) tek segmentli; dosyada tek segmentli `POST /:id` YOK → gölgeleme yok. |
| `inventory.routes` `GET /barcode` (`:245`) | Bilinçli inline 400 stub; `GET /barcode/relabel-context` teorik olarak hem `/barcode/:barcode` hem `/:id/relabel-context` ile eşleşebilir — ilki önce tanımlı, kazanır. Pratik etkisi yok. |
| `label.routes` `POST /rolls/bulk-html` + `/bulk-native` (`:266`, `:297`) | İki segmentli literal; dosyada iki segmentli `POST /rolls/:id` YOK → güvenli. **Kırılgan:** ileride `POST /rolls/:id` eklenirse bu iki uç sessizce gölgelenir (bulk çağrıları `:id="bulk-html"` olarak gider). |
| `tambur.routes` `/manual/*` vs `/:id/cut` | Dosya yorumu (`:394-396`) zaten söylüyor: ikinci segmentler farklı literal → çakışma yok. `/manual/*` yine de parametreli blokların önüne konmuş. |
| `workorder.routes` `router.use("/:id/traveler-cards")` (`:15`) | Dosyanın İLK satırı; iki segmentli olduğu için `GET /:id`'yi (`:101`) etkilemez. |

**Aynı path'e iki farklı tanım:** Grup A içinde tespit edilmedi.

### 7.3 Route dosyası içinde iş mantığı (controller'a delege etmeyen inline handler) — **41 adet**

- **`admin.routes.ts` — 40/40 endpoint inline.** Route dosyası: `Zod` şeması tanımı (12 şema), `AppError` fırlatma (`STRUCTURED_SETTING_KEYS` guard, `:1098-1102`), dosya yolu çözümleme + `res.download` (`:1203-1230`), ve **6 doğrudan `AuditService` yazımı** (`:748`, `:791`, `:831`, `:1145`, `:1219`, `:1274`). `CLAUDE.md` bu istisnayı "ince read/ayar endpoint'leri" diye tanımlıyor; buradaki içerik kullanıcı yaşam döngüsü (yaratma/silme/şifre sıfırlama/kart sırrı rotasyonu), yetki atama, oturum purge ve yedek tetikleme — yani istisnanın çerçevesinden geniş.
- **`inventory.routes.ts:245-250`** — `GET /barcode` için sabit 400 döndüren inline handler (yanıltıcı UUID hatasını önlemek için bilinçli, `:239-244` yorumu). İş mantığı değil, yönlendirme mesajı.

Diğer üç dosya (workorder, tambur, label) **tamamen** controller'a delege ediyor.

### 7.4 `clientToken` idempotency taşıyan uçlar (8)

| Uç | Zorunlu mu | Şema satırı |
|---|---|---|
| POST /api/work-orders | opsiyonel | `workorder.controller.ts:20` (`workOrderCoreShape`) |
| POST /api/work-orders/quick-start | opsiyonel | aynı shape, `:80` spread |
| POST /api/rolls/initial-entry | opsiyonel | `inventory.controller.ts:26` |
| POST /api/rolls/open-fabric | opsiyonel | `inventory.controller.ts:47` |
| POST /api/tambur/:id/cut | opsiyonel | `tambur.controller.ts:83` |
| POST /api/tambur/:id/cut-warehouse | opsiyonel | `tambur.controller.ts:113` |
| POST /api/tambur/manual/roll | **zorunlu** | `tambur-manual.controller.ts:62` |
| POST /api/tambur/manual/produce | **zorunlu** | `tambur-manual.controller.ts:121` |

**Token TAŞIMAYAN ama kayıt yaratan uçlar** (denetimde bakılacak asimetri): `POST /api/tambur/finalize` (roll split — N child Roll), `POST /api/tambur/report-error`, `POST /api/work-orders/:id/manifest`, `POST /api/work-orders/:id/split`, `POST /api/admin/users`, `POST /api/admin/permission-templates`.

### 7.5 Dış sisteme çıkan uçlar (6)

| Uç | Dış kaynak | Kapı |
|---|---|---|
| POST /api/labels/rolls/:id/print-native | RAW TCP :9100 (`net.Socket`, `device-transport.ts:41`) | `label.nativeSendEnabled` bayrağı; kapalıyken simüle |
| POST /api/labels/test-native | RAW TCP, **hedef IP gövdeden** | aynı bayrak |
| POST /api/admin/backup | `pg_dump` child process + dosya yazma + offsite kopya | `BACKUP_DIR` env |
| GET /api/admin/backups | `fs.readdir`/`stat` | `BACKUP_DIR` |
| GET /api/admin/backups/:name/download | `res.download` (dosya akışı) | `resolveBackupPath` allowlist |
| GET /api/admin/backups/:name/restore-impact | dosya damgası + DB sayımları | aynı |

---

## 8. Denetimin bakması gereken noktalar (işaret listesi — bulgu değil)

| # | İşaret | Nerede | Neden bakılmalı |
|---|---|---|---|
| R1 | `admin.routes.ts` 40/40 inline; kullanıcı yaşam döngüsü + yedek + oturum purge route katmanında | `admin.routes.ts` bütünü | `CLAUDE.md`'deki "ince read/ayar" istisnasının kapsamıyla dosyanın içeriği örtüşmüyor; Zod şemaları, `AppError` guard'ı ve 6 audit yazımı burada yaşıyor |
| R2 | `POST /api/labels/test-native` gövdeden gelen `printerIp`'ye TCP açıyor; şema `z.string().trim().min(3).max(64)` — IP formatı/allowlist YOK | `label.controller.ts:54` + `label.service.ts:884-900` + `device-transport.ts:41` | `label.nativeSendEnabled` açıkken backend keyfî iç adrese giden bağlantı kurabilir (SSRF sınıfı). İzin `label:print` VEYA `station:write` |
| R3 | `DELETE /api/work-orders/:id/permanent` Swagger'da "veritabanından fiziksel olarak siler… geri alınamaz" diyor; kod **arşivliyor** (`isActive=false`) | `workorder.routes.ts:788-810` ↔ `workorder.service.ts:3798-3828` | API sözleşmesi ↔ davranış uyuşmazlığı. Kardeş uç (`/api/rolls/:id/permanent`) doğrusunu yazmış ("arşivle — soft") |
| R4 | Salt-okunur önizleme uçları **write iznine** bağlı: `GET /:id/cancel-impact`, `GET /:id/complete-preview`, `GET /:id/batches/:batchId/drop-preview`, `GET /api/rolls/:id/cancel-preview` | 4 uç | "Etkiyi görebilmek için değiştirme yetkisi" — yıkıcı-onay akışında önizlemeyi görmesi gereken rol ile uygulayan rol ayrışabilir |
| R5 | Etkin izin **route'tan okunamıyor**: payload'a bağlı `roll:manual-adjust` kontrolü controller içinde | `workorder.controller.ts:697`, `:734`, `:777`; `tambur.controller.ts:268-269` | Yetki denetimi route dosyasını taramakla tamamlanamaz; `test_permission_catalog` AST taraması bu dalları görüyor mu doğrulanmalı |
| R6 | Çalışma oturumu zorunluluğu (`enforceForMobile`) route'ta görünmüyor; 9 uçta var, kardeş uçlarda YOK | var: rolls `initial-entry`/`kursun-finish`, tambur `finalize`/`finalize-open-fabric`/`bypass-complete` + 4 `manual/*`; yok: rolls `open-fabric`, tambur `:id/cut`, `:id/cut-warehouse`, `:id/finalize-warehouse-cut` | Asimetri bilinçli olabilir (`tambur.controller.ts:189-192` gerekçe yazıyor) ama tümü için gerekçe yok; mobil 409 `WORK_SESSION_REQUIRED` davranışı uçtan uca farklı |
| R7 | Path parametreleri route/controller katmanında UUID doğrulamasından geçmiyor (istisna: tambur undo uçları, `z.string().uuid()`) | Grup A'nın hiçbir route dosyası `assertValidUuid` import etmiyor; controller'lar `req.params.id as string` ile geçiyor | Geçersiz/CSV değer Prisma'ya iniyor → P2007 → 400. `CLAUDE.md` çoklu-seçim notu bu sınıfın üç ayrı arıza modunu (400 / sessiz 0 satır / sessizce düşen filtre) tarif ediyor |
| R8 | `POST` ile salt-okunur uçlar: `/api/rolls/stats-batch`, `/api/labels/rolls/bulk-html`, `/bulk-native`, `/api/work-orders/:id/manual-move-preview`, `/api/tambur/manual/bring-preview` | 5 uç | HTTP semantiği ile yan etki uyuşmazlığı; cache/retry/telemetri (latency middleware route etiketleri) ve izin modeli açısından değerlendirilmeli — hepsi read izniyle korunmuyor (`manual/bring-preview` `roll:manual-adjust` istiyor) |
| R9 | `PATCH /api/labels/order-lines/:id` label domain'inden `OrderLine` yazıyor (`label:edit` izniyle) | `label.routes.ts:552` | Domain sınırı: sipariş satırı alanını sipariş izni olmadan değiştirebilen tek uç; "bağlı TÜM topları etkiler" uyarısı Swagger'da var |
| R10 | Route sırası kırılgan noktalar: `label` bulk uçları (`POST /rolls/bulk-*`), `admin` `/system-logs/:id`, `app.ts`'te `/api/admin/devices`'ın `/api/admin`'den SONRA mount edilmesi | §7.2 | Bugün çakışma yok; ileride tek segment/param eklenmesi sessiz gölgeleme üretir (hata yok, log yok) |
| R11 | `GET /api/admin/users/:id/credentials` düz hızlı PIN + kart QR kodunu döner; `GET /api/admin/backups*` üçlüsü aynı sırları dump içinde taşır | admin #15, #38-40 | Yedek uçlarında `admin:settings AND admin:users` çift kapısı var (F287 yorumu), ama `credentials` ucu **tek** `admin:users` ile korunuyor — eşik tutarlılığı sorgulanmalı |
| R12 | Kayıt yaratan 6 uç `clientToken` taşımıyor (`tambur/finalize` dahil — roll split N child üretir) | §7.4 sonu | Offline/retry senaryosunda mükerrer kayıt sınıfı; KK1 için çözülen problemin kardeşleri |

---

## 9. Doğrulanmış, risk OLMAYAN noktalar (denetimde tekrar bakılmasın)

- **Controller bind kapsaması tam.** Route'larda referans verilen tüm handler'lar ya arrow-property ya constructor'da `bind` edilmiş — mekanik olarak tarandı (workorder/inventory/label: 0 eksik; tambur: 19 bind ↔ 16 route kullanımı; tambur-manual: 4/4). Yani `print-event` vakasındaki (`ef49bbc3`) hata sınıfı Grup A'da tekrar etmiyor.
- **`resolveBackupPath` path traversal'a kapalı** (`backup.service.ts:427-436`).
- **`verifyToken` yalnız JWT doğrulamıyor:** kullanıcı `isActive`, `tokenVersion` ve `Session.jti` iptal kaydı da kontrol ediliyor; `jti` taşımayan eski token fail-closed reddediliyor (`auth.middleware.ts:74-102`).
- **Yetki değişimi oturumu düşürüyor:** `grantPermission`/`setUserPermissions`/`revokePermission`/`applyTemplate`/`deleteUser`/`resetUserPassword` `tokenVersion++` yazıyor (`permission-management.service.ts:199, 315, 375, 408, 733, 993`). Bayat JWT izin listesi riski bu uçlar için kapalı.
- **`requirePermission` zincirlemesi AND'dir** (`rbac.middleware.ts:40-57`) — üç yedek ucundaki çift guard bilinçli ve etkin.
