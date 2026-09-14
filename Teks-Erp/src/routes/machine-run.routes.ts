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
router.get("/", requireAnyPermission("loom:run", "loom:doff", ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    const q = openListSchema.parse(req.query);
    res.json(await listOpenMachineRuns(q.machineId));
  } catch (e) {
    next(e);
  }
});

const openSchema = z
  .object({
    machineId: z.string().uuid("Geçersiz makine"),
    productionLineNo: z.number().int("Üretim hattı numarası tam sayı olmalıdır").default(1),
    weavingOrderId: z.string().uuid("Geçersiz dokuma işi").nullish(),
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
