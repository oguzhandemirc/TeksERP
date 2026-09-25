// =============================================================================
// KARTELA OLAY DEFTERİ — tek yazar (docs/design/KARTELA-HAREKET-DEFTERI.md §5)
// =============================================================================
// Kartelanın yeri (`status` · `sackId` · `shipmentId` · `cancelledAt`) YALNIZ bu dosyadan
// yazılır ve her geçiş aynı tx'te `swatch_events`e satır düşer (`test_swatch_event_yazar`
// ölçer). Her olay tipi TEK bir geçiştir; çağıran yalnız tipi, kapsamı ve belgeyi verir,
// hangi kolonun ne olacağına tip karar verir. Kanal/cihaz/aktör istek bağlamından türer.
// Audit'ten okunmaz; audit yazımı çağıran eylemde kalır.
// =============================================================================

import { randomUUID } from "crypto";
import { Prisma, SwatchEventType, SwatchStatus } from "@prisma/client";
import { currentOrigin } from "../../lib/request-context";
import { resolveWorkOrderEventChannel } from "./workorder-event.helper";

type Tx = Prisma.TransactionClient;

/**
 * Tip → geçiş. DB CHECK'i `swatch_events_transition_known` ile boğaz-ikizdir: biri
 * değişirse öteki de değişir (`test_swatch_event_ledger` ikisini karşılaştırır).
 */
export const SWATCH_TRANSITIONS: Record<SwatchEventType, { from: SwatchStatus | null; to: SwatchStatus }> = {
  BORN: { from: null, to: SwatchStatus.IN_STOCK },
  VOIDED: { from: SwatchStatus.IN_STOCK, to: SwatchStatus.VOIDED },
  SACKED: { from: SwatchStatus.IN_STOCK, to: SwatchStatus.IN_SACK },
  UNSACKED: { from: SwatchStatus.IN_SACK, to: SwatchStatus.IN_STOCK },
  SHIPMENT_ADDED: { from: SwatchStatus.IN_SACK, to: SwatchStatus.IN_SHIPMENT },
  SHIPMENT_REMOVED: { from: SwatchStatus.IN_SHIPMENT, to: SwatchStatus.IN_SACK },
  SHIPPED: { from: SwatchStatus.IN_SHIPMENT, to: SwatchStatus.SHIPPED },
  SHIP_UNDONE: { from: SwatchStatus.SHIPPED, to: SwatchStatus.IN_SHIPMENT },
  REDUCED: { from: SwatchStatus.IN_STOCK, to: SwatchStatus.REDUCED },
  REDUCTION_REVERSED: { from: SwatchStatus.REDUCED, to: SwatchStatus.IN_STOCK },
};

/** Bağlı ters → terslediği ileri tip. Ters satır ileri satırın id'sini taşır. */
export const SWATCH_REVERSAL_OF: Partial<Record<SwatchEventType, SwatchEventType>> = {
  VOIDED: SwatchEventType.BORN,
  SHIP_UNDONE: SwatchEventType.SHIPPED,
  REDUCTION_REVERSED: SwatchEventType.REDUCED,
};

export interface SwatchEventCtx {
  /** Olayı başlatan işlem — sabit kod (`KARTELA_RECEIVE`, `SACK_SCAN` …). */
  trigger: string;
  userId?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
  /** Aynı eylemin birden çok satırı tek grupta; verilmezse yeni grup. */
  groupId?: string;
}

/** Hangi kartelalar — id listesi ya da içinde durdukları çuval/sevkiyat. */
export type SwatchScope = { ids: string[] } | { sackIds: string[] } | { shipmentId: string };

export interface SwatchTransitionOpts {
  scope: SwatchScope;
  /** SACKED: girilen çuval · UNSACKED: çıkılan çuval. Numara satırda donar. */
  sack?: { id: string; sackNo: string };
  /** SHIPMENT_ADDED: girilen · SHIPMENT_REMOVED/SHIPPED/SHIP_UNDONE: içinde bulunulan sevkiyat. */
  shipment?: { id: string; shipmentNo: string };
  /** REDUCED / REDUCTION_REVERSED: düşüm belgesi. */
  reductionId?: string;
  /** Claim'e eklenen atomik şart (ör. kabul kimliği). */
  where?: Prisma.SwatchWhereInput;
  ctx: SwatchEventCtx;
}

interface EventRow {
  swatchId: string;
  type: SwatchEventType;
  sackId?: string | null;
  sackNo?: string | null;
  shipmentId?: string | null;
  shipmentNo?: string | null;
  receiptId?: string | null;
  reductionId?: string | null;
  reversesEventId?: string | null;
}

async function writeSwatchEventsTx(tx: Tx, rows: EventRow[], ctx: SwatchEventCtx): Promise<void> {
  if (rows.length === 0) return;
  const origin = currentOrigin();
  const channel = resolveWorkOrderEventChannel();
  const groupId = ctx.groupId ?? randomUUID();
  await tx.swatchEvent.createMany({
    data: rows.map((r) => ({
      swatchId: r.swatchId,
      type: r.type,
      fromStatus: SWATCH_TRANSITIONS[r.type].from,
      toStatus: SWATCH_TRANSITIONS[r.type].to,
      groupId,
      trigger: ctx.trigger,
      channel,
      reason: ctx.reason?.slice(0, 300) ?? null,
      reasonCode: ctx.reasonCode ?? null,
      sackId: r.sackId ?? null,
      sackNo: r.sackNo ?? null,
      shipmentId: r.shipmentId ?? null,
      shipmentNo: r.shipmentNo ?? null,
      receiptId: r.receiptId ?? null,
      reductionId: r.reductionId ?? null,
      reversesEventId: r.reversesEventId ?? null,
      createdById: ctx.userId ?? origin.userId ?? null,
      deviceId: origin.deviceId,
    })),
  });
}

/** Kartela satırının doğuşta yazılamayan (yeri anlatan) kolonları — yer yalnız geçişle değişir. */
export type SwatchBirthInput = Omit<
  Prisma.SwatchCreateManyInput,
  "status" | "statusChangedAt" | "sackId" | "shipmentId" | "cancelledAt" | "cancelReason"
> & { parentReceiptId: string };

/**
 * Kartelaları DOĞURAN tek yol — satırlar stokta doğar, her biri için BORN satırı aynı tx'te.
 */
export async function createSwatchesTx(
  tx: Tx,
  rows: SwatchBirthInput[],
  ctx: SwatchEventCtx,
): Promise<{ id: string; parentReceiptId: string | null }[]> {
  if (rows.length === 0) return [];
  const now = new Date();
  const created = await tx.swatch.createManyAndReturn({
    data: rows.map((r) => ({ ...r, status: SwatchStatus.IN_STOCK, statusChangedAt: now })),
    select: { id: true, parentReceiptId: true },
  });
  await writeSwatchEventsTx(
    tx,
    created.map((s) => ({ swatchId: s.id, type: SwatchEventType.BORN, receiptId: s.parentReceiptId })),
    ctx,
  );
  return created;
}

function scopeWhere(scope: SwatchScope): Prisma.SwatchWhereInput {
  if ("ids" in scope) return { id: { in: scope.ids } };
  if ("sackIds" in scope) return { sackId: { in: scope.sackIds } };
  return { shipmentId: scope.shipmentId };
}

function requireRef<T>(ref: T | undefined, type: SwatchEventType, ad: string): T {
  if (ref === undefined) throw new Error(`transitionSwatchesTx(${type}): '${ad}' zorunlu`);
  return ref;
}

interface GecisPlani {
  /** Tipin yazdığı kolonlar (REDUCTION_REVERSED hariç — o boşaltmayı claim'de açıkça yazar). */
  kolonlar: Prisma.SwatchUncheckedUpdateManyInput;
  /** Claim'e eklenen yer şartı — eski yazarların WHERE'iyle aynı sıkılık. */
  kapsamSarti: Prisma.SwatchWhereInput;
  sack: { id: string; sackNo: string } | null;
  shipment: { id: string; shipmentNo: string } | null;
}

/** Tip → yazılan kolonlar, yer şartı ve zorunlu belge. */
function gecisPlani(type: SwatchEventType, opts: SwatchTransitionOpts, now: Date): GecisPlani {
  const p: GecisPlani = { kolonlar: {}, kapsamSarti: {}, sack: null, shipment: null };
  switch (type) {
    case SwatchEventType.SACKED:
      p.sack = requireRef(opts.sack, type, "sack");
      p.kolonlar = { sackId: p.sack.id };
      p.kapsamSarti = { sackId: null, shipmentId: null, cancelledAt: null };
      break;
    case SwatchEventType.UNSACKED:
      p.sack = requireRef(opts.sack, type, "sack");
      p.kolonlar = { sackId: null };
      p.kapsamSarti = { sackId: p.sack.id, shipmentId: null };
      break;
    case SwatchEventType.SHIPMENT_ADDED:
      p.shipment = requireRef(opts.shipment, type, "shipment");
      p.kolonlar = { shipmentId: p.shipment.id };
      p.kapsamSarti = { shipmentId: null };
      break;
    case SwatchEventType.SHIPMENT_REMOVED:
      p.shipment = requireRef(opts.shipment, type, "shipment");
      p.kolonlar = { shipmentId: null };
      p.kapsamSarti = { shipmentId: p.shipment.id };
      break;
    case SwatchEventType.SHIPPED:
    case SwatchEventType.SHIP_UNDONE:
      p.shipment = requireRef(opts.shipment, type, "shipment");
      p.kapsamSarti = { shipmentId: p.shipment.id };
      break;
    case SwatchEventType.REDUCED:
    case SwatchEventType.VOIDED:
      p.kolonlar = { cancelledAt: now, cancelReason: opts.ctx.reason ?? null };
      p.kapsamSarti = { sackId: null, shipmentId: null, cancelledAt: null };
      break;
    case SwatchEventType.REDUCTION_REVERSED:
      p.kapsamSarti = { cancelledAt: { not: null } };
      break;
  }
  if (type === SwatchEventType.REDUCED || type === SwatchEventType.REDUCTION_REVERSED) {
    requireRef(opts.reductionId, type, "reductionId");
  }
  return p;
}

/** Sevkiyat olayında kartelanın o anki çuvalı da satırda donar ("hangi çuvalla gitti"). */
async function cuvalNolariTx(tx: Tx, plan: GecisPlani, sackIds: (string | null)[]): Promise<Map<string, string>> {
  const nolar = new Map<string, string>();
  if (plan.sack) nolar.set(plan.sack.id, plan.sack.sackNo);
  const eksik = [...new Set(sackIds.filter((id): id is string => !!id && !nolar.has(id)))];
  if (plan.shipment && eksik.length > 0) {
    const cuvallar = await tx.sack.findMany({ where: { id: { in: eksik } }, select: { id: true, sackNo: true } });
    for (const c of cuvallar) nolar.set(c.id, c.sackNo);
  }
  return nolar;
}

/** Bağlı ters: kartela başına terslenmemiş en son ileri satır (aynı belgeye ait). */
async function terslenenlerTx(
  tx: Tx, type: SwatchEventType, swatchIds: string[], belge: { reductionId?: string; shipmentId?: string },
): Promise<Map<string, string>> {
  const bag = new Map<string, string>();
  const ileriTip = SWATCH_REVERSAL_OF[type];
  if (!ileriTip) return bag;
  const ileri = await tx.swatchEvent.findMany({
    where: {
      swatchId: { in: swatchIds },
      type: ileriTip,
      reversedBy: null,
      ...(belge.reductionId ? { reductionId: belge.reductionId } : {}),
      ...(belge.shipmentId ? { shipmentId: belge.shipmentId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, swatchId: true },
  });
  for (const e of ileri) if (!bag.has(e.swatchId)) bag.set(e.swatchId, e.id);
  return bag;
}

/**
 * Kartelaların yerini değiştiren TEK yol. Claim atomiktir: `WHERE {kapsam, status = from}`
 * ile yazılır ve yalnız GERÇEKTEN geçen satırlar döner; her birine aynı tx'te bir olay
 * satırı düşer. Beklenen sayıyla karşılaştırma ve 409 metni çağıranındır — çağıran
 * fırlatırsa tx olay satırlarıyla birlikte geri alınır.
 */
export async function transitionSwatchesTx(
  tx: Tx,
  type: SwatchEventType,
  opts: SwatchTransitionOpts,
): Promise<{ id: string }[]> {
  if (type === SwatchEventType.BORN) throw new Error("BORN yalnız createSwatchesTx ile yazılır");
  const gecis = SWATCH_TRANSITIONS[type];
  const now = new Date();
  const plan = gecisPlani(type, opts, now);

  const claimed = await tx.swatch.updateManyAndReturn({
    where: { ...opts.where, ...scopeWhere(opts.scope), ...plan.kapsamSarti, status: gecis.from as SwatchStatus },
    data: {
      status: gecis.to,
      statusChangedAt: now,
      // Düşüm stornosu durum kolonunu boşaltır; kim/neden REDUCTION_REVERSED satırında.
      ...(type === SwatchEventType.REDUCTION_REVERSED ? { cancelledAt: null, cancelReason: null } : plan.kolonlar),
    },
    select: { id: true, sackId: true, parentReceiptId: true },
  });
  if (claimed.length === 0) return [];

  const sackNoById = await cuvalNolariTx(tx, plan, claimed.map((c) => c.sackId));
  const reversesBySwatch = await terslenenlerTx(tx, type, claimed.map((c) => c.id), {
    reductionId: opts.reductionId, shipmentId: plan.shipment?.id,
  });
  await writeSwatchEventsTx(
    tx,
    claimed.map((c) => {
      const cuvalId = plan.sack?.id ?? c.sackId;
      return {
        swatchId: c.id,
        type,
        sackId: cuvalId,
        sackNo: cuvalId ? sackNoById.get(cuvalId) ?? null : null,
        shipmentId: plan.shipment?.id ?? null,
        shipmentNo: plan.shipment?.shipmentNo ?? null,
        receiptId: type === SwatchEventType.VOIDED ? c.parentReceiptId : null,
        reductionId: opts.reductionId ?? null,
        reversesEventId: reversesBySwatch.get(c.id) ?? null,
      };
    }),
    opts.ctx,
  );
  return claimed.map((c) => ({ id: c.id }));
}
