// =============================================================================
// DEVERE TESLİM SÜRESİ — "Bu devereci bir siparişi kaç günde getiriyor?" (TEK KAYNAK; devere-levent S1)
// =============================================================================
// Örnek = deverecinin KAPANMIŞ (COMPLETED) son N siparişi; süre = ilk canlı iplik sevki (iptalsiz) → ilk canlı kabul
// (iptal edilmemiş leventin stornosuz WOUND'u), fabrika günü farkı. Sevksiz / kabulsüz / ters sıralı sipariş örnek
// DEĞİLDİR. Tahmin MEDYANdır (tek uzun gecikme ortalamayı bozar). Çözgü kartı → kartın son deverecisi
// (`lastWarpingSubcontractorBySpec`); örnek yoksa `devere.defaultLeadDays` (> 0) yedek, o da yoksa null + gerekçe.
// =============================================================================
import { Prisma, WarpBeamStatus, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryYmd } from "../../constants/time";
import { daysBetweenYmd } from "../helpers/dokuma-levent-rapor.helper";
import { lastWarpingSubcontractorBySpec } from "../helpers/warp-supply.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Devereci başına örnek sayısı (son kapanmış N sipariş). */
export const LEAD_SAMPLE_N = 5;
/** Örnek ararken bakılan kapanmış sipariş tavanı (sevksiz/kabulsüz olanlar atlanır). */
const LEAD_CANDIDATE_CAP = 25;

export type LeadSource = "OLCUM" | "AYAR";

export interface SpecLead {
  leadDays: number | null;
  source: LeadSource | null;
  sampleCount: number;
  subcontractor: { id: string; name: string } | null;
  reason: string | null;
}

/** Medyan; boş dizide null. Çift adette ortadaki iki değerin ortalaması. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Tek siparişin süresi (fabrika günü); sevk/kabul yoksa ya da kabul sevkten önceyse null (örnek değil). */
export function orderLeadDays(firstDispatchAt: Date | null, firstReceiptAt: Date | null): number | null {
  if (!firstDispatchAt || !firstReceiptAt) return null;
  const d = daysBetweenYmd(factoryYmd(firstDispatchAt), factoryYmd(firstReceiptAt));
  return d < 0 ? null : d;
}

/** Devereci başına medyan süre + örnek sayısı; örneği olmayan devereci haritada YOK. */
export async function readLeadDaysBySubcontractor(db: Db, subcontractorIds: readonly string[]): Promise<Map<string, { leadDays: number; sampleCount: number }>> {
  const out = new Map<string, { leadDays: number; sampleCount: number }>();
  for (const subId of [...new Set(subcontractorIds)]) {
    const orders = await db.warpingOrder.findMany({
      where: { subcontractorId: subId, status: WarpingOrderStatus.COMPLETED },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      take: LEAD_CANDIDATE_CAP,
      select: {
        dispatches: { where: { cancelledAt: null }, select: { dispatchedAt: true } },
        warpBeams: {
          where: { status: { not: WarpBeamStatus.CANCELLED } },
          select: { events: { where: { kind: "WOUND", reversal: null }, select: { createdAt: true } } },
        },
      },
    });
    const samples: number[] = [];
    for (const o of orders) {
      if (samples.length >= LEAD_SAMPLE_N) break;
      const firstDispatch = minDate(o.dispatches.map((d) => d.dispatchedAt));
      const firstReceipt = minDate(o.warpBeams.flatMap((b) => b.events.map((e) => e.createdAt)));
      const d = orderLeadDays(firstDispatch, firstReceipt);
      if (d !== null) samples.push(d);
    }
    const m = median(samples);
    if (m !== null) out.set(subId, { leadDays: m, sampleCount: samples.length });
  }
  return out;
}

/** Çözgü kartı başına süre: kartın son deverecisinin medyanı ▸ ayar yedeği (`fallbackDays` > 0) ▸ null + gerekçe. */
export async function readLeadDaysBySpec(db: Db, warpSpecIds: readonly string[], fallbackDays: number): Promise<Map<string, SpecLead>> {
  const ids = [...new Set(warpSpecIds)];
  const out = new Map<string, SpecLead>();
  if (ids.length === 0) return out;
  const lastSub = await lastWarpingSubcontractorBySpec(db, ids);
  const bySub = await readLeadDaysBySubcontractor(db, [...lastSub.values()].map((s) => s.id));
  for (const id of ids) {
    const sub = lastSub.get(id) ?? null;
    const measured = sub ? bySub.get(sub.id) : undefined;
    if (measured) {
      out.set(id, { leadDays: measured.leadDays, source: "OLCUM", sampleCount: measured.sampleCount, subcontractor: sub, reason: null });
    } else if (fallbackDays > 0) {
      out.set(id, { leadDays: fallbackDays, source: "AYAR", sampleCount: 0, subcontractor: sub, reason: null });
    } else {
      out.set(id, {
        leadDays: null, source: null, sampleCount: 0, subcontractor: sub,
        reason: sub ? "deverecinin kapanmış sipariş geçmişi yok" : "bu çözgü kartının devere siparişi yok",
      });
    }
  }
  return out;
}

function minDate(ds: readonly Date[]): Date | null {
  let best: Date | null = null;
  for (const d of ds) if (best === null || d.getTime() < best.getTime()) best = d;
  return best;
}
