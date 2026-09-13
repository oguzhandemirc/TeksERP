// =============================================================================
// TeksERP — Top İndirme (DoffEvent) Routes · kaydet / geri al
// =============================================================================
// ÜÇ KAPI SIRAYLA (machine-run emsali): `verifyToken` → `requireDokumaEnabled`
// (doff dokumanın olayıdır; kapı ön koşulu üretimi ÖNCE ölçer — ekran dilimiyle
// doğdu 2026-09-13, bekçi `test_dokuma_regime_gate`) → `requirePermission`.
// Geri alma AYRI izin (`loom:doff-revoke`): defterden satır düşürür.
// Tablet dilimi indiğinde uçlar `requireAnyPermission("loom:doff", ...MOBILE)`
// biçimine geçer; mobil izin kodu o dilimle doğar.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { MachineDataSource } from "@prisma/client";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { openDoff, revokeDoff } from "../services/machine-doff.service";

const router = Router();

router.use(verifyToken, requireDokumaEnabled);

const openSchema = z
  .object({
    machineId: z.string().uuid("Geçersiz makine"),
    productionLineNo: z.number().int("Üretim hattı numarası tam sayı olmalıdır").default(1),
    machineRunId: z.string().uuid("Geçersiz koşum").nullish(),
    doffedAt: z.coerce.date().nullish(),
    pieceCount: z.number().int("Parça sayısı tam sayı olmalıdır").min(1, "İndirilen parça sayısı en az 1 olmalı").max(1_000),
    counterAtDoff: z.number().int("Sayaç değeri tam sayı olmalıdır").nonnegative("Sayaç değeri negatif olamaz").nullish(),
    // `@default` YOK — her yazar beyan eder; `SIMULATED` beyanı burada doğar.
    counterSource: z.nativeEnum(MachineDataSource),
    notes: z.string().trim().max(300).nullish(),
    clientToken: z.string().uuid("Geçersiz istemci anahtarı").nullish(),
  })
  .strict();

const revokeSchema = z
  .object({ reason: z.string().trim().min(1, "Geri alma için sebep zorunludur.").max(300) })
  .strict();

/**
 * @openapi
 * /api/machine-doffs:
 *   post:
 *     tags: [MachineDoffs]
 *     summary: Top indirme (doff) KAYDET — tezgahtan kumaş indiği anın defteri
 *     description: >
 *       Top BURADA doğmaz; KK1'de `entrySource=WEAVING` + `doffEventId` ile doğar.
 *       `clientToken` idempotent (aynı token özgün kaydı döner; geri alınmışsa 409
 *       DOFF_REVOKED). Koşum bağı opsiyonel — koşum yoksa 400 değil `warnings`
 *       ("iş emri metresine GİRMİYOR"). `doffedAt` makul aralık dışındaysa sunucu
 *       saati kullanılır ve `warnings` ile söylenir. Kod sunucuda üretilir (DF+GGAAYY+NNNN).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: İndirme kaydedildi (aynı token yeniden gelirse özgün kayıt döner) }
 *       400: { description: Doğrulama / hat aralığı (PRODUCTION_LINE_OUT_OF_RANGE) / makine pasif }
 *       403: { description: Dokuma işi modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *       404: { description: Koşum yok }
 *       409: { description: DOFF_RUN_MISMATCH · RUN_REVOKED · DOFF_REVOKED · CLIENT_TOKEN_COLLISION }
 */
router.post("/", requirePermission("loom:doff"), async (req, res, next) => {
  try {
    const b = openSchema.parse(req.body ?? {});
    res.status(201).json(await openDoff(b, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-doffs/{id}/revoke:
 *   post:
 *     tags: [MachineDoffs]
 *     summary: Top indirmeyi GERİ AL (damga; yalnız hiç top doğurmamış indirmede)
 *     description: >
 *       Yüklem `revokedAt IS NULL AND NOT EXISTS rolls(doffEventId)` — statüye
 *       BAKILMAZ: iptal edilmiş top da doff'u tarihsel olgu yapar. Top varsa 409
 *       DOFF_HAS_ROLLS topları ADIYLA döner (barcodes[] · rollIds[]). Sebep ZORUNLU.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İndirme geri alındı }
 *       404: { description: İndirme yok }
 *       409: { description: DOFF_ALREADY_REVOKED · DOFF_HAS_ROLLS }
 */
router.post("/:id/revoke", requirePermission("loom:doff-revoke"), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = revokeSchema.parse(req.body ?? {});
    res.json(await revokeDoff(id, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
