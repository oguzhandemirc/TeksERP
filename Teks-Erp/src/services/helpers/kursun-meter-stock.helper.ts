// =============================================================================
// KURŞUN ÇIKIŞ METRESİ — STOK KİPİ APPLY (H1b) — uygulama ve ters yol TEK yerde
// =============================================================================
// RECORD (varsayılan, bugün): okuma stoğa dokunmaz. APPLY: ETKİN OUT okuması (onay gerekmiyor ya da
// onaylandı) topun `currentQty`sini okumaya çeker; fark sapma defterine `KURSUN_EXIT_MEASURE` kaynağıyla,
// `sourceRefId` = okuma kimliğiyle yazılır (eksi → RECORD_CORRECTION, artı → OVERAGE + `initialQty`
// yükseltmesi, `rolls_current_le_initial` seddi). Kip okuma satırındaki KOPYADAN okunur (`stockMode`).
// Ters yol: okuma damgalanınca (düzeltme · adım yeniden açma · elle geri taşıma) bağlı sapma satırı
// `reversedAt` alır ve metraj/giriş aynı miktarla geri döner. Top depo stoğundaysa stok defterine
// `rollVarianceId` bağlı ADJUST yazılır (adjustRollQty emsali; üretimdeki top satır almaz — giriş
// satırı son adım kapanışında güncel metrajla yazılır, defter = durum korunur).
// =============================================================================
import { MeterPhase, MeterStockMode, Prisma, RollStatus, RollVarianceKind, WarehouseEventType, type RollMeterReading } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { VARIANCE_SOURCES } from "../../constants/variance-reasons";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { recordVarianceTx } from "./roll-variance.helper";
import { postStockMove, qtyYazilabilir } from "./warehouse-ledger.helper";
import { isWarehouseStock } from "./warehouse-stock.helper";
import { assertWorkNotBilledTx } from "./service-billing-gate.helper";

type Tx = Prisma.TransactionClient;

/** Eksi yönün sabit sebebi — ölçüm, kayıtlı metrajın yanlış olduğunu gösterdi (fire DEĞİL). */
const SHORT_REASON_CODE = "OLCUM_HATASI";

export interface ExitMeterApplyResult {
  varianceId: string | null;
  kind: RollVarianceKind | null;
  diff: number;
}

/**
 * Etkin OUT okumasını stoğa uygular (yalnız okuma `stockMode = APPLY` ise). Çağıran: okuma yazımı (onay
 * gerekmiyor / OPERATOR_REASON aynı tx'te imzalı) ve imza yolu (PIN/OFFICE). Fark 0 ise satır yazılmaz.
 */
export async function applyExitMeterToStockTx(
  tx: Tx,
  reading: Pick<RollMeterReading, "id" | "rollId" | "workOrderStepId" | "phase" | "meters" | "stockMode">,
  userId: string | null,
): Promise<ExitMeterApplyResult | null> {
  if (reading.phase !== MeterPhase.OUT || reading.stockMode !== MeterStockMode.APPLY) return null;
  // Top okumanın adımından ayrıldıysa (elle ileri taşıma, kesim, depo, sevk) geç imza metrajı başka bir
  // yerdeki topa yazardı — satır kilidi altında konum doğrulanır, tutmuyorsa 409.
  const pos = await tx.$queryRaw<{ currentStepId: string | null; status: RollStatus }[]>`
    SELECT "currentStepId", status FROM rolls WHERE id = ${reading.rollId}::uuid FOR UPDATE`;
  if (pos.length === 0) throw AppError.notFound("Top bulunamadı");
  if (pos[0]!.currentStepId !== reading.workOrderStepId || pos[0]!.status !== RollStatus.IN_PRODUCTION) {
    throw AppError.conflict("Top bu ölçümün adımından ayrılmış — ölçüm stoğa uygulanamaz; topu adıma geri alıp yeniden ölçün", {
      code: "METER_STOCK_ROLL_LEFT_STEP",
      rollId: reading.rollId,
    });
  }
  const roll = await tx.roll.findUniqueOrThrow({
    where: { id: reading.rollId },
    select: { currentQty: true, initialQty: true, status: true, warehouseId: true },
  });
  const meters = new Prisma.Decimal(reading.meters);
  const diff = meters.minus(roll.currentQty);
  if (diff.isZero()) return { varianceId: null, kind: null, diff: 0 };
  // Faturalı işin metrajı değişmez (imza yolu da bu kapıdan geçer).
  await assertWorkNotBilledTx(tx, { rollIds: [reading.rollId], workOrderStepId: reading.workOrderStepId });

  const isShort = diff.isNegative();
  const qty = diff.abs();
  const raise = !isShort && meters.greaterThan(roll.initialQty) ? meters.minus(roll.initialQty) : null;
  // ATOMİK CLAIM: metraj okunduğu değerdeyse yaz (eşzamanlı yazar 409'a düşer, sapma iki kez sayılmaz).
  const claim = await tx.roll.updateMany({
    where: { id: reading.rollId, currentQty: roll.currentQty, initialQty: roll.initialQty },
    data: { currentQty: meters, ...(raise ? { initialQty: meters } : {}) },
  });
  if (claim.count === 0) {
    throw AppError.conflict("Topun metrajı bu sırada değişti — okumayı yeniden kaydedin", { code: "ROLL_QTY_CHANGED" });
  }
  const kind = isShort ? RollVarianceKind.RECORD_CORRECTION : RollVarianceKind.OVERAGE;
  const varianceId = await recordVarianceTx(tx, {
    rollId: reading.rollId,
    workOrderStepId: reading.workOrderStepId,
    kind,
    qty,
    reasonCode: isShort ? SHORT_REASON_CODE : null,
    reasonText: "Kurşun çıkış metresi stoğa uygulandı",
    source: VARIANCE_SOURCES.KURSUN_EXIT_MEASURE,
    sourceRefId: reading.id,
    initialQtyRaise: raise,
    userId,
  });
  if (varianceId && roll.warehouseId !== null && isWarehouseStock(roll) && qtyYazilabilir(qty)) {
    const end = { warehouseId: roll.warehouseId, status: roll.status };
    await postStockMove(tx, {
      rollId: reading.rollId,
      eventType: WarehouseEventType.ADJUST,
      qty,
      ...(isShort ? { from: end } : { to: end }),
      reasonCode: STOCK_MOVE_REASON.KURSUN_METER_ADJUST,
      rollVarianceId: varianceId,
      workOrderStepId: reading.workOrderStepId,
      userId,
    });
  }
  return { varianceId, kind, diff: Number(diff) };
}

/**
 * Adım kapanışında henüz uygulanmamış ETKİN APPLY okumalarını uygular: imza beklentisi sonradan kalkan
 * (IN düzeltmesi / belge satırı tabanı değiştirdi) okuma imzasız etkin olur ama hiçbir yazım anı
 * uygulamamıştır. Kapanış kapısı imza bekleyeni zaten reddettiği için burada kalan her okuma etkindir.
 */
export async function applyPendingExitMetersTx(
  tx: Tx,
  args: { stepId: string; rollIds: string[]; userId: string | null },
): Promise<Array<{ readingId: string; result: ExitMeterApplyResult | null }>> {
  if (args.rollIds.length === 0) return [];
  const readings = await tx.rollMeterReading.findMany({
    where: { workOrderStepId: args.stepId, rollId: { in: args.rollIds }, phase: MeterPhase.OUT, revokedAt: null, stockMode: MeterStockMode.APPLY,
      // Yalnız hâlâ bu adımda olan top (eşzamanlı kapanış onu ilerletmişse bu tur ona dokunmaz).
      roll: { currentStepId: args.stepId, status: RollStatus.IN_PRODUCTION } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (readings.length === 0) return [];
  const appliedRows = await tx.rollVariance.findMany({
    where: { source: VARIANCE_SOURCES.KURSUN_EXIT_MEASURE, sourceRefId: { in: readings.map((r) => r.id) }, reversedAt: null },
    select: { sourceRefId: true },
  });
  const applied = new Set(appliedRows.map((r) => r.sourceRefId));
  const out: Array<{ readingId: string; result: ExitMeterApplyResult | null }> = [];
  for (const r of readings) {
    if (applied.has(r.id)) continue;
    out.push({ readingId: r.id, result: await applyExitMeterToStockTx(tx, r, args.userId) });
  }
  return out;
}

/**
 * Damgalanan okumaların APPLY etkisini terslemek: bağlı aktif sapma satırı `reversedAt` alır, metraj
 * (ve yükseltildiyse giriş metrajı) aynı miktarla geri döner. Okuma damgası ile AYNI tx'te çağrılır.
 * Dönen: terslenen satır sayısı.
 */
export async function reverseExitMeterStockTx(tx: Tx, readingIds: string[], userId: string | null): Promise<number> {
  if (readingIds.length === 0) return 0;
  const rows = await tx.rollVariance.findMany({
    where: { source: VARIANCE_SOURCES.KURSUN_EXIT_MEASURE, sourceRefId: { in: readingIds }, reversedAt: null },
    select: { id: true, rollId: true, kind: true, qty: true, initialQtyRaise: true, workOrderStepId: true, sourceRefId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const v of rows) {
    const stamped = await tx.rollVariance.updateMany({
      where: { id: v.id, reversedAt: null },
      data: { reversedAt: new Date(), reversedById: userId },
    });
    if (stamped.count === 0) continue;
    const isShort = v.kind === RollVarianceKind.RECORD_CORRECTION;
    const raise = v.initialQtyRaise ?? new Prisma.Decimal(0);
    // Metraj hâlâ uygulanan ölçümdeyse geri döner; uygulamadan sonra başka bir yolla (kesim vb.) değiştiyse
    // fark artık o metraja ait değildir — sessiz yanlış yerine 409. Sınır denetimi ek sigortadır.
    const cur = await tx.roll.findUnique({ where: { id: v.rollId }, select: { currentQty: true, initialQty: true } });
    if (!cur) throw AppError.notFound("Top bulunamadı");
    const applied = await tx.rollMeterReading.findUnique({ where: { id: v.sourceRefId! }, select: { meters: true } });
    const nextQty = isShort ? cur.currentQty.plus(v.qty) : cur.currentQty.minus(v.qty);
    const nextInitial = cur.initialQty.minus(raise);
    const reverted =
      !applied || !cur.currentQty.equals(applied.meters) || nextQty.isNegative() || nextQty.greaterThan(nextInitial)
        ? 0
        : (
            await tx.roll.updateMany({
              where: { id: v.rollId, currentQty: cur.currentQty, initialQty: cur.initialQty },
              data: { currentQty: nextQty, ...(raise.isZero() ? {} : { initialQty: nextInitial }) },
            })
          ).count;
    if (reverted !== 1) {
      throw AppError.conflict("Topun metrajı kurşun çıkış ölçümünden sonra değişmiş — ölçüm geri alınamadı", {
        code: "KURSUN_METER_STOCK_REVERSE_CONFLICT",
        rollId: v.rollId,
      });
    }
    const roll = await tx.roll.findUnique({ where: { id: v.rollId }, select: { status: true, warehouseId: true } });
    if (roll && roll.warehouseId !== null && isWarehouseStock(roll) && qtyYazilabilir(v.qty)) {
      const end = { warehouseId: roll.warehouseId, status: roll.status };
      await postStockMove(tx, {
        rollId: v.rollId,
        eventType: WarehouseEventType.ADJUST,
        qty: v.qty,
        ...(isShort ? { to: end } : { from: end }),
        reasonCode: STOCK_MOVE_REASON.KURSUN_METER_ADJUST,
        rollVarianceId: v.id,
        workOrderStepId: v.workOrderStepId,
        userId,
      });
    }
  }
  return rows.length;
}

/** Uygulamanın ayak izi (tx DIŞI, best-effort): okuma + sapma satırı + fark. Ters yolun izi çağıran eylemin audit'indedir. */
export async function auditExitMeterStock(userId: string | undefined, readingId: string, result: ExitMeterApplyResult | null): Promise<void> {
  if (!result || result.varianceId == null) return;
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "ROLL_METER_STOCK_APPLY",
    recordId: readingId,
    newData: { varianceId: result.varianceId, kind: result.kind, diffMeters: result.diff },
  });
}
