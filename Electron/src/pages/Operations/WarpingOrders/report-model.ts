// Devere siparişi özet metinleri (fabrika geri bildirimi 11-28, D1) — saf: çözgü raporu satırı · gönderilen kg/bobin
// toplamı · hedef üstü metre ("fazla devere") ve ücret etkisi. Sayılar sunucudan gelir; burada yalnız toplanır/biçimlenir.
import { formatQty } from "@/lib/format";
import { fmtKg, fmtM } from "./order-model";
import type { WarpingOrder } from "./types";
import type { WarpingDispatchRow } from "./yarn-types";

const ends = (n: number) => `${formatQty(n, 0)} tel`;

/** Çözgü raporu satırı HER ZAMAN dolu: not varsa not; tek iplikte "A · 6.000 tel (tek iplik)"; çok iplikte not yoksa tel payı. */
export function warpReportText(o: Pick<WarpingOrder, "warpSpec" | "yarns">): string {
  const note = o.warpSpec.sequenceNote?.trim();
  if (note) return note;
  if (o.yarns.length === 1) return `${o.yarns[0]!.letter} · ${ends(o.yarns[0]!.endsCount)} (tek iplik)`;
  if (o.yarns.length === 0) return "—";
  return `Dizilim girilmemiş — ${o.yarns.map((y) => `${y.letter} ${ends(y.endsCount)}`).join(" · ")}`;
}

export interface SentTotals {
  dispatchCount: number;
  kg: number;
  bobbins: number;
  packages: number;
  /** Bobin adedi girilmemiş canlı kalem sayısı. */
  bobbinMissing: number;
}

/** Canlı (iptal edilmemiş) sevklerin BRÜT kg'ı + kalemlerin bobin/koli toplamı. */
export function sentTotals(rows: readonly WarpingDispatchRow[]): SentTotals {
  const out: SentTotals = { dispatchCount: 0, kg: 0, bobbins: 0, packages: 0, bobbinMissing: 0 };
  for (const d of rows) {
    if (d.status === "CANCELLED") continue;
    out.dispatchCount++;
    out.kg += Number(d.totalOutKg);
    for (const it of d.items) {
      if (it.bobbinCount == null) out.bobbinMissing++;
      else out.bobbins += it.bobbinCount;
      out.packages += it.packageCount ?? 0;
    }
  }
  return out;
}

/** "150,000 kg · 3 koli · 120 bobin" + eksik notu; hiç sevk yoksa "Henüz sevk yok". */
export function sentText(t: SentTotals): { main: string; note: string | null } {
  if (t.dispatchCount === 0) return { main: "Henüz sevk yok", note: null };
  const parts = [`${fmtKg(t.kg)} kg`];
  if (t.packages > 0) parts.push(`${t.packages} koli`);
  if (t.bobbins > 0) parts.push(`${t.bobbins} bobin`);
  const note = t.bobbinMissing === 0 ? null : t.bobbins === 0 ? "bobin adedi girilmemiş" : `bobin eksik — ${t.bobbinMissing} kalemde girilmemiş`;
  return { main: parts.join(" · "), note };
}

/** Hedef üstü metre: fark > 0 ise etiket + ücret etkisi (METRE / tel×m hesaplanır; kg biriminde kg'dan gelir). Engel değil, bilgi. */
export function overrunInfo(diffM: string | number, fee?: WarpingOrder["fee"] | null, totalEnds?: number | null): { label: string; feeNote: string | null } | null {
  const x = Number(diffM);
  if (!Number.isFinite(x) || x <= 0) return null;
  const label = `Fazla devere +${fmtM(x)} m`;
  if (!fee) return { label, feeNote: null };
  if (fee.unitPrice === null) return { label, feeNote: "ücret girilmemiş" };
  const p = Number(fee.unitPrice);
  const cur = fee.currency ?? "";
  const money = (v: number) => `${formatQty(v, 2, 2)} ${cur}`.trim();
  if (fee.unit === "METRE") return { label, feeNote: `ücret etkisi +${fmtM(x)} m × ${formatQty(p, 8)} = +${money(x * p)}` };
  if (fee.unit === "ENDS_METRE" && totalEnds) return { label, feeNote: `ücret etkisi +${fmtM(x)} m × ${ends(totalEnds)} × ${formatQty(p, 8)} = +${money(x * totalEnds * p)}` };
  return { label, feeNote: "ücret kg başına — etkisi sarılan iplik kg'ından" };
}
