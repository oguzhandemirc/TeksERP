// =============================================================================
// EN ÖLÇEN İSTASYON — ölçülen enin `Roll.width`e yazımı ve TERS yolu (D4-E2a, K10)
// =============================================================================
// Etek kesim gibi en düşüren bir adımda gerçek en kayda geçer; Tambur en kapısı
// (`assertRollMatchesPlan`) değişmeden bu yeni enle karşılaştırır. `Roll.width`
// DURUMDUR, iz adım bitiş satırının (`RollOperation.metadata.widthBefore/After`)
// içindedir. İleri ve ters yazım SİMETRİK atomik claim'dir: arada Düzelt eni
// değiştirdiyse ters yol eni sessizce ezmez, 409 `ROLL_CHANGED` verir.
// =============================================================================
import { Prisma, RollOperationType } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../utils/app-error";
import { effectiveTamburPlanWidthGate } from "../system-setting.service";

type Tx = Prisma.TransactionClient;

/** Gövde alanı — iki tablet bitiş yolunda (completeQc2 · kursunFinish) BİREBİR; eski istemci göndermez. */
export const measuredWidthCmSchema = z
  .number()
  .positive("Ölçülen en sıfırdan büyük olmalı")
  .max(100000, "Ölçülen en çok büyük")
  .nullish();

/** Ölçülen en izi — adım bitiş satırının metadata'sına yazılır. */
export interface MeasuredWidthTrace {
  widthBefore: number | null;
  widthAfter: number;
}

/** En izini taşıyabilen adım bitiş satırı tipi (completeQc2 / kursunFinish). */
export const WIDTH_TRACE_OPERATION_TYPES: RollOperationType[] = [RollOperationType.QC2_COMPLETED];

const toNum = (v: Prisma.Decimal | null): number | null => (v == null ? null : Number(v));

/** Yeteneksiz istasyona en gelirse 400 — tx DIŞINDA, yazımdan önce. */
export async function assertStationCapturesWidth(client: Pick<Tx, "station">, stationId: string): Promise<void> {
  const st = await client.station.findUnique({ where: { id: stationId }, select: { capturesWidth: true } });
  if (!st?.capturesWidth) {
    throw AppError.badRequest("Bu istasyon en ölçmez — ölçülen en gönderilemez", { code: "WIDTH_CAPTURE_DISABLED" });
  }
}

/**
 * Topu `FOR UPDATE` kilitler, değeri doğrular (> 0 ve ≤ mevcut en + Tambur en eşiği) ve
 * `Roll.width`i atomik yazar. Çağıran kilit sırası: token → iş emri → (bu) top → yazım.
 */
export async function applyMeasuredWidthTx(
  tx: Tx,
  args: { rollId: string; measuredWidthCm: number },
): Promise<MeasuredWidthTrace> {
  const rows = await tx.$queryRaw<{ width: Prisma.Decimal | null }[]>`
    SELECT width FROM rolls WHERE id = ${args.rollId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw AppError.notFound("Top bulunamadı");
  const before = rows[0].width;
  const widthBefore = toNum(before);
  const { toleranceCm } = await effectiveTamburPlanWidthGate(tx);
  // Decimal(12,3) ile aynı yuvarlama — iz ile kolon bayt-eşit kalsın (ters yol claim'i eşitlikle eşler).
  const after = Math.round(args.measuredWidthCm * 1000) / 1000;
  if (!(after > 0) || (widthBefore != null && after > widthBefore + toleranceCm)) {
    throw AppError.badRequest(
      widthBefore == null
        ? "Ölçülen en sıfırdan büyük olmalı"
        : `Ölçülen en 0'dan büyük ve en fazla ${widthBefore + toleranceCm} cm olmalı (mevcut en ${widthBefore} cm + eşik ${toleranceCm} cm)`,
      { code: "WIDTH_OUT_OF_RANGE", widthBefore, toleranceCm },
    );
  }
  const claimed = await tx.roll.updateMany({ where: { id: args.rollId, width: before }, data: { width: after } });
  if (claimed.count === 0) {
    throw AppError.conflict("Topun eni bu arada değişti — yeniden okutun", { code: "ROLL_CHANGED" });
  }
  return { widthBefore, widthAfter: after };
}

/** Metadata'dan en izini okur; iz yoksa null (eski satırlar, en ölçülmeyen adımlar). */
export function readWidthTrace(metadata: Prisma.JsonValue | null): MeasuredWidthTrace | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  if (typeof m.widthAfter !== "number") return null;
  const before = m.widthBefore;
  return { widthBefore: typeof before === "number" ? before : null, widthAfter: m.widthAfter };
}
