# Dokuma + Devere MANUEL VERİ — uygulanabilir dilimli plan

**Durum: TASLAK 2026-10-21 gece, 1e patron** · Yazan: baş mimar ajanı (W2) · Girdiler: `scratchpad/arastirma/{backend,istemci,veri}.md`, kullanıcı şartları (`memory/dokuma-manuel-veri-yonu.md`), patron kararları D1–D8 (`memory/dokuma-gece-1021.md`).

> Kod YAZILMADI. Bu belge dilimlerin sözleşmesidir; her dilimin kodlama istemi `scratchpad/istemler/S*.md`de, oradaki sözleşme buradakinin kopyasıdır (çelişirse BURASI kazanır).

## 0 · Bağlam (tek paragraf)

Fabrikada tezgahtan otomatik veri YOK; 1 operatör 10–12 tezgah; asıl ölçü LEVENT DENGESİ (levente sarılan çözgü m/kg → çıkan kumaş m; fark = fire). Her ham top KK1'den geçer (metre hep, kg profile göre); leventi operatör takar; topa bugün tezgah no yazılmıyor. Bugünkü yazılım: top yalnız tablet Tezgah ekranındaki İNDİR'den doğan `DoffEvent`e KK1'de "hangi indirmeden?" sorusuyla bağlanır; bu, operatöre her tezgahta yer onayı + İNDİR dokunuşu yükler. Plan bunu tersine çevirir: **top KK1'de doğar, DoffEvent'i sunucu üretir** (etiket okutma ya da iş emri seçimi), mevcut `claimDoffForRollTx` + `autoConsumeForRollTx` zinciri AYNEN çalışır. Adnan Şahin (referans profil): dokuma/devere kapalı, dokuma tabloları boş → hiçbir dilim davranış değiştirmez (bayrak varsayılanı = bugün, kolonlar nullable).

## 1 · Kararlar (D1–D8 patron; D9+ bu plan)

| # | Karar | Gerekçe (1 satır) |
|---|---|---|
| D1 | `dokuma.rollBirth` enum: `TABLET_DOFF` (varsayılan = bugün) · `KK1_LABEL_OR_ORDER` · `KK1_LABEL_ONLY` | Alternatif yöntem = fabrika ayarı (şart 2) |
| D2 | B yolu: KK1 tezgah etiketi okutur → sunucu `DoffEvent` üretir → auto-consume aynen. A yolu: iş emri seçimi; çok tezgahlı işte `Roll.weavingOrderId` (nullable) | Mevcut motor korunur, ikinci giriş motoru yazılmaz (dokuma.md :25) |
| D3 | `LabelKind.MACHINE` + panelden rulo basım | Operatör topa etiket yapıştırır, KK1 okutur |
| D4 | Leventleme tablet ekranı mevcut `wind` API + levent etiketi | Zorunlu veri: levent no + çözgü kartı + metre |
| D5 | İş emri formu v2 (`dokuma.orderFormV2` kapalı) — PLANDA, kod SONRA | Büyük iş, ad kuralı kullanıcı teyidi ister |
| D6 | Üç rapor: levent sonucu · kapasite kullanımı · levent bitiş tahmini | Levent dengesi birinci ölçü |
| D7 | Veri uyumu: dry-run + kayıt listesi; `--apply` SABAH kullanıcı onayıyla; prova DB `tekserp_dokuma_prova_test` | PRODUCTION canlı kuralı |
| D8 | Tüm yeni kolonlar nullable; varsayılanlar bugünkü davranış | Adnan Şahin etkilenmez |
| **D9** | KK1 doğuşunda `counterSource = OPERATOR`, `counterAtDoff = null`, `notes = "KK1 doğuşu (etiket)"`/`"(iş emri)"` | Sayaç okunmadı; `MachineDataSource` beyan zorunlu, `INFERRED` çıkarım demektir, bu bir insan beyanıdır |
| **D10** | Levent değişim penceresi SABİT `KK1_BEAM_CHANGE_WINDOW_HOURS = 12` (`src/constants/dokuma-kk1.ts`); ayar DEĞİL. Beyan edilen levent `warpBeamId` ile `autoConsumeForRollTx`e **override** olarak girer | Sayısal ayar kapalı modülde ölü kapıdır; ÖNERİ: ilk sahada ölçüldükten sonra ayara terfi |
| **D11** | A yolu çok tezgahlı işte tezgah bilinmiyorsa: `DoffEvent` YAZILMAZ (machineId uydurulmaz), `Roll.weavingOrderId` yazılır, auto-consume YAZILMAZ + `warnings`; DB CHECK `rolls_weaving_order_xor_ck` (doff bağı ∧ iş bağı aynı anda yok) | Çift yüklem yasağı; levent dengesi iş emri bazında raporlanır |
| **D12** | Levent etiketi `LabelKind.WARP_BEAM` MACHINE ile AYNI dilimde (S1b), ayrı ADD VALUE dosyası | Tek ayna turu (Electron + mobil union + ENUM_LABELS) |
| **D13** | S2 (iş emri v2) **SONRA**; şema taslağı bu planda, migration damgası `20261022…` | schema.prisma'ya aynı dalgada iki ajan dokunamaz; S1 şemayı kullanıyor |
| **D14** | Çok-tezgah oturumu: KK1 modlarında Tezgah ekranı **İNDİR'siz** "koşum/duruş/levent" ekranıdır (amir/koşum). Operatörün günlük işi KK1 (masa) + Devere (gezici, oturumsuz) — ikisi de tek makineye bağlı DEĞİL. Yer onayı sorunu çözülmez, **gereksizleşir** | Oturum modeli değiştirilmeden operatör 12 tezgahı tek masadan besler |
| **D15** | Dalga: W3 `S1b ∥ S1c ∥ S5a` · W4 `S1 ∥ S4a ∥ S3b` · W5 `S3 ∥ S4b ∥ S5b` · SONRA `S2 · S4c · S5c` | ≤3 ajan; şemaya dalga başına TEK ajan (W3 S1b, W4 S1, W5 yok) |
| **D16** | Tezgahta açık koşum yoksa KK1 **409 `MACHINE_NO_OPEN_RUN`**, top DOĞMAZ (fail-closed); iş panelden "İş ver" | Koşumsuz doff iş emri metresine girmez; sessiz kayıp yerine açık red. ÖNERİ: ileride "KK1'den işsiz koşum aç" ayarı |
| **D17** | KK1 ön-dolgu (kumaş/renk/iş) ÖNERİdir, kilitlemez; uyuşmazlık `warnings` | dokuma.md Z5 |
| **D18** | `rollBirth` KK1_* iken eski tabletin `doffEventId` yolu hâlâ kabul (geçiş); `KK1_LABEL_ONLY` yalnız A yolunu kapatır | Eski APK bugünkü gibi çalışır; `minVersion` YOK |

## 2 · Dilimler

Etiket: **GECE** = bu gece ajanla, **SONRA** = plan hazır, kod sonraki tur.

### S1 · BACKEND "top KK1'de doğar" — GECE (W4, şema sahibi)

**Amaç:** KK1 `initial-entry` gövdesine `machineCode` / `weavingOrderId` / `warpBeamId`; sunucu AYNI tx'te `DoffEvent` üretir; mevcut bağ + otomatik tüketim aynen.

**Dokunulan bölge:** `src/services/system-setting.service.ts` (ayar) · `src/routes/feature-flag.routes.ts` · `src/constants/settings-scopes.ts` · `scripts/lib/hepsi-acik.ts` · `src/controllers/inventory.controller.ts` · `src/services/inventory.service.ts` (yalnız `createInitialEntryFresh` + replay kimliği) · `src/services/machine-doff.service.ts` (`createDoffTx` EKLENİR, `openDoff` dokunulmaz) · YENİ `src/services/helpers/kk1-roll-birth.helper.ts` · `src/services/warp-beam-auto-consume.service.ts` (`beamOverrideId`) · `src/services/helpers/weaving-order-of-roll.helper.ts` (OR) · `src/routes/machine-doff.routes.ts` (`GET /kk1-context`) · `src/routes/weaving-order.routes.ts` (liste iznine `mobile:kk1`) · `prisma/schema.prisma` + 1 migration · `src/constants/dokuma-kk1.ts` (YENİ) · bekçi + `docs/kurallar/dokuma.md` + `BEKCI-HARITASI.md`.

**Şema / migration** `20261021200000_roll_weaving_order_link` (ADDITIVE, idempotent):
- `Roll.weavingOrderId String? @db.Uuid` + `@relation("RollWeavingOrder", onDelete: Restrict)` + `@@index([weavingOrderId])`; `WeavingOrder.rolls Roll[]`.
- CHECK `rolls_weaving_order_xor_ck`: `NOT ("doffEventId" IS NOT NULL AND "weavingOrderId" IS NOT NULL)` → `test_db_invariants` CHECK_CONSTRAINTS satırı aynı commit'te.
- `///` şerhi: "YALNIZ doff'suz A-yolu (çok tezgahlı iş) için; doff varsa iş doff→koşum zincirinden okunur — tek okuyucu `weavingOrderOfRoll`".

**Ayar** (`docs/RECETELER.md` § feature flag 19 adım): `SETTING_KEYS.DOKUMA_ROLL_BIRTH = "dokuma.rollBirth"`; `type DokumaRollBirth = "TABLET_DOFF"|"KK1_LABEL_OR_ORDER"|"KK1_LABEL_ONLY"`, `DOKUMA_ROLL_BIRTH_MODES`, `DEFAULT_DOKUMA_ROLL_BIRTH = "TABLET_DOFF"`; `readDokumaRollBirth(tx?)` (`includes` sigortası); §3.6 resolver `resolveDokumaRollBirth = dokuma açık ? değer : TABLET_DOFF`; `FeatureFlags.dokumaRollBirth`; `getFeatureFlags` (cacheClient) · `setFeatureFlags` dalı (açıklama: "Dokuma: top doğuş yolu — tablet İNDİR · KK1 etiket/iş emri · KK1 yalnız etiket"); zod `z.enum([...]).optional()`; `settings:dokuma` flagKeys += `dokumaRollBirth`; hepsi-açık `A("KK1_LABEL_OR_ORDER")` + `npx tsx scripts/profil-matrisi.ts --acik-yaz`. Electron/mobil aynaları S4b/S3'te (bekçi §D yalnız panel satırı ister → S1 ajanı Electron `settings-config.ts`e satır EKLEMEZ; `PANEL_EXEMPT`e gerekçeli geçici satır: "satır S4b'de iner" — S4b indiğinde muaf düşer).

**API sözleşmesi**
- `POST /api/rolls/initial-entry` (izin aynı) gövde EK alanlar (şema strict değil, LİSTEDE olmalı):
  - `machineCode?: string(≤32)` (tezgah etiketi), `weavingOrderId?: uuid` (A yolu), `warpBeamId?: uuid` (levent beyanı), `productionLineNo?: int ≥1` (çok hatlı tezgah; varsayılan 1).
  - `superRefine`: `semiFinished ∧ (machineCode|weavingOrderId)` → 400; `doffEventId ∧ (machineCode|weavingOrderId)` → 400; `machineCode ∧ weavingOrderId` → 400 (tek yol); `warpBeamId` yalnız `machineCode` ile.
  - Kapılar (controller, servis ÇAĞRILMADAN): alanlardan biri varsa `readDokumaEnabled()` değilse 403 `MODULE_DISABLED` (modul `dokuma`); `readDokumaRollBirth()`: `TABLET_DOFF` iken 400 `ROLL_BIRTH_MODE` `{mode}`; `KK1_LABEL_ONLY` iken `weavingOrderId` 400 `ROLL_BIRTH_MODE`.
  - Servis (`createInitialEntryFresh`, tx içinde, 8021 kilidinden SONRA, `claimDoffForRollTx`'ten ÖNCE): `resolveKk1BirthTx(tx, opts.kk1Birth, {userId})`:
    - `machineCode` → makine (aktif; `station.kind === WEAVING` değilse 400 `MACHINE_NOT_LOOM`; yoksa 404 `MACHINE_NOT_FOUND`); açık koşum `machineRun.findFirst({machineId, productionLineNo, ...OPEN_MACHINE_RUN_WHERE})` yoksa **409 `MACHINE_NO_OPEN_RUN`** `{machineCode}`; `createDoffTx(tx, {machineId, productionLineNo, machineRunId, pieceCount:1, counterAtDoff:null, counterSource:OPERATOR, notes, createdById})` → `{doffEventId, machineId, weavingOrderId: run.weavingOrderId}`.
    - `weavingOrderId` → iş `status ∈ {PLANNED,IN_PROGRESS}` değilse 409 `WEAVING_ORDER_NOT_OPEN`; `SUBCONTRACTED` → 400 `WEAVING_ORDER_SUBCONTRACTED`; açık koşumlar `findMany({weavingOrderId, ...OPEN_MACHINE_RUN_WHERE})`: 0 → 409 `WEAVING_ORDER_NO_OPEN_RUN`; 1 → tezgah çözüldü, `createDoffTx` (B ile aynı); >1 → doff YOK, `{weavingOrderId}` + uyarı "iş N tezgahta koşuyor; tezgah bilinmediği için levent tüketimi yazılmadı".
    - `itemId !== run.itemId/order.itemId` → red DEĞİL, `warnings` (D17).
  - `createDoffTx` (machine-doff.service.ts içinde, `openDoff` dokunulmaz): kod `reserveDoffCode(stamp)` (havuz client, tx dışı sayaç — mevcut sözleşme), damga `readDbNow(tx)`, `tx.doffEvent.create` (`clientToken: null` — KK1 token'ı top'ta), audit YOK (ebeveyn ROLL audit'inde `doffEventId` izi). `withBarcodeRetry` yalnız `code_key` P2002 kemeri.
  - Sonra mevcut yol: `claimDoffForRollTx(tx, {doffEventId: birth.doffEventId ?? opts.doffEventId, …})` → `tx.roll.create({… doffEventId, weavingOrderId: birth.doffEventId ? null : birth.weavingOrderId})` → `autoConsumeForRollTx(tx, {…, beamOverrideId: opts.kk1Birth?.warpBeamId ?? null})`.
  - `beamOverrideId`: verilmişse `beamsMountedDuring` yerine o levent; şart: o tezgahta son `KK1_BEAM_CHANGE_WINDOW_HOURS` içinde MOUNTED ya da DISMOUNTED olayı var, yoksa 400 `WARP_BEAM_NOT_RECENT`.
  - Replay kimliği (`initialEntryReplay`): bağlama `weavingOrderId` (Roll kolonu) + `machineCode` (`find` include `doffEvent.machine.code`) eklenir; farklı → 409 `CLIENT_TOKEN_COLLISION`; aynı → `idempotent:true`, ikinci doff DOĞMAZ.
  - Yanıt: 201 `{success, data: roll, message, warnings?}` + `data.doffEvent: {id, code}` (tablet rozet basar) — `ROLL_LIST_INCLUDE` genişletilmez; yalnız bu yanıtta ek alan.
- `GET /api/machine-doffs/kk1-context?machineCode=X[&productionLineNo=1]` — kapı `verifyToken → requireDokumaEnabled → requireAnyPermission("loom:doff","loom:run","mobile:kk1","mobile:dokuma")`. 200 `{machine:{id,code,name,productionLineCount}, run:{id,productionLineNo,startedAt, weavingOrder:{id,weavingOrderNumber}|null, item:{id,code,name}|null, color|null, warpSpec:{id,code,name,takeUpPct}|null}, beams:{mounted:[{id,beamNo,position,remainingM}], recentChange:{at, dismounted:{id,beamNo}|null, mounted:{id,beamNo}|null}|null}, rollBirth}`; 400 `MACHINE_NOT_LOOM`; 404; 409 `MACHINE_NO_OPEN_RUN` (tablet metre girmeden görür). Levent kalanı TEK okuyucu `readRemainingM`.
- `GET /api/weaving-orders?status=PLANNED,IN_PROGRESS&executionKind=IN_HOUSE` izin listesine `mobile:kk1` eklenir (yeni izin kodu YOK).

**Eski istemci ne yapar:** eski APK yeni alan göndermez → bugünkü yol; KK1_* modda da "Bu top dokuma mı?" ile tablet İNDİR doff'larına bağlanabilir (D18). `minVersion` değişmez.

**Defter beyanı:** `DoffEvent` ileri yazıcı `machine-doff.service.ts`te kalır (`createDoffTx` orada) → `defter-beyan.ts` `yazan` kümesi değişmez, `test_defter_ters_yol §5` yeşil; helper doff YAZMAZ, servisi çağırır. Roll defteri değişmez.

**Kabul testleri** — YENİ `scripts/test_kk1_roll_birth.ts` (DB yazar, `hedefDbEngeli()` ilk adım, ayar fotoğrafına döner): §1 varsayılan modda `machineCode` → 400 `ROLL_BIRTH_MODE` + alansız gövde yanıtı bayt bayt eski · §2 `KK1_LABEL_OR_ORDER`: doff doğar (pieceCount 1 · OPERATOR · `doffedAt` DB saati ±2 sn · `machineRunId` açık koşum · kod `DF…`), `Roll.doffEventId` dolu, `weavingOrderId` NULL, `devere.autoConsume` açıkken CONSUMED.rollId · §3 açık koşum yok → 409 `MACHINE_NO_OPEN_RUN`, roll/doff sayıları değişmez · §4 A yolu: tek koşum → doff doğar; iki tezgah → doff yok, `Roll.weavingOrderId` dolu, CONSUMED yok, `warnings` var, `rollsOfWeavingOrderWhere` ikisini de sayar · §5 `KK1_LABEL_ONLY` + `weavingOrderId` → 400 · §6 `warpBeamId` override: pencere içi söküm → beyan edilen leventten düşer; pencere dışı → 400 `WARP_BEAM_NOT_RECENT` · §7 replay aynı token → idempotent, doff sayısı 1; farklı `machineCode` → 409 · §8 CHECK ihlali (ham SQL iki kolon) → 23514 · §9 dokuma kapalı → 403 `MODULE_DISABLED` · §10 `kk1-context` 200/409. **Negatif sondalar:** `readDbNow` → `new Date()` (§2 damga) · `MACHINE_NO_OPEN_RUN` kapısı silindi (§3) · CHECK migration'dan düştü (§8) · `beamOverrideId` pencere kontrolü silindi (§6).
Koşulacak mevcut bekçiler: `test_feature_flag_contract` · `test_settings_scopes` · `test_profil_tamligi` · `test_defter_ters_yol` · `test_db_invariants` · `test_schema_drift` · `test_timestamptz_contract` · `test_migration_hygiene` · `test_machine_doff_source` · `test_warp_beam_auto_consume` · `test_token_replay_kimlik_tablosu` · `test_token_replay_bogaz` · `test_subcontractor_weaving` · `test_uretim_belge_zinciri` · `test_route_auth_coverage` · `test_swagger_spec` · `test_dokuma_regime_gate` · `test_kk1_entry_sources` · `test_initial_entry_quality`.

**Adnan Şahin:** bayrak satırı yok → `TABLET_DOFF`; kolon nullable; CHECK mevcut satırlarda sağlanır (doff 0). **Büyüklük:** ~12 dosya, 1 migration, 1 yeni bekçi; ~2 saat.

### S1b · BACKEND tezgah + levent etiketi — GECE (W3, şema sahibi)

**Amaç:** `LabelKind.MACHINE` (barkod = `Machine.code`) ve `LabelKind.WARP_BEAM` (barkod = `WarpBeam.beamNo`); payload/html/native uçları; N adet basım.

**Bölge:** `prisma/schema.prisma` (enum) · 2 migration · `src/config/label-fields.ts` · `src/services/helpers/label-context-fit.ts` (`IDENTITY_BIND`) · `src/services/label.service.ts` (SACK dalı emsali: `getMachineLabel*`, `getWarpBeamLabel*`) · `src/controllers/label.controller.ts` · `src/routes/label.routes.ts` · `label-field-values` çözücüsü · Electron `services/labelTemplateService.ts` (`LabelKind` + `labelKindLabels` "Tezgah Etiketi"/"Levent Etiketi"), `lib/audit-labels.ts` `ENUM_LABELS`, `LabelTemplates/editor/NewTemplateDialog.tsx` KINDS · mobil `src/types/models.ts` `LabelKind` union (tek satır) · bekçi + `docs/kurallar/belge-etiket.md` + harita.

**Migration (ayrı, tek ifadeli, `IF NOT EXISTS`):** `20261021180000_label_kind_machine` → `ALTER TYPE "LabelKind" ADD VALUE IF NOT EXISTS 'MACHINE';` · `20261021181000_label_kind_warp_beam` → `… 'WARP_BEAM';` (`test_migration_enum_add_value`).

**Alan kataloğu:** MACHINE: `machineCode` (required, kimlik, "Tezgah Kodu"), `machineName`, `stationName`, `printedAt`. WARP_BEAM: `beamNo` (required, kimlik, "Levent No"), `physicalBeamNo`, `warpSpecCode`, `warpSpecName`, `plannedLengthM`, `woundLengthM`, `woundKg`, `weavingOrderNumber`, `itemName`, `woundAt`, `printedAt`. Kimlik bind: `IDENTITY_BIND.MACHINE = machineCode`, `.WARP_BEAM = beamNo` (uymayan şablon 400, fail-closed).

**API:** `GET /api/labels/machines/:id` · `/html?copies=1..200` · `/native?copies=` · `POST /machines/:id/print-event` — izin `label:read|label:print|station:read` (+print `label:print`); yalnız `station.kind=WEAVING` ve aktif makine (değilse 400 `MACHINE_NOT_LOOM` / 409 `MACHINE_INACTIVE`). `GET /api/labels/warp-beams/:id` · `/html` · `/native` · `print-event` — `label:read|warpbeam:read|mobile:devere` (+print `label:print|mobile:devere`). Şablon atanmamışsa 400 (SACK emsali). `copies` mevcut `test_label_copies` sözleşmesi.

**Eski istemci:** eski panel yeni türlü şablonu listelerse ham ad basar (`labelKindLabels[kind] ?? kind` fail-soft; yoksa ajan ekler); şablon yalnız yeni panelden doğar. `minVersion` YOK.

**Kabul:** YENİ `scripts/test_label_machine_beam.ts`: §1 payload barkod = `Machine.code` / `beamNo` · §2 şablonsuz 400 · §3 `copies=3` → 3 etiket; 201 → 400 · §4 `machineCode` bağlamayan MACHINE şablonu `analyzeContextFit` uymaz · §5 tezgah olmayan makine 400 · §6 pasif makine 409. Negatif: `IDENTITY_BIND` MACHINE satırı silindi (§4) · copies tavanı kalktı (§3). Mevcut: `test_migration_enum_add_value` · `test_audit_labels` · `test_label_context_fit` · `test_label_context_default` · `test_label_copies` · `test_mobil_enum_aynasi` · `test_route_auth_coverage` · `test_swagger_spec` · `test_schema_drift`.
**Adnan Şahin:** enum değeri eklenir, şablon yok, uç çağrılmaz. **Büyüklük:** ~10 dosya; ~1,5 saat.

### S1c · BACKEND raporlar — GECE (W3, şemasız)

**Amaç:** üç rapor; `REPORT_CATALOG` + Electron ayna; `meta.ufuk`; fabrika günü tek kaynaktan.

**Bölge:** YENİ `src/services/reports/levent-sonucu.report.service.ts`, `kapasite-kullanimi.report.service.ts`, `levent-bitis-tahmini.report.service.ts` · `src/routes/reports/dokuma.report.routes.ts` (3 uç; levent uçlarına ek `requireDevereEnabled`) · `src/constants/report-catalog.ts` + `Electron/src/lib/report-catalog.ts` (birebir ayna; karo/sayfa S4a) · bekçi + `docs/kurallar/raporlar.md`/`dokuma.md` + harita.

**Sözleşme** (hepsi `report:production`, `verifyToken → requireDokumaEnabled → requireReportOpen(key) → guard`; tarih `YYYY-MM-DD` fabrika günü; süzme sunucuda; liste ≤500 kırpılır sayı kırpılmaz; her yanıt `meta.ufuk = LOOM_HORIZON_DAY` + `meta.ufukOncesiSatir`):
- `GET /api/reports/dokuma/levent-sonucu?from&to[&warpSpecId][&machineId]` → `{kapananlar:[{beamId, beamNo, physicalBeamNo, warpSpec:{code,name,takeUpPct}, sarilanM, sarilanKg, kgKaynak, beklenenKumasM|null, gercekKumasM, gercekKaynak:{otomatik, elle}, kalanM, fireM|null, firePct|null, status, kapanisAt, tezgahlar:[code]}], acikLeventler:[…aynı + kullanimPct, fire yok], ozet:{leventSayisi, sarilanM, beklenenM, gercekM, fireM, firePct, olculemedi}}`. Kurallar: beklenen = sarılan × (1 − takeUp/100), takeUp NULL → null + `olculemedi++`; gerçek = Σ `CONSUMED.fabricLengthM` (`reversal IS NULL`), rollId dolu "otomatik" / boş "elle" kırılımı (tek yüzdeye çökertme YOK); kalan `warpBeamRemainingM` (tek okuyucu); fire yalnız `EXHAUSTED|SCRAPPED` leventte; pencere = kapanış olayının fabrika günü, açık leventler kesit. Katalog: `{key:"dokuma/levent-sonucu", baslik:"Levent Sonucu", soru:"Her leventten beklenen kumaş çıktı mı, fire ne kadar?", sinif:"basit", izin:"report:production", modul:"dokumaEnabled", varsayilanGun:30, tarih:"aralik-gun", panelYolu:"reports/dokuma/levent-sonucu", uc:"/api/reports/dokuma/levent-sonucu", kapiTasiyici:[{dosya:"src/routes/reports/dokuma.report.routes.ts", yol:"/levent-sonucu"}], yuzey:"yaprak"}`.
- `GET /api/reports/dokuma/kapasite-kullanimi?from&to[&machineId]` → tezgah × fabrika haftası: `{satirlar:[{machineId, code, hafta:"YYYY-Www", haftaBaslangic, nominalUnitsPerMin|null, unitsPerCm|null (haftadaki koşumların ağırlıklı ortalaması), teorikMSaat|null, takvimSaat, potansiyelM|null, gercekM (Σ `Roll.initialQty`, doff zinciri, `revokedAt null`, statü ∉ `K18_DEAD_STATUSES`, `doffedAt` haftada), kullanimPct|null, hesaplanamadi:"nominal yok"|"atkı/cm yok"|null}], ozet}`; teorik m/saat = nominal ÷ unitsPerCm × 0,6. Katalog `dokuma/kapasite-kullanimi` "Kapasite Kullanımı" soru "Tezgahlar haftada teorik kapasitelerinin ne kadarını kumaşa çevirdi?" sinif "gelismis" varsayilanGun 28 tarih "aralik-gun".
- `GET /api/reports/dokuma/levent-bitis-tahmini[?machineId]` (kesit) → `{satirlar:[{beamId, beamNo, machine:{code,name}, position, kalanM, gunlukOrtM|null (son 7 fabrika günü CONSUMED Σ ÷ 7, `reversal null`), kaynak:{otomatik, elle}, tahminiBitisGun|null (YYYY-MM-DD fabrika günü), kalanGun|null, hesaplanamadi}]}`. Katalog `dokuma/levent-bitis-tahmini` "Levent Bitiş Tahmini" soru "Tezgahtaki leventler günlük hızla ne zaman biter?" sinif "basit" varsayilanGun null tarih "yok".
Zaman: yalnız `constants/time.ts` (`factoryDaySql`, `resolveRangeStart`, `factoryDayKeyFromYmd`, hafta anahtarı için `factoryYmd`); çıplak `DATE_TRUNC`/`AT TIME ZONE` yasak.

**Kabul:** YENİ `scripts/test_rapor_levent_sonucu.ts` (DB yazar; fixture: çözgü kartı takeUp %5 · levent 1000 m · tak · KK1 190 m doff bağlı + autoConsume → CONSUMED 200/190 · exhaust): §1 beklenen 950 · gerçek 190 · fire 760 · %80 · §2 takeUp NULL → beklenen null, `olculemedi` 1 · §3 açık levent fire null, `kullanimPct` dolu · §4 kapasite: nominal 600, atkı/cm 20 → 18 m/sa; nominal yok → null + gerekçe · §5 bitiş: kalan 800 / ort → gün; tüketim yok → null · §6 `meta.ufuk` var · §7 üç yanıt `suzgec`/`meta` zarfı. Negatif: takeUp çarpanı kaldırıldı (§1) · kalan elle toplandı → `test_levent_kalan_tek_okuyucu` AST kırmızı · `meta.ufuk` düştü (§6). Mevcut: `test_rapor_katalogu` · `test_rapor_kapisi` · `test_report_day_boundary` · `test_levent_kalan_tek_okuyucu` · `test_dokuma_regime_gate §6g` · `test_rapor_satir_tavani` · `test_rapor_strict` · `test_route_auth_coverage` · `test_swagger_spec`.
**Adnan Şahin:** dokuma kapalı → uç 403, ~~karo gizli~~ (GEÇERSİZ → 2026-10-26, UX-2 K3: karo soluk + "kapalı — <ayar yolu>"). **Büyüklük:** ~7 dosya; ~2 saat.

### S2 · BACKEND iş emri formu v2 — SONRA (plan + şema taslağı)

> **MAL-1 notu (2026-10-25):** `WeftSpec` + `Item` yapı alanları MAL-1 şemasıyla İNDİ (`20261025140000_maliyet_girdileri`); S2 bu şemanın üstüne kurulur (kalan: `WeaveDesign`, `WarpSpec.drawingIn/frameCount`, `WeavingOrder.weftSpecId/weaveDesignId`, suggest-item, form v2). Farklar: (1) atkı TEK iplik değil — `WeftSpec.yarnItemId` yerine çoklu `WeftSpecYarn` (sıra + atkı/cm; set replace ③b); (2) `finishedWidthCm` AÇILMADI → kart eni `Item.widthCm` (K4P) ile birleşti (tek kaynak, patron kararı 2026-10-25); (3) `/api/weft-specs` BaseController değil, açık alanlı servis (`weft-spec.service.ts`), izinler `warpspec:read/write`, kapı `requireDokumaEnabled`.

Bayrak `dokuma.orderFormV2` (boolean, varsayılan false; `settings:dokuma`; hepsi-açık true). Şema (`20261022010000_weft_spec_weave_design`, ADDITIVE):
- ~~`WeftSpec` (katalog): `id, code @unique VarChar(32), name VarChar(100), yarnItemId? Uuid (YARN kalemi, nullable — fabrika verisinde iplik kartı yok), picksPerCm Decimal(6,2)?, sequenceNote VarChar(300)? (sıra/renk notu), isActive, nameFold, künye, @@map("weft_specs")`.~~ → MAL-1 indi (çoklu `WeftSpecYarn`).
- `WeaveDesign` (katalog): `id, code @unique, name, kind WeaveDesignKind (DOBBY|JACQUARD — yeni pg enum, CREATE TYPE aynı dosyada serbest), frameCount SmallInt?, repeatEnds Int?, repeatPicks Int?, repeatCm Decimal(8,2)?, notes, isActive, nameFold, künye, @@map("weave_designs")`.
- `WarpSpec.drawingIn VarChar(100)?` (tahar), `WarpSpec.frameCount SmallInt?`.
- `Item`: ~~`rawWidthCm, finishedWidthCm Decimal(6,2)?`, `rawGsm, finishedGsm Decimal(7,2)?`, `composition VarChar(200)?`, `weftSpecId?`~~ (MAL-1 indi; `finishedWidthCm` → `widthCm` K4P), `weaveDesignId?` (Restrict, index).
- `WeavingOrder.weftSpecId?`, `weaveDesignId?`.
API: `/api/weft-specs`, `/api/weave-designs` (BaseController CRUD, izinler `warp-spec.routes.ts`tekiyle AYNI kodlar; yeni kod yok; `requireDokumaEnabled`); `GET /api/weave-designs?warpSpecId=` → JACQUARD ∪ (DOBBY ∧ (`frameCount` null ∨ ≤ `WarpSpec.frameCount`)); uyumsuz seçim UYARIR (`warnings`), reddetmez. `POST /api/weaving-orders/suggest-item {warpSpecId, weftSpecId, weaveDesignId?, rawWidthCm?}` → `{item|null, adaylar:[{id,name,skor}], onerilenAd, onerilenKod}`; ad kuralı: `<desen.code ?? desen.name> <çözgü.code>×<atkı.code>[ <en>]` → ör. `KRISTAL CZ-SIYAH×AT-ALTIN 150`; eşleşme önce üçlü FK tam eşleşmesi, sonra `nameFold` trgm (≥0,6). İş emri formu `weftSpecId/weaveDesignId` kabul eder (v2 kapalıyken alanlar yok sayılmaz, isteğe bağlı kalır — "varsayılan = bugün": zorunluluk yok). Bekçi `test_weave_design_suggest.ts` + `test_feature_flag_contract` + `test_audit_labels §4` (yeni enum) + `test_master_data_merge_fk_coverage`. Adnan Şahin: boş tablolar. ~3 saat backend + S4c panel.

### S3 · TABLET — GECE (W5; S3b W4)

**S3a KK1 Ham Giriş "tezgah etiketi okut"** (`mobil/src/screens/Modules/KK1/`, `services/featureFlag.service.ts` ayna `dokumaRollBirth` varsayılan `'TABLET_DOFF'`, `offline/mutations.ts` KK1 mutationFn gövdesi, `services/doff.service.ts` `kk1Context`):
- Saf modül `loomBirth.ts` + test: `isLoomBirthVisible(dokumaEnabled, rollBirth, semiMode)`, `loomBirthPayload(state)` → `{machineCode, warpBeamId?}` | `{weavingOrderId}` | `{}`, `classifyLoomBirthFailure(code)` → `'no-open-run'|'mode-changed'|'not-loom'|'beam-not-recent'|'plain'`, `beamQuestion(ctx)` (recentChange varsa iki çip; varsayılan yeni).
- Görünüm `LoomBirthBar.tsx` (sağ sütun, `ScannerEntryBar` tone indigo "Tezgah etiketini okut"; okutunca `signalScan` accept/reject; bağlam şeridi `TruncatedText`; A yolu "Çalışan iş seç" `PickerModal`); KK1_* modda `DoffLinkPicker` çizilmez (eski soru yalnız `TABLET_DOFF`).
```
┌ Ham Giriş · KK1 Masa ──────────────── [sync] ┐
│ SOL                        │ SAĞ                │
│ Kumaş: KRİSTAL ALTIN (öneri)│ [📷 Tezgah etiketini okut]│
│ Renk: —                    │ T-07 · DK261021-0003 ·   │
│ Metre: [ 190,0 ]  (numpad) │ LV261020-0007 kalan 412 m │
│ Kg:    [  —   ] (profil)   │ (Levent değişti) [Eski LV-07][Yeni LV-09]│
│                            │ Son kayıtlar …          │
│ ████ KAYDET (112dp) ████   │ [ 7 8 9 / 4 5 6 / … ]   │
└────────────────────────────┴─────────────────────────┘
```
Dokunuş: okut 1 + metre rakamları + KAYDET 1 (+ levent çipi 1, + kg). A yolu: iş seç 2. Hata: 409 `MACHINE_NO_OPEN_RUN` → modal "T-07'de açık iş yok — panelden İş ver" (token yenilenir); 400 `ROLL_BIRTH_MODE` → "Ayar değişti" + bayrak yenile; 400 `WARP_BEAM_NOT_RECENT` → çip kaldır. Çevrimdışı: `KK1_CREATE_ENTRY` kuyruğu AYNEN — `machineCode` + metre kuyruğa girer, bağlam sunucuda replay'de çözülür (bağlam ucu çevrimdışıysa şerit "bağlanınca doğrulanır"); kalıcı düşüş `announceFailure` ("Top kaydedilmedi: tezgahta açık iş yok. Listede yoksa tekrar girin.") — `mutations.ts` mutationFn yeni alanları GEÇİRİR (kat vakası dersi) ve `mutations.test.ts` ölçer.
**S3c Levent tak barkodla** (`Devere/MountModal.tsx`, `useMountForm.ts`, `Dokuma/BeamPanel.tsx`): levent `beamNo` okut (`ScannerEntryBar`, `beamScan.ts` saf çözücü + test) → tezgah etiketi okut ya da oturum makinesi → yuva (tek yuvalıysa 1) → TAK (`StationActionButton`, `size="xl"` 112dp prop EKLENİR). Dokunuş 3.
**S3d Tezgah ekranı** (`Dokuma/DokumaScreen.tsx`, `useDoffEntry.ts`): `rollBirth !== 'TABLET_DOFF'` → `DoffEntryView` + alt İNDİR çubuğu çizilmez; yerine bilgi şeridi "Toplar KK1'de etiketle doğar"; `DoffTodayList` KK1 doğumlu doff'ları da gösterir (sunucu listesi). Koşum/duruş/levent panelleri kalır.
**S3b Devere "Levent sar" istasyon dili** (W4; `Devere/` dizini): sol form (çözgü kartı `PickerModal`, metre numpad `autoActivate`, kg: hesaplanan `tel×m×denye÷9e6` ya da tartı numpad, gövde no okut/yaz; iplik satırları yalnız iplik açıksa `PagedSheet` sayfası) + **SAR** 112dp; sağ sütun okutma bandı + bugün sarılanlar + `NumpadHost`; sarım sonrası levent etiketi `printQueue` ile otomatik (BT yazıcı, `/api/labels/warp-beams/:id/native`). Sarım online-only (levent no sunucuda; gerekçe satırı mutasyonun üstünde). Dokunuş ≈ 5–7.
**Testler:** `loomBirth.test.ts`, `beamScan.test.ts`, `mutations.test.ts` (alan geçişi), `useDoffEntry.test.tsx` (mod gizleme), `doffLink.test.ts` (KK1_* modda gizli), `useBeamForms.test.tsx`; `npm run typecheck` + `lint` + `npx jest --runInBand`. **Sürüm:** sonraki tablet sürümü ZORUNLU AAB/Play turu (surum-yayin.md § Açık sorular, `expo-notifications`); `surum-notlari.json` tablet maddesi; yayın ajanının işi. **Adnan Şahin:** `dokumaEnabled=false` → kart yok; `rollBirth` ayna varsayılanı bugünkü KK1. **Büyüklük:** S3a+c+d ~12 dosya ~2,5 saat; S3b ~8 dosya ~2 saat.

### S4 · PANEL — GECE (S4a W4, S4b W5), SONRA (S4c)

**S4a** (bağımlı S1b + S1c): `pages/Stations/MachineRowActions.tsx` + `MachineActionHandlers.onPrintLabel` → `MachineLabelPrintDialog.tsx` (adet 1–200; `GET /api/labels/machines/:id/html?copies=N` → iframe `sandbox="allow-same-origin allow-modals"` → `print-event`; şablon yoksa backend 400 toast; yalnız WEAVING tezgah); Leventler sayfası satır eylemi "Etiket bas". Raporlar → Dokuma: `tile-config.ts` 3 karo · `content-routes.tsx` 3 route (`reports/dokuma/levent-sonucu` …) · `LeventSonucuPage.tsx`, `KapasiteKullanimiPage.tsx`, `LeventBitisTahminiPage.tsx` (`RandimanPage` kalıbı: `ReportPageLayout` soru katalogtan, `MetricCard` şerit TABLODAN ÖNCE, `ReportDateFilter`, `dokumaExport.ts`). Testler: `reportSummaryCoverage.test.ts` (29→32), `reportHubSections.test.ts`, `ham-tarih-girdisi.test.ts`, `route-modules.test.ts`, `MachineLabelPrintDialog.test.tsx`.
**S4b** (bağımlı S1): Genel Ayarlar → Dokuma `enumFlags` `dokumaRollBirth` (radio: "Tablet İNDİR (varsayılan)" · "KK1'de etiket ya da iş emri" · "KK1'de yalnız etiket"; `defaultValue:"TABLET_DOFF"`; `gate: RollBirthGate` → KK1_* seçiliyken `devereMountTracking`/`devereAutoConsume` kapalıysa amber bant "Levent dengesi için Devere → tezgah bağı defteri ve otomatik tüketim açılmalı" — `TezgahAlarmShiftGate` emsali); `featureFlagService.ts` tipi; `flag-modules.ts` `dokumaRollBirth:"dokumaEnabled"`; S1'in `PANEL_EXEMPT` geçici satırı DÜŞER. Testler: `flag-modules.test.ts`, `settings-scope-mirror.test.ts`, `FeatureFlagSection.module.test.tsx`, backend `test_feature_flag_contract`.
**S4c** (SONRA, bağımlı S2): iş emri formu v2 sihirbazı (çözgü → atkı → desen → önerilen ham kalite; `WeavingOrderFormDialog` `dokumaOrderFormV2` açıkken) + Çözgü/Atkı/Desen kartı sayfaları (`createCrudService`).

### S5 · VERİ UYUMU — S5a GECE (W3), S5b GECE (W5), S5c SONRA

`Teks-Erp/scripts/dokuma-urun-adi-ayikla.ts` (`test_` öneki YOK; şablon `fix_kumas_kod_cakismasi.ts`): kuru koşum varsayılan; `--csv=<yol>` öneri tablosu (konsol her zaman); `--apply --kabul=<csv>` yalnız KARAR=KABUL satır kimlikleri; ürün ADI DEĞİŞMEZ; yazım `ItemService` üzerinden (audit). Kapılar: `hedefDbEngeli()` + `assertGelistirmeVeritabani` (`scripts/db-guard.ts`) + ad `_test` ile bitmiyorsa `--apply` reddi. Kurallar `veri.md §2` düzenli ifade tablosu (sıra yukarıdan aşağı; kök normalizasyonu) → sütunlar `itemId, code, name, isActive, topSayisi, sinif, kok, cozguRengi, atkiSim, varyant, en, oneriCozguKarti, oneriAtkiKarti, KARAR`. **S2 bağımlılığı:** atkı/sim → `WeftSpec` (S2), çözgü rengi → `WarpSpec` — ama `WarpSpec.yarnItemId` NOT NULL ve fabrikada YARN kalemi YOK → çözgü kartı üretimi iplik kalemi KARARI ister (SABAH, kullanıcı); bu yüzden S5c (apply) S2 + kullanıcı kararı sonrası. S5a: betik + DB'siz bekçi `scripts/test_dokuma_urun_adi_ayikla.ts` (vektörler: `1015-GÜMÜŞ SİMLİ (SİYAH ÇÖZGÜ)`→kök 1015/çözgü SİYAH/atkı GÜMÜŞ SİMLİ · `ACTİVO SİYAH-(BEYAZ GÜMÜŞ)` · `GENİŞ ALP SADE`→en GENİŞ · `TERAS V-06`→varyant · `BGR150`→`BGR 150` · `HERA -GÜMÜŞ` · `20011`→yalnız-kod · `BEYAZ GÜMÜŞ`→RENK-ADI; `--apply` `--kabul`süz → exit 1; `test_script_guards` yıkıcı betik kapısı). S5b: prova DB'de kuru koşum (`DATABASE_URL` yalnız komut satırında, `.env` ASLA), CSV + özet rapor → 1e sabah kullanıcıya. Adnan Şahin: canlıya dokunulmaz.

## 3 · Dalga planı (gece ≈ 6 saat, ≤3 ajan, bölge çakışması yok)

| Dalga | Saat | Ajanlar | Şema sahibi | Not |
|---|---|---|---|---|
| W3 | 0:00–1:45 | **S1b** ∥ **S1c** ∥ **S5a** | S1b (LabelKind ×2) | S1c `report-catalog` + Electron ayna; S5a yalnız `scripts/` |
| W4 | 1:45–4:00 | **S1** ∥ **S4a** ∥ **S3b** | S1 (`Roll.weavingOrderId`) | S4a S1b+S1c'ye bağlı (main'de olmalı); S3b yalnız `mobil/.../Devere/` + `models.ts` dokunmaz |
| W5 | 4:00–6:00 | **S3** (a+c+d) ∥ **S4b** ∥ **S5b** | — | S3/S4b S1'e bağlı; S5b prova raporu |
| SONRA | — | S2 → S4c → S5c | S2 | Kullanıcı: ad kuralı, iplik kalemi kararı, `--apply` onayı |

Çakışma bölgeleri: `schema.prisma` (dalga başına tek), `surum-notlari.json` (her dilim kendi maddesini EN ÜSTE ekler; çatışma entegratörde), `docs/kurallar/dokuma.md` `Backend:` satırı (S1/S1c; ikinci iniş rebase), `BEKCI-HARITASI.md` (aynı), Electron `report-catalog.ts` (yalnız S1c), `featureFlag.service.ts` mobil (yalnız S3), `settings-config.ts` (yalnız S4b).

## 4 · Açık borçlar

1. `test_token_replay_kimlik_tablosu`: `machineCode` kimliği doff→machine zinciriyle — tabloya satır (S1).
2. H5 (dokuma.md): top metre düzeltmesi levent tüketimini yeniden hesaplamıyor — bu planda da açık; fire raporu "düzeltilmiş top" sayısını `meta`da beyan etmeli (S1c borç notu).
3. Levent değişim penceresi sabit 12 sa (D10) — sahada ölçülünce ayara terfi kararı.
4. KK1_* modda "işsiz koşum aç" kısayolu yok (D16) — iş vermeyi unutan amir KK1'i durdurur; ÖNERİ ayarı.
5. Çok hatlı tezgahta KK1 `productionLineNo` seçimi: etiket hat taşımaz, tablet sorar (çok hatlı makine fabrikada yok; tek çip) — ölçülmedi.
6. WARP_BEAM etiketi yazıcı dili: BT raster (`mobileRasterEnabled`) ile levent etiketi genişliği — `test_label_width_gate` tavanına takılabilir, S3b ölçer.
7. S5c: `WarpSpec.yarnItemId` zorunlu → iplik kalemi tohumu kullanıcı kararı; alternatif nullable'a çevirme = S2 kapsamında ÖNERİ (çözgü kartı ipliksiz doğabilir mi?).
8. Eski panelde yeni `LabelKind` türlü şablon listesi ham ad — fail-soft ölçülmedi (S1b ajanı ölçer, yoksa ekler).
