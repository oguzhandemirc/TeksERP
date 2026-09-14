// =============================================================================
// Vardiya kapanış materyalizasyonu (M2) — kapanan her (tezgah × vardiya) için karne satırı
// =============================================================================
// setInterval (node-cron yasak; archive-scheduler kalıbı). Tek Express process.
//
// Davranış (DOKUMA-RAPOR-BACKEND-TASARIM-OZETI §4 M2):
//   - `dokuma.enabled` KAPALIYKEN "disabled" — referans fabrikada satır DOĞMAZ.
//   - Pencere: `endsAt + KAPANIŞ_PAYI (60 dk)` geçmiş ve son LOOKBACK gün içindeki vardiyalar
//     × tezgah kümesi (aktif ∧ WEAVING istasyonu — M1 ile AYNI küme, 1e hükmü 2026-09-14:
//     `monitoringState` süzmez, kopyalanır; elle giriş yapılan tezgahın karnesi de yazılır).
//   - Satır yoksa OPEN doğar; OPEN ∧ makine/operatör kaynaklıysa yeniden hesaplanır;
//     SUPERVISOR (elle düzeltilmiş) ve SEALED satıra DOKUNULMAZ. Job MÜHÜRLEMEZ (Faz 2).
//   - Her çift kendi tx'inde (biri düşerse ötekiler yazılır); sonuç sayaçları döner.
// =============================================================================

import prisma from "../lib/prisma";
import { readDokumaEnabled } from "../services/system-setting.service";
import { materializeShiftStatTx, type MaterializeOutcome } from "../services/machine-shift-seal.service";
import { reportJobFailure } from "./job-failure";
import { bilgi, hata } from "../lib/logger";

/** Vardiya bitiminden sonra geç gelen kapanış/sınıflandırma için bekleme payı. */
export const SHIFT_CLOSE_GRACE_MIN = 60;
/** Kaç gün geriye bakılır — daha eski OPEN karneler elle/mühürle işlenir. */
export const SHIFT_CLOSE_LOOKBACK_DAYS = 3;
const SETTING_KEY = "dokuma.shiftCloseLastRunAt";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const STARTUP_DELAY_MS = 90 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export type ShiftCloseSummary = Record<MaterializeOutcome, number> & { pairs: number; failed: number };
export type ShiftCloseOutcome = "disabled" | ShiftCloseSummary;

export interface ShiftCloseRunOptions {
  now?: Date;
  /** Test enjeksiyonu: yalnız bu vardiyalar; üretimde pencere. */
  onlyShiftInstanceIds?: string[];
  /** Test enjeksiyonu: yalnız bu makineler; üretimde tezgah kümesi. */
  onlyMachineIds?: string[];
}

export async function runShiftCloseOnce(opts: ShiftCloseRunOptions = {}): Promise<ShiftCloseOutcome> {
  if (!(await readDokumaEnabled())) return "disabled";
  const now = opts.now ?? new Date();
  const sum: ShiftCloseSummary = { created: 0, recomputed: 0, "skipped-sealed": 0, "skipped-supervisor": 0, pairs: 0, failed: 0 };

  const closedBefore = new Date(now.getTime() - SHIFT_CLOSE_GRACE_MIN * 60_000);
  const notBefore = new Date(now.getTime() - SHIFT_CLOSE_LOOKBACK_DAYS * 86_400_000);
  const shifts = await prisma.shiftInstance.findMany({
    where: opts.onlyShiftInstanceIds
      ? { id: { in: opts.onlyShiftInstanceIds } }
      : { endsAt: { lte: closedBefore, gte: notBefore } },
    select: { id: true },
    orderBy: { endsAt: "asc" },
  });
  const looms = await prisma.machine.findMany({
    where: { isActive: true, station: { kind: "WEAVING" }, ...(opts.onlyMachineIds ? { id: { in: opts.onlyMachineIds } } : {}) },
    select: { id: true },
  });

  for (const shift of shifts) {
    for (const loom of looms) {
      sum.pairs += 1;
      try {
        const outcome = await prisma.$transaction((tx) => materializeShiftStatTx(tx, loom.id, shift.id, now));
        sum[outcome] += 1;
      } catch (err) {
        sum.failed += 1;
        hata("shift-close", `karne yazılamadı (makine ${loom.id}, vardiya ${shift.id}):`, err);
      }
    }
  }

  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: now.toISOString(), description: "Vardiya kapanış karnesi job'unun son koşumu" },
    update: { value: now.toISOString() },
  });
  return sum;
}

export function startShiftCloseScheduler(): void {
  if (timer) return;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runShiftCloseOnce()
      .then((r) => {
        if (r !== "disabled" && (r.created > 0 || r.recomputed > 0 || r.failed > 0)) {
          bilgi("shift-close", `karne: ${r.created} yeni, ${r.recomputed} yeniden hesaplandı, ${r["skipped-sealed"]} mühürlü, ${r["skipped-supervisor"]} elle düzeltilmiş atlandı, ${r.failed} hata`);
        }
      })
      .catch((err) => reportJobFailure("shift-close", err))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  bilgi("shift-close", `scheduler aktif — dokuma.enabled açıkken kapanan vardiyalar için karne yazılacak (pay ${SHIFT_CLOSE_GRACE_MIN} dk)`);
}
