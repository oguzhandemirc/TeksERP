// =============================================================================
// TeksERP — MAKİNE KARTI DURUŞ UÇLARI (makine kaynaklı duruş D3b) · /api/machine-signals
// =============================================================================
// ⚠️ KİMLİK `verifyToken` DEĞİL: kart oturum açmaz, her isteği imzalar (`verifyCollectorSignature`)
// → `requireTezgahEnabled` → `requireDokumaEnabled` (duruş dokuma modelidir; elle uçla aynı kapı) → kapsam (tezgah karta bağlı değilse 403). Kaynak gövdeden ALINMAZ:
// her zaman `MACHINE`. Yazma `machine-stop-signal.service` → tek boğaz (`openStopCore`/`closeStopCore`).
// Protokol (donanım ekibi): docs/design/MAKINE-KART-PROTOKOLU.md.
// =============================================================================
import { MachineDataSource, MachineSignalKind } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { verifyCollectorSignature } from "../middlewares/collector-auth.middleware";
import { requireDokumaEnabled, requireTezgahEnabled } from "../middlewares/module.middleware";
import { STOP_REPLAY_MESSAGE } from "../services/machine-stop.service";
import { STOP_CLAIM_MESSAGE, closeMachineStop, openMachineStop } from "../services/machine-stop-signal.service";
import { touchCollectorLiveness } from "../services/machine-watchdog.service";

const router = Router();

/** Canlılık (D4) — yalnız imza VE modül kapıları geçtikten sonra; kapalı modülde kart "görülmüş" sayılmaz. */
async function collectorSeen(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.collector) await touchCollectorLiveness(req.collector.id);
    next();
  } catch (e) {
    next(e);
  }
}
router.use(verifyCollectorSignature, requireTezgahEnabled, requireDokumaEnabled, collectorSeen);

const stamp = z.string().datetime({ offset: true, message: "Zaman ISO 8601 biçiminde olmalı (örn. 2026-10-12T08:15:00Z)." });

const openSchema = z
  .object({
    machineId: z.string().uuid("Tezgah kimliği geçersiz."),
    stopKey: z.string().uuid("Duruş anahtarı (stopKey) UUID olmalı."),
    rawStopCode: z.string().max(32, "Ham duruş kodu en çok 32 karakter olabilir.").nullish(),
    signalKind: z.nativeEnum(MachineSignalKind).nullish(),
    startedAt: stamp,
  })
  .strict();

const endSchema = z
  .object({
    machineId: z.string().uuid("Tezgah kimliği geçersiz."),
    stopKey: z.string().uuid("Duruş anahtarı (stopKey) UUID olmalı."),
    endedAt: stamp,
  })
  .strict();

/** Kapsam — tezgah bu karta bağlı değilse 403 (yabancı tezgaha basılamaz). */
function scopedCollector(req: Request, machineId: string): string {
  const c = req.collector;
  if (!c) throw new AppError("Kart kimliği doğrulanamadı.", 401, true, { code: "COLLECTOR_AUTH_FAILED" });
  if (!c.machineIds.includes(machineId.toLowerCase())) {
    throw AppError.forbidden("Bu tezgah bu karta bağlı değil.", { code: "MACHINE_NOT_IN_SCOPE", machineId });
  }
  return c.id;
}

/**
 * @openapi
 * /api/machine-signals/stop:
 *   post:
 *     tags: [MachineSignals]
 *     summary: Kart duruş gördü — duruşu AÇ (insanın açık duruşu varsa kart onu sahiplenir)
 *     description: |
 *       Kimlik imzalı başlıklarla (x-collector-id · x-collector-timestamp · x-collector-nonce ·
 *       x-collector-signature); oturum yok. Kaynak daima MACHINE. Ham kod eşlemesi varsa sebep donar.
 *     security: [{ collectorSignature: [] }]
 *     responses:
 *       201: { description: Duruş açıldı }
 *       200: { description: Yeniden gönderim (aynı stopKey) ya da insanın açık duruşu sahiplenildi }
 *       400: { description: Tanınmayan alan (source dahil) · biçim · STOP_STAMP_OUT_OF_RANGE }
 *       401: { description: COLLECTOR_AUTH_HEADERS · COLLECTOR_CLOCK_SKEW · COLLECTOR_NONCE_REPLAY · COLLECTOR_AUTH_FAILED }
 *       403: { description: MACHINE_NOT_IN_SCOPE · MODULE_DISABLED (tezgah ya da dokuma kapalı) }
 *       409: { description: STOP_ALREADY_OPEN (kartın kendi açık duruşu) · CLIENT_TOKEN_COLLISION · STOP_REVOKED }
 *       429: { description: COLLECTOR_RATE_LIMITED }
 */
router.post("/stop", async (req, res, next) => {
  try {
    const b = openSchema.parse(req.body ?? {});
    const collectorId = scopedCollector(req, b.machineId);
    const out = await openMachineStop({ ...b, startedAt: new Date(b.startedAt), source: MachineDataSource.MACHINE, collectorId });
    res.status(out.message === STOP_REPLAY_MESSAGE || out.message === STOP_CLAIM_MESSAGE ? 200 : 201).json(out);
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-signals/heartbeat:
 *   post:
 *     tags: [MachineSignals]
 *     summary: Kart nabzı — duruş yokken de kartın canlı olduğunu bildirir (gövde `{}`)
 *     security: [{ collectorSignature: [] }]
 *     responses:
 *       200: { description: Kart görüldü; sunucu saati döner }
 *       400: { description: Gövdede alan var }
 *       401: { description: Kart imzası doğrulanamadı }
 *       403: { description: MODULE_DISABLED (tezgah ya da dokuma kapalı) }
 *       429: { description: COLLECTOR_RATE_LIMITED }
 */
router.post("/heartbeat", (req, res, next) => {
  try {
    z.object({}).strict().parse(req.body ?? {});
    res.json({ success: true, data: { serverTime: Math.floor(Date.now() / 1000) } });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-signals/end:
 *   post:
 *     tags: [MachineSignals]
 *     summary: Kart duruşun bittiğini gördü — duruşu KAPAT (endSource SIGNAL)
 *     security: [{ collectorSignature: [] }]
 *     responses:
 *       200: { description: Kapatıldı · aynı bitişin tekrarı · watchdog'un geçici kapanışı gerçek bitişle düzeltildi (bir kez) }
 *       400: { description: Tanınmayan alan · biçim · STOP_END_BEFORE_START }
 *       401: { description: Kart imzası doğrulanamadı }
 *       403: { description: MACHINE_NOT_IN_SCOPE · MODULE_DISABLED (tezgah ya da dokuma kapalı) }
 *       404: { description: STOP_NOT_FOUND }
 *       409: { description: STOP_CLOSED_BY_OPERATOR · STOP_END_CONFLICT · STOP_REVOKED · STOP_OVERLAP · SHIFT_SEALED (geçici kapanışın düzeltmesi mühürlü vardiyada — lateEndQueued, mühür açılınca uygulanır) }
 *       429: { description: COLLECTOR_RATE_LIMITED }
 */
router.post("/end", async (req, res, next) => {
  try {
    const b = endSchema.parse(req.body ?? {});
    scopedCollector(req, b.machineId);
    res.json(await closeMachineStop({ ...b, endedAt: new Date(b.endedAt), source: MachineDataSource.MACHINE }));
  } catch (e) {
    next(e);
  }
});

export default router;
