// =============================================================================
// TOP OPERASYON İZİ — aktif yüklem + geri alma kapısı (tek kaynak)
// =============================================================================
// `RollOperation` "bu topa kurşun uygulandı mı / QC2'den geçti mi / fasona gitti
// mi" sorusunun cevabıdır. Şema başlığı append-only diyordu ama kod YEDİ yerde
// `deleteMany` ile siliyordu: geri alınmış bir adımın HİÇ OLMADIĞI iddia ediliyor,
// izlenebilirlik sorgusunun cevabı geriye dönük değişiyordu.
//
// 2026-09-11'den beri satır SİLİNMEZ, `revokedAt` ile damgalanır.
//
// ⚠️ DB'deki unique PARTIAL'dır (`roll_operations_active_triple_uq`,
// `WHERE "revokedAt" IS NULL`): geri alınmış satır dururken aynı (top, adım, tip)
// üçlüsü YENİDEN yazılabilsin — yoksa top o adımı bir daha işleyemezdi.
//
// Okuyan HER yol `ACTIVE_OPERATION`dan geçer; elle kopyalanan `revokedAt: null`
// bir gün unutulur ve geri alınmış iz "yapılmış" sayılır (ayrışan yüzey sınıfı).
// =============================================================================
import type { Prisma, RollOperationType } from "@prisma/client";
import { readWidthTrace, WIDTH_TRACE_OPERATION_TYPES } from "./measured-width.helper";
import { AppError } from "../../utils/app-error";

type Tx = Prisma.TransactionClient;

/** Geri alınmamış (yürürlükteki) operasyon izi. */
export const ACTIVE_OPERATION = { revokedAt: null } as const;

/**
 * Topun KENDİ operasyonu — Tambur/fason bölünmesinde parent'tan kopyalananlar hariç.
 *
 * ⚠️ `ACTIVE_OPERATION`dan FARKLI OLARAK HER OKUYUCUYA UYGULANMAZ: yalnız
 * "bu adımda FİİLEN iş yapıldı mı" sorusunu soran SAYIM ve UYGUNLUK yolları
 * kullanır. Üç sınıf bunu bilerek KULLANMAZ ve kullanmamalıdır:
 *   • kalıtım zincirinin kaynağı (süzerse zincir kopar, torun topta hiç op kalmaz)
 *   • topun geçmişini gösteren yüzey (çocuk kartında "kurşun yapılmış" görünmesi
 *     kalıtımın AMACIDIR)
 *   • "bu topa hiç dokunuldu mu" tipi tekil varlık kapısı (miras izi de
 *     dokunulmuşluktur)
 *
 * ⚠️ Bu yüzden AST kapısı YAZILMADI ve yazılmamalıdır: enforce edilecek küme 8,
 * muaf küme 33 (ölçüldü 2026-09-13). Muaf listesi enforce edileni aşan bir
 * tripwire kapı değil LİSTEDİR — bakımsız kalır, sonra "yeşil" diye okunur.
 * Kapı bir gün gerekirse YALNIZ agregat/uygunluk sınıfını ölçer, 41 okumanın
 * tamamını değil.
 */
export const OWN_OPERATION = { inheritedFromParentRollId: null } as const;

export interface RevokeOperationsArgs {
  rollIds: string[];
  workOrderStepIds?: string[];
  operationTypes?: RollOperationType[];
  /** Neden geri alındı — `TAMBUR_UNDO` / `FASON_CANCEL` / `MANUAL_MOVE` gibi. */
  reason: string;
  userId?: string | null;
  /** D4-E2a: verilirse eni geri konan top sayısı buraya yazılır (çağıranın audit yükü için). */
  widthRestored?: { count: number };
}

/**
 * İzi geri alır (silmez). Dönen sayı DAMGALANAN satır sayısıdır; eski
 * `deleteMany().count` ile aynı anlamı taşır, çağıranların sayaç mantığı bozulmaz.
 */
export async function revokeRollOperations(tx: Tx, args: RevokeOperationsArgs): Promise<number> {
  if (args.rollIds.length === 0) return 0;
  const where: Prisma.RollOperationWhereInput = {
    rollId: { in: args.rollIds },
    ...(args.workOrderStepIds ? { workOrderStepId: { in: args.workOrderStepIds } } : {}),
    ...(args.operationTypes ? { operationType: { in: args.operationTypes } } : {}),
    ...ACTIVE_OPERATION,
  };
  // D4-E2a ters yol: damgalanan satır ölçülen en izi taşıyorsa `Roll.width` aynı tx'te geri konur.
  const restored = await restoreMeasuredWidthsTx(tx, where);
  if (args.widthRestored) args.widthRestored.count += restored;
  const res = await tx.rollOperation.updateMany({
    where,
    data: {
      revokedAt: new Date(),
      revokedById: args.userId ?? null,
      revokeReason: args.reason.slice(0, 300),
    },
  });
  return res.count;
}

/**
 * Adım yeniden açılırken (D4-E2a) yalnız ÖLÇÜLEN EN izi taşıyan kendi satırları damgalar;
 * `revokeRollOperations` eni aynı tx'te geri koyar. Dönen: eni geri konan top sayısı.
 */
export async function revokeWidthTracedStepOperationsTx(
  tx: Tx,
  args: { rollIds: string[]; stepId: string; userId?: string | null },
): Promise<number> {
  if (args.rollIds.length === 0) return 0;
  const ops = await tx.rollOperation.findMany({
    where: {
      rollId: { in: args.rollIds },
      workOrderStepId: args.stepId,
      operationType: { in: WIDTH_TRACE_OPERATION_TYPES },
      ...ACTIVE_OPERATION,
      ...OWN_OPERATION,
    },
    select: { rollId: true, metadata: true },
  });
  const traced = ops.filter((o) => readWidthTrace(o.metadata) != null).map((o) => o.rollId);
  if (traced.length === 0) return 0;
  await revokeRollOperations(tx, {
    rollIds: traced,
    workOrderStepIds: [args.stepId],
    operationTypes: WIDTH_TRACE_OPERATION_TYPES,
    reason: "WIDTH_REOPEN",
    userId: args.userId ?? null,
  });
  return traced.length;
}

/**
 * D4-E2a: en ile adım bitişinden ÖNCE (iş emri kilidi altında) aktif kendi QC2 satırına bakar.
 * Yok → "APPLY". İzsiz satır (ensiz kapanmış / yeniden açılmış adım) damgalanır → "APPLY" (yeni
 * izli satır doğar; yoksa reopen izsiz satırı korur ve döngü çıkışsız kalırdı). Aynı en izli →
 * "SAME" (replay). Farklı en izli → 409 `WIDTH_ALREADY_RECORDED` (çıkış: adımı yeniden açmak).
 */
export async function prepareWidthTracedStepOpTx(
  tx: Tx,
  args: { rollId: string; stepId: string; measuredWidthCm: number; userId?: string | null },
): Promise<"APPLY" | "SAME"> {
  const existing = await tx.rollOperation.findFirst({
    where: {
      rollId: args.rollId,
      workOrderStepId: args.stepId,
      operationType: { in: WIDTH_TRACE_OPERATION_TYPES },
      ...ACTIVE_OPERATION,
      ...OWN_OPERATION,
    },
    select: { metadata: true },
  });
  if (!existing) return "APPLY";
  const prior = readWidthTrace(existing.metadata);
  if (!prior) {
    await revokeRollOperations(tx, {
      rollIds: [args.rollId],
      workOrderStepIds: [args.stepId],
      operationTypes: WIDTH_TRACE_OPERATION_TYPES,
      reason: "WIDTH_REMEASURE",
      userId: args.userId ?? null,
    });
    return "APPLY";
  }
  if (Math.round(args.measuredWidthCm * 1000) / 1000 === prior.widthAfter) return "SAME";
  throw AppError.conflict(
    "Bu topun eni bu adımda zaten ölçüldü — farklı en için adımı yeniden açın",
    { code: "WIDTH_ALREADY_RECORDED", widthAfter: prior.widthAfter },
  );
}

/**
 * TERS YOL — damgalanacak satırların en izini geri koyar. Yalnız topun KENDİ satırı
 * (miras kopya değil); aynı topta birden çok iz varsa en yeniden eskiye. Claim
 * `WHERE {id, width: widthAfter}`; 0 satır → 409 `ROLL_CHANGED` (Düzelt sessiz ezilmez).
 */
export async function restoreMeasuredWidthsTx(tx: Tx, where: Prisma.RollOperationWhereInput): Promise<number> {
  const ops = await tx.rollOperation.findMany({
    where: { AND: [where, { ...ACTIVE_OPERATION, ...OWN_OPERATION, operationType: { in: WIDTH_TRACE_OPERATION_TYPES } }] },
    select: { rollId: true, metadata: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  let restored = 0;
  for (const op of ops) {
    const trace = readWidthTrace(op.metadata);
    if (!trace) continue;
    const res = await tx.roll.updateMany({
      where: { id: op.rollId, width: trace.widthAfter },
      data: { width: trace.widthBefore },
    });
    if (res.count === 0) {
      throw AppError.conflict(
        "Topun eni ölçümden sonra değiştirilmiş (Düzelt) — geri alma eni ezmez; önce eni elle kontrol edin",
        { code: "ROLL_CHANGED", rollId: op.rollId, widthAfter: trace.widthAfter },
      );
    }
    restored++;
  }
  return restored;
}
