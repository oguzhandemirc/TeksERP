// =============================================================================
// DOFF ↔ TOP BAĞI — KK1'in tx'inde doff satırını KİLİTLEYEREK doğrular
// =============================================================================
// İki yazar, iki tx, tek bağ (DOKUMA-IS-EMRI-VE-TABLET-TASARIMI §3.8b): doff
// tablette doğar (tx-A), top KK1'de doğar (tx-B) ve bağ `Roll.doffEventId` ile
// tx-B'de kurulur. Bağ kurulurken doff satırı DÜZ OKUNMAZ, `FOR UPDATE` ile
// kilitlenir: aksi hâlde eşzamanlı `DOFF_CANCEL` kendi snapshot'ında
// `NOT EXISTS rolls` yüklemini geçer, tx-B commit eder ve iptal edilmiş bir
// indirmeye bağlı top doğar. Kilit tx ömürlüdür; `cash-balance-guard` emsali.
//
// `updateMany` ile "dokunma" kilidi burada YASAK: `DoffEvent` append-only,
// `updatedAt` taşımaz — satıra yazmadan kilit almak için tek yol FOR UPDATE.
// =============================================================================
import { Prisma, RollEntrySource } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Tx = Prisma.TransactionClient;

interface KilitliDoff {
  id: string;
  machineId: string;
  revokedAt: Date | null;
}

/**
 * Doff'u topa bağlanabilir hâlde kilitler; koşul tutmazsa 409/400 fırlatır.
 * Çağıran Roll INSERT'ini bu çağrıdan SONRA yapar (kilit tutuluyorken).
 *
 * - `doffEventId` yoksa hiçbir şey yapmaz (doff'suz WEAVING topu meşru — rapor
 *   "doff'suz top" kovasında ayrı gösterir).
 * - `entrySource !== WEAVING` iken doff verilmişse 400: bağ yalnız dokuma topuna aittir.
 * - Satır yoksa 404; `revokedAt` doluysa 409 `DOFF_NOT_LINKABLE`.
 * - Makine eşleşmesi YALNIZ KK1 cihazı bir tezgaha bağlıysa denetlenir (tezgah
 *   başı KK1): `createdMachineId` doluysa doff'un makinesiyle uyuşmalı — çıkarım
 *   değil kontrol. Masa KK1'de (damga yok) bağ KABUL: bağ zaten açık liste
 *   seçimidir ve KK1 damgası muayene istasyonunu taşır, tezgahı değil — "damga
 *   yoksa 400" hiç geçemeyen ölü bir kapı olurdu (1e hükmü 2026-09-13, 47 ölçtü).
 */
export async function claimDoffForRollTx(
  tx: Tx,
  args: { doffEventId: string | null | undefined; entrySource: RollEntrySource; createdMachineId: string | null },
): Promise<void> {
  if (!args.doffEventId) return;
  if (args.entrySource !== RollEntrySource.WEAVING) {
    throw AppError.badRequest("İndirme bağı yalnız dokuma (WEAVING) topuna verilebilir.", {
      code: "DOFF_LINK_REQUIRES_WEAVING",
      doffEventId: args.doffEventId,
      entrySource: args.entrySource,
    });
  }
  // Satır kilidi — yüklem (`revokedAt IS NULL`) SELECT'te değil, SONRA kontrol
  // edilir: geri alınmış satır da kilitlenir ki 404 ile 409 ayrışsın.
  const rows = await tx.$queryRaw<KilitliDoff[]>`
    SELECT id, "machineId", "revokedAt" FROM doff_events WHERE id = ${args.doffEventId}::uuid FOR UPDATE`;
  const doff = rows[0];
  if (!doff) throw AppError.notFound("İndirme kaydı bulunamadı", { doffEventId: args.doffEventId });
  if (doff.revokedAt) {
    throw AppError.conflict("Bu indirme geri alınmış — topa bağlanamaz. Yeni bir indirme kaydedin.", {
      code: "DOFF_NOT_LINKABLE",
      doffEventId: doff.id,
      revokedAt: doff.revokedAt,
    });
  }
  if (args.createdMachineId && args.createdMachineId !== doff.machineId) {
    throw AppError.conflict("Bu indirme başka bir makineye ait — topun makinesiyle uyuşmuyor.", {
      code: "DOFF_NOT_LINKABLE",
      doffEventId: doff.id,
      doffMachineId: doff.machineId,
      rollMachineId: args.createdMachineId,
    });
  }
}
