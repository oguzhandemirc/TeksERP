// Toplam şeridi (saf): Σ satır ↔ blok başına beyan (T.Adet/kg/m). Backend `totalMismatches`
// (`gelen-belge-onay.service.ts`) ile aynı ölçüt: SKIPPED satır sayılmaz, hoşgörü binde 5 (en az 0,001).
// Beyan JSON'da metin ya da sayı gelebilir (OCR metin yazar) — ikisi de `Number` ile okunur.
import type { DeclaredBlock, DeliveryNoteLine } from "./types";

export const TOTAL_TOLERANCE = 0.005;

export interface BlockTotal {
  blockNo: number;
  count: number;
  m: number;
  kg: number;
  declared: { count: number | null; m: number | null; kg: number | null };
  /** Beyan yoksa `null` (doğrulanamaz); varsa her beyan alanı tuttu mu. */
  ok: boolean | null;
  mismatches: string[];
}

type TotalLine = Pick<DeliveryNoteLine, "blockNo" | "meters" | "weightKg" | "status">;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * TOTAL_TOLERANCE);

const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 });

export function blockTotals(lines: readonly TotalLine[], declaredBlocks: readonly DeclaredBlock[] | null | undefined): BlockTotal[] {
  const live = lines.filter((l) => l.status !== "SKIPPED");
  const blockNos = new Set<number>(live.map((l) => l.blockNo));
  for (const b of declaredBlocks ?? []) blockNos.add(b.blockNo ?? 1);
  if (blockNos.size === 0) blockNos.add(1);
  return [...blockNos].sort((a, b) => a - b).map((blockNo) => {
    const bl = live.filter((l) => l.blockNo === blockNo);
    const m = bl.reduce((s, l) => s + Number(l.meters), 0);
    const kg = bl.reduce((s, l) => s + Number(l.weightKg ?? 0), 0);
    const d = (declaredBlocks ?? []).find((x) => (x.blockNo ?? 1) === blockNo);
    const declared = { count: num(d?.count), m: num(d?.m), kg: num(d?.kg) };
    const mismatches: string[] = [];
    if (declared.count !== null && declared.count !== bl.length) mismatches.push(`beyan ${declared.count} top, satır ${bl.length}`);
    if (declared.m !== null && !near(m, declared.m)) mismatches.push(`beyan ${fmt(declared.m)} m, satır ${fmt(m)} m`);
    if (declared.kg !== null && !near(kg, declared.kg)) mismatches.push(`beyan ${fmt(declared.kg)} kg, satır ${fmt(kg)} kg`);
    const hasDeclared = declared.count !== null || declared.m !== null || declared.kg !== null;
    return { blockNo, count: bl.length, m, kg, declared, ok: hasDeclared ? mismatches.length === 0 : null, mismatches };
  });
}

/** Belge genelinde uyuşmazlık var mı (onay öncesi gerekçe alanını açar). */
export function hasMismatch(totals: readonly BlockTotal[]): boolean {
  return totals.some((t) => t.ok === false);
}

export { fmt as formatQty };
