// =============================================================================
// TeksERP — Top İndirme (DoffEvent) Routes · kaydet / geri al
// =============================================================================
// ÜÇ KAPI SIRAYLA (machine-run emsali): `verifyToken` → `requireDokumaEnabled`
// (doff dokumanın olayıdır; kapı ön koşulu üretimi ÖNCE ölçer — ekran dilimiyle
// doğdu 2026-09-13, bekçi `test_dokuma_regime_gate`) → `requirePermission`.
// Geri alma AYRI izin (`loom:doff-revoke`): defterden satır düşürür.
// Tablet dilimi (2026-09-14): yazma uçları `requireAnyPermission("loom:doff", ...MOBILE_DOKUMA)`
// — tablet TEZGAH ekranının izni (`mobile:dokuma`) kabul edilir; geri alma
// `mobile:dokuma-geri-al` (ekran-içi yetenek). Bekçi `test_mobile_screen_permissions`.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { MachineDataSource } from "@prisma/client";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { AppError } from "../utils/app-error";
import { openDoff, revokeDoff } from "../services/machine-doff.service";
import { listDoffsForDay, listUnlinkedDoffs, UNLINKED_MAX_DAYS } from "../services/loom-list.service";
import { readKk1Context } from "../services/helpers/kk1-roll-birth.helper";

const router = Router();

router.use(verifyToken, requireDokumaEnabled);

// OKUMA uçları: tezgah ekranı (tablet, `mobile:dokuma`) ve KK1'in seçim listesi.
// Yazma izni olan (loom:doff) da okur; ayrı bir `loom:read` kodu AÇILMADI —
// listeler yazma yüzeyinin yüzüdür, tek başına verilen bir yetki değil.
const MOBILE_DOKUMA = ["mobile:dokuma"] as const;
/** Geri alma ayrı yetenek izni (`mobile:tambur-duzelt` · `shipping:undo-dispatch` emsali). */
const MOBILE_DOKUMA_GERI_AL = ["mobile:dokuma-geri-al"] as const;
/** KK1 operatörü "hangi indirmeden?" listesini (`unlinked=true`) okur — bağ KK1'de açık liste seçimidir (hüküm (a)). */
const MOBILE_KK1 = ["mobile:kk1"] as const;

const listSchema = z
  .object({
    machineId: z.string().uuid("Geçersiz makine").optional(),
    /** Fabrika günü (YYYY-MM-DD); verilmezse bugün. Yalnız `machineId` ile anlamlı. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD olmalı").optional(),
    /** `true` → hiç top doğurmamış, geri alınmamış indirmeler (KK1 seçim listesi); makine opsiyonel. */
    unlinked: z.enum(["true", "false"]).optional(),
    sinceDays: z.coerce.number().int().min(1).max(UNLINKED_MAX_DAYS).optional(),
  })
  .strict();

/**
 * @openapi
 * /api/machine-doffs:
 *   get:
 *     tags: [MachineDoffs]
 *     summary: İndirme listesi — günün indirmeleri (makine + fabrika günü) ya da BAĞLANMAMIŞ indirmeler
 *     description: >
 *       `unlinked=true`: hiç top doğurmamış ve geri alınmamış indirmeler, son `sinceDays` fabrika
 *       günü (varsayılan 3, tavan 30); `machineId` opsiyonel — masa KK1 her tezgahın indirmesini
 *       görür (bağ açık liste seçimidir). Aksi hâlde `machineId` ZORUNLU ve liste o makinenin
 *       `date` (varsayılan bugün) fabrika günündeki indirmeleridir; geri alınmışlar kapsam dışı.
 *       Liste 200'de kırpılır, `meta.total` kırpılmaz (`meta.truncated`). Z5 ön-dolgu (yalnız öneri): her satır
 *       koşum → iş zincirinden `weavingOrder {id, weavingOrderNumber}` · `item {id, code, name}` · `color {id, name}`
 *       taşır (koşumun deseni işin kumaşını ezer; koşumsuz doff'ta üçü null).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: machineId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: date
 *         schema: { type: string, example: "2026-09-14" }
 *       - in: query
 *         name: unlinked
 *         schema: { type: string, enum: ["true", "false"] }
 *       - in: query
 *         name: sinceDays
 *         schema: { type: integer, minimum: 1, maximum: 30 }
 *     responses:
 *       200: { description: Liste + meta (total · truncated · pencere) }
 *       400: { description: machineId eksik (günün listesi) ya da parametre hatası }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *       404: { description: Makine yok }
 */
router.get("/", requireAnyPermission("loom:run", "loom:doff", ...MOBILE_DOKUMA, ...MOBILE_KK1), async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    if (q.unlinked === "true") {
      res.json(await listUnlinkedDoffs({ machineId: q.machineId ?? null, sinceDays: q.sinceDays ?? null }));
      return;
    }
    if (!q.machineId) {
      throw AppError.badRequest("Günün indirme listesi için machineId zorunlu (bağlanmamışlar için unlinked=true).", { code: "MACHINE_ID_REQUIRED" });
    }
    res.json(await listDoffsForDay({ machineId: q.machineId, date: q.date ?? null }));
  } catch (e) {
    next(e);
  }
});

const kk1ContextSchema = z
  .object({
    machineCode: z.string().trim().min(1, "Tezgah etiketi boş olamaz").max(32, "Tezgah etiketi çok uzun"),
    productionLineNo: z.coerce.number().int("Üretim hattı numarası tam sayı olmalıdır").min(1, "Üretim hattı en az 1").optional(),
  })
  .strict();

/**
 * @openapi
 * /api/machine-doffs/kk1-context:
 *   get:
 *     tags: [MachineDoffs]
 *     summary: KK1 ön-dolgu — tezgah etiketinden açık koşum, iş emri, kumaş/renk, çözgü kartı, takılı leventler
 *     description: >
 *       "Top KK1'de doğar" (`dokuma.rollBirth` KK1_LABEL_OR_ORDER · KK1_LABEL_ONLY): operatör etiketi okutunca ekran
 *       bu uçla dolar; değerler ÖNERİDİR (D17), doğuş `POST /api/rolls/initial-entry` gövdesindeki `machineCode` ile
 *       olur. Hatalar doğuşla AYNI (404 MACHINE_NOT_FOUND · 400 MACHINE_NOT_LOOM · 409 MACHINE_NO_OPEN_RUN) — ekran
 *       kaydetmeden önce cevabı görür. `beams` yalnız devere açıkken dolar; `recentChange` son 12 saatteki en yeni
 *       takma/sökme olayıdır (levent beyanı `warpBeamId` için aynı pencere). Koşumun deseni işin kumaşını ezer.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: machineCode
 *         required: true
 *         schema: { type: string, maxLength: 32 }
 *       - in: query
 *         name: productionLineNo
 *         schema: { type: integer, minimum: 1, default: 1 }
 *     responses:
 *       200:
 *         description: >
 *           `{ machine:{id,code,name,productionLineCount}, run:{id,productionLineNo,startedAt,
 *           weavingOrder:{id,weavingOrderNumber}|null, item:{id,code,name}|null, color:{id,name}|null,
 *           warpSpec:{id,code,name,takeUpPct}|null}, beams:{mounted:[{id,beamNo,position,remainingM}],
 *           recentChange:{at,dismounted:{id,beamNo}|null,mounted:{id,beamNo}|null}|null}, rollBirth }`
 *       400: { description: Parametre hatası · MACHINE_NOT_LOOM · PRODUCTION_LINE_OUT_OF_RANGE }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *       404: { description: MACHINE_NOT_FOUND (yok ya da pasif) }
 *       409: { description: MACHINE_NO_OPEN_RUN — hatta açık koşum yok; panelden "İş ver" }
 */
router.get("/kk1-context", requireAnyPermission("loom:run", "loom:doff", ...MOBILE_DOKUMA, ...MOBILE_KK1), async (req, res, next) => {
  try {
    const q = kk1ContextSchema.parse(req.query);
    res.json({ success: true, data: await readKk1Context(q.machineCode, q.productionLineNo ?? null) });
  } catch (e) {
    next(e);
  }
});

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
router.post("/", requireAnyPermission("loom:doff", ...MOBILE_DOKUMA), async (req, res, next) => {
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
router.post("/:id/revoke", requireAnyPermission("loom:doff-revoke", ...MOBILE_DOKUMA_GERI_AL), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = revokeSchema.parse(req.body ?? {});
    res.json(await revokeDoff(id, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
