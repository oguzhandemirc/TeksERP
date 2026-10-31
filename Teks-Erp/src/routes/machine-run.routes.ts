// =============================================================================
// TeksERP — Tezgah Koşumu (MachineRun) Routes · aç / kapa / geri al
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` (koşum dokumanın
// koşumudur; kapı ön koşulu üretimi ÖNCE ölçer — ekran dilimiyle doğdu
// 2026-09-13, kardeş yollar aynı kapsama: bekçi `test_dokuma_regime_gate`) →
// `requirePermission` (kişi bunu yapabilir mi).
//
// Geri alma AYRI izindir (`loom:run-revoke`): randımanın paydasını değiştirir,
// günlük aç/kapa işinden ayrı bir yetkidir (`shipping:undo-dispatch` emsali).
// Tablet koşum dilimi (2026-09-14): aç/kapa `requireAnyPermission("loom:run", ...MOBILE_DOKUMA)`,
// geri alma `requireAnyPermission("loom:run-revoke", ...MOBILE_DOKUMA_GERI_AL)` — geri alma
// yeteneği doff ile ORTAK (`mobile:dokuma-geri-al`: indirme ve koşum, ikisi de defterden
// satır düşürür). Bekçi `test_mobile_screen_permissions`.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { closeMachineRun, openMachineRun, revokeMachineRun } from "../services/machine-run.service";
import { listOpenMachineRuns } from "../services/loom-list.service";
import { machineRunTabletContext } from "../services/helpers/machine-run-suggest.helper";
import { weavingOrderTabletConstruction } from "../services/helpers/tablet-construction.helper";
import { BULK_RUN_MAX, assignBulkRuns, bulkRunContext, finishBulkRuns, previewBulkRuns } from "../services/machine-run-bulk.service";

const router = Router();

router.use(verifyToken, requireDokumaEnabled);

// OKUMA ucu: tezgah ekranı (tablet `mobile:dokuma`) + yazma izni olanlar; ayrı `loom:read` YOK.
const MOBILE_DOKUMA = ["mobile:dokuma"] as const;
/** Geri alma ayrı yetenek izni — doff ile ortak kod (`machine-doff.routes` emsali). */
const MOBILE_DOKUMA_GERI_AL = ["mobile:dokuma-geri-al"] as const;

const openListSchema = z
  .object({
    machineId: z.string().uuid("Geçersiz makine"),
    /** Yalnız `open=true` desteklenir — kapalı/geri alınmış koşum listesi rapor dilimidir (d9). */
    open: z.literal("true", { message: "Yalnız open=true desteklenir" }),
  })
  .strict();

/**
 * @openapi
 * /api/machine-runs:
 *   get:
 *     tags: [MachineRuns]
 *     summary: Makinenin AÇIK koşumları (hat sırasıyla)
 *     description: >
 *       `endedAt IS NULL ∧ revokedAt IS NULL`; hat başına en çok bir (sed). Yalnız `open=true` —
 *       geçmiş koşumlar rapor dilimidir. `meta.total` kırpılmaz.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: machineId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: open
 *         required: true
 *         schema: { type: string, enum: ["true"] }
 *     responses:
 *       200: { description: Açık koşum listesi + meta }
 *       400: { description: Parametre hatası }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *       404: { description: Makine yok }
 */
/**
 * @openapi
 * /api/machine-runs/tablet-context:
 *   get:
 *     tags: [MachineRuns]
 *     summary: Koşum açma bağlamı (Z1) — takılı leventin işi ÖN-DOLGU olarak + açık içeride işler
 *     description: >
 *       Sunucu koşumu OTOMATİK BAĞLAMAZ; tablet `suggestedWeavingOrderId`yi forma ön-doldurur, operatör onaylar
 *       (+0 dokunuş). `weavingOrders` = PLANNED/IN_PROGRESS ∧ IN_HOUSE (kapıyla aynı küme).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: machineId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ suggestedWeavingOrderId, suggestedFrom, mountedBeam, weavingOrders }" }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *       404: { description: Makine yok }
 */
router.get("/tablet-context", requireAnyPermission("loom:run", ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    const q = z.object({ machineId: z.string().uuid() }).strict().parse(req.query);
    res.json({ success: true, data: await machineRunTabletContext(q.machineId) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-runs/construction:
 *   get:
 *     tags: [MachineRuns]
 *     summary: Tablet iş kartı — dokuma işinin etkin yapısı (atkı sırası, armür dosyası, sıklık), SALT-OKUNUR (SY-M4)
 *     description: >
 *       `resolveEffectiveConstruction(itemId, recipeId)`in dar tablet biçimi; armür ızgarası gönderilmez.
 *       Yapısız iş → `data: null` (tablet hiçbir şey çizmez).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: weavingOrderId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Etkin yapı ya da null" }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *       404: { description: Dokuma işi yok }
 */
router.get("/construction", requireAnyPermission("loom:run", "loom:doff", ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    const q = z.object({ weavingOrderId: z.string().uuid("Geçersiz dokuma işi") }).strict().parse(req.query);
    res.json({ success: true, data: await weavingOrderTabletConstruction(q.weavingOrderId) });
  } catch (e) {
    next(e);
  }
});

router.get("/", requireAnyPermission("loom:run", "loom:doff", ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    const q = openListSchema.parse(req.query);
    res.json(await listOpenMachineRuns(q.machineId));
  } catch (e) {
    next(e);
  }
});

// ── Tezgah Salonu toplu koşum (panel) — satır başına tek yol; önizleme yazmaz ──────────────
const lineNo = z.number().int("Üretim hattı numarası tam sayı olmalıdır").min(1, "Hat numarası 1'den küçük olamaz");
const targetSchema = z.object({ machineId: z.string().uuid("Geçersiz tezgah"), productionLineNo: lineNo.default(1) }).strict();
/** İş ver hedefi: satır başına iş (C.6) opsiyonel — tanımsız = istek düzeyindeki iş, null = işsiz (numune). */
const jobTargetSchema = targetSchema.extend({ weavingOrderId: z.string().uuid("Geçersiz dokuma iş emri").nullish() });
const tooMany = `Tek seferde en çok ${BULK_RUN_MAX} tezgah seçilebilir.`;

const bulkPreviewSchema = z
  .object({
    action: z.enum(["ASSIGN", "FINISH"], { message: "Geçersiz işlem" }),
    weavingOrderId: z.string().uuid("Geçersiz dokuma iş emri").nullish(),
    targets: z.array(jobTargetSchema).min(1, "En az bir tezgah seçin.").max(BULK_RUN_MAX, tooMany),
  })
  .strict();

const bulkAssignSchema = z
  .object({
    weavingOrderId: z.string().uuid("Geçersiz dokuma iş emri").nullish(),
    targetUnitsPerMin: z.number().int().positive("Hedef devir pozitif olmalı").max(10_000).nullish(),
    rows: z
      .array(
        jobTargetSchema.extend({
          clientToken: z.string().uuid("Geçersiz istemci anahtarı"),
          replaceRunId: z.string().uuid("Geçersiz koşum").nullish(),
        }),
      )
      .min(1, "En az bir tezgah seçin.")
      .max(BULK_RUN_MAX, tooMany),
  })
  .strict();

const bulkFinishSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            runId: z.string().uuid("Geçersiz koşum"),
            picksAtClose: z.number().int().nonnegative("Atkı sayısı negatif olamaz").nullish(),
          })
          .strict(),
      )
      .min(1, "En az bir tezgah seçin.")
      .max(BULK_RUN_MAX, tooMany),
  })
  .strict();

/**
 * @openapi
 * /api/machine-runs/bulk/context:
 *   get:
 *     tags: [MachineRuns]
 *     summary: Salon iş seçicisi — açık içeride Dokuma İş Emirleri + "iş zorunlu" ayarı
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ weavingOrders, weavingOrderRequired }" }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/bulk/context", requireAnyPermission("loom:run"), async (_req, res, next) => {
  try {
    res.json(await bulkRunContext());
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-runs/bulk/preview:
 *   post:
 *     tags: [MachineRuns]
 *     summary: Toplu iş ver / bitir ÖNİZLEMESİ — her tezgah adıyla, YAZMAZ
 *     description: >
 *       Satır sonucu START · REPLACE (dolu hat, varsayılan seçili değil) · SAME_JOB · FINISH · BLOCKED (sebepli).
 *       Satırlar tezgah kodu + hat sırasında. İstek düzeyindeki iş engeli (fason/kapalı iş, iş zorunlu ayarı) 400;
 *       hedefte satır başına `weavingOrderId` (C.6, null = işsiz) verilirse o işin engeli yalnız o satırı BLOCKED yapar.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ action, weavingOrder, rows[] }" }
 *       400: { description: Doğrulama / iş bağlanamaz / iş zorunlu }
 */
router.post("/bulk/preview", requireAnyPermission("loom:run"), async (req, res, next) => {
  try {
    res.json(await previewBulkRuns(bulkPreviewSchema.parse(req.body ?? {})));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-runs/bulk/assign:
 *   post:
 *     tags: [MachineRuns]
 *     summary: Seçili tezgahlara iş ver (başlat; `replaceRunId` ile Değiştir) — sonuç PARÇALI olabilir
 *     description: >
 *       Her satır kendi transaction'ında, tezgah kodu sırasıyla; satır başına `clientToken` (aynı token'la
 *       yeniden gönderim özgün koşumu döndürür). Dolu hatta `replaceRunId` yoksa satır 409 PRODUCTION_LINE_OCCUPIED
 *       ile `failed`e düşer. Olmayan her satır kod + Türkçe sebeple döner. Satırda `weavingOrderId` (C.6) verilirse
 *       o satır o işle açılır (null = işsiz), verilmezse istek düzeyindeki iş.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ requested, ok[], failed[] }" }
 *       400: { description: Doğrulama (boş liste, 100 üstü, geçersiz UUID) }
 */
router.post("/bulk/assign", requireAnyPermission("loom:run"), async (req, res, next) => {
  try {
    res.json(await assignBulkRuns(bulkAssignSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-runs/bulk/finish:
 *   post:
 *     tags: [MachineRuns]
 *     summary: Seçili koşumları bitir (kapat) — Dokuma İş Emrini kapatmaz; sonuç PARÇALI olabilir
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ requested, ok[], failed[] }" }
 *       400: { description: Doğrulama }
 */
router.post("/bulk/finish", requireAnyPermission("loom:run"), async (req, res, next) => {
  try {
    res.json(await finishBulkRuns(bulkFinishSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

const openSchema = z
  .object({
    machineId: z.string().uuid("Geçersiz makine"),
    productionLineNo: z.number().int("Üretim hattı numarası tam sayı olmalıdır").default(1),
    weavingOrderId: z.string().uuid("Geçersiz dokuma iş emri").nullish(),
    itemId: z.string().uuid("Geçersiz ürün").nullish(),
    colorId: z.string().uuid("Geçersiz renk").nullish(),
    targetUnitsPerMin: z.number().int().positive("Hedef devir pozitif olmalı").max(10_000).nullish(),
    unitsPerCm: z.number().positive("Atkı sıklığı pozitif olmalı").max(1_000).nullish(),
    startedAt: z.coerce.date().nullish(),
    clientToken: z.string().uuid("Geçersiz istemci anahtarı").nullish(),
  })
  .strict();

const closeSchema = z
  .object({
    endedAt: z.coerce.date().nullish(),
    picksAtClose: z.number().int().nonnegative("Atkı sayısı negatif olamaz").nullish(),
    producedM: z.number().nonnegative("Üretilen metre negatif olamaz").max(1_000_000).nullish(),
    observedSecAtClose: z.number().int().nonnegative("Gözlenen süre negatif olamaz").nullish(),
  })
  .strict();

const revokeSchema = z
  .object({ reason: z.string().trim().min(1, "Geri alma için sebep zorunludur.").max(300) })
  .strict();

/**
 * @openapi
 * /api/machine-runs:
 *   post:
 *     tags: [MachineRuns]
 *     summary: Tezgah koşumu AÇ (üretim hattı başına tek açık koşum)
 *     description: >
 *       `clientToken` idempotent (çevrimdışı kuyruk aynı token'la tekrar gönderir).
 *       Hat numarası makinenin `productionLineCount`unu aşamaz (400
 *       PRODUCTION_LINE_OUT_OF_RANGE). Hatta açık koşum varsa 409
 *       PRODUCTION_LINE_OCCUPIED; yarışın kaybedeni 409 MACHINE_RUN_RACE.
 *       Beyan edilen `startedAt` makul aralık dışındaysa sunucu saati kullanılır ve
 *       `warnings` ile söylenir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Koşum açıldı (aynı token yeniden gelirse özgün koşum döner) }
 *       400: { description: Doğrulama / hat aralığı / fason iş (WEAVING_ORDER_SUBCONTRACTED) }
 *       403: { description: Dokuma işi modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *       409: { description: PRODUCTION_LINE_OCCUPIED · PRODUCTION_LINE_OVERLAP · MACHINE_RUN_RACE · WEAVING_ORDER_NOT_OPEN · CLIENT_TOKEN_COLLISION · RUN_REVOKED }
 */
router.post("/", requireAnyPermission("loom:run", ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    const b = openSchema.parse(req.body ?? {});
    res.status(201).json(await openMachineRun(b, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-runs/{id}/close:
 *   post:
 *     tags: [MachineRuns]
 *     summary: Tezgah koşumu KAPA (üretim terimleri satıra donar)
 *     description: >
 *       Atomik claim `closedTermsAt IS NULL`. `picksAtClose` · `producedM` ·
 *       `observedSecAtClose` ELLE beyan edilir (ölçülmemişse boş bırakılır; 0
 *       yazılmaz). Duruş terimleri bu dilimde yazılmaz (ingest dilimi).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Koşum kapatıldı }
 *       400: { description: Doğrulama / bitiş başlangıçtan önce (RUN_END_BEFORE_START) }
 *       404: { description: Koşum yok }
 *       409: { description: RUN_ALREADY_CLOSED · RUN_REVOKED · MACHINE_RUN_RACE }
 */
router.post("/:id/close", requireAnyPermission("loom:run", ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = closeSchema.parse(req.body ?? {});
    res.json(await closeMachineRun(id, b, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-runs/{id}/revoke:
 *   post:
 *     tags: [MachineRuns]
 *     summary: Tezgah koşumunu GERİ AL (damga; ileri satır silinmez, değişmez)
 *     description: >
 *       Açık ya da kapanmış koşum geri alınabilir. `revokedAt` damgası sedde yer
 *       işgal etmez (aynı hatta yeni koşum açılabilir); duruşların `runId`si
 *       değişmez. Sebep ZORUNLU.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Koşum geri alındı }
 *       404: { description: Koşum yok }
 *       409: { description: RUN_ALREADY_REVOKED }
 */
router.post("/:id/revoke", requireAnyPermission("loom:run-revoke", ...MOBILE_DOKUMA_GERI_AL), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = revokeSchema.parse(req.body ?? {});
    res.json(await revokeMachineRun(id, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
