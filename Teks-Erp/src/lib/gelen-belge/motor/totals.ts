// D3a (2026-10-28): toplam sağlaması — TASARIM-KARARI §5 "üç düzey, tek yardımcı".
// Para/ölçü aritmetiği kayan noktada DEĞİL, 3 ondalıklı ölçekli tam sayıda yapılır (Decimal(12,3) ile aynı hassasiyet).
import type { DeclaredTotals, NoteTotalsBlock, NoteTotalsBlockInput, NoteTotalsResult, TotalsStatus } from "./types";

const SCALE = 1000;

/** Kanonik sayı dizesini ("141.7", "3935") 3 ondalık ölçekli tam sayıya çevirir; çözülemezse null. */
export function toScaled(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,}))?$/.exec(value.trim());
  if (!m) return null;
  const frac = (m[3] ?? "").slice(0, 3).padEnd(3, "0");
  const n = Number(m[2]) * SCALE + Number(frac);
  return m[1] === "-" ? -n : n;
}

/** Ölçekli tam sayıyı kanonik dizeye çevirir (sondaki sıfırlar atılır). */
export function fromScaled(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs / SCALE);
  const frac = String(abs % SCALE).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? "." + frac : ""}`;
}

/** Kanonik dizelerin toplamı; null girdiler atlanır, hiç sayı yoksa "0". */
export function sumCanonical(values: Array<string | null | undefined>): string {
  let total = 0;
  for (const v of values) {
    const s = toScaled(v);
    if (s !== null) total += s;
  }
  return fromScaled(total);
}

/** İki kanonik dize eşit mi (ölçekli karşılaştırma; "586" = "586.00"). */
export function canonicalEquals(a: string | null, b: string | null): boolean {
  const sa = toScaled(a);
  const sb = toScaled(b);
  return sa !== null && sb !== null && sa === sb;
}

function diffOf(declared: string | null, computed: string): string | null {
  const d = toScaled(declared);
  if (d === null) return null;
  return fromScaled(d - (toScaled(computed) ?? 0));
}

function blockStatus(declared: DeclaredTotals | null, computed: { count: number; kg: string; m: string }): TotalsStatus {
  if (!declared || (declared.count === null && declared.kg === null && declared.m === null)) return "UNVERIFIED";
  let compared = 0;
  let mismatch = false;
  if (declared.count !== null) {
    compared++;
    if (toScaled(declared.count) !== computed.count * SCALE) mismatch = true;
  }
  if (declared.kg !== null) {
    compared++;
    if (!canonicalEquals(declared.kg, computed.kg)) mismatch = true;
  }
  if (declared.m !== null) {
    compared++;
    if (!canonicalEquals(declared.m, computed.m)) mismatch = true;
  }
  if (compared === 0) return "UNVERIFIED";
  return mismatch ? "MISMATCH" : "MATCH";
}

function computeBlock(input: NoteTotalsBlockInput): NoteTotalsBlock {
  const computed = {
    count: input.lines.length,
    kg: sumCanonical(input.lines.map((l) => l.weightKg)),
    m: sumCanonical(input.lines.map((l) => l.meters)),
  };
  const status = blockStatus(input.declared, computed);
  const d = input.declared;
  return {
    blockNo: input.blockNo,
    computed,
    declared: d,
    status,
    diff: {
      count: d?.count !== null && d?.count !== undefined ? Number(d.count) - computed.count : null,
      kg: diffOf(d?.kg ?? null, computed.kg),
      m: diffOf(d?.m ?? null, computed.m),
    },
  };
}

/**
 * Blok başına adet/kg/m hesabı ve beyan ↔ Σ karşılaştırması.
 * Uyarı kodları satırın BAŞINDA durur (ApiResponse.warnings / 409 TOTAL_MISMATCH eşlemesi önek ile yapılır):
 *   TOTAL_MISMATCH · TOTAL_UNVERIFIED · DECLARED_TOP_COUNT_DIFF
 */
export function computeNoteTotals(blocks: NoteTotalsBlockInput[]): NoteTotalsResult {
  const out = blocks.map(computeBlock);
  const warnings: string[] = [];
  for (const b of out) {
    const input = blocks.find((x) => x.blockNo === b.blockNo)!;
    if (b.status === "MISMATCH") {
      const parts: string[] = [];
      if (b.diff.count !== null && b.diff.count !== 0) parts.push(`adet beyan ${b.declared?.count} / hesap ${b.computed.count}`);
      if (b.diff.kg !== null && b.diff.kg !== "0") parts.push(`kg beyan ${b.declared?.kg} / hesap ${b.computed.kg}`);
      if (b.diff.m !== null && b.diff.m !== "0") parts.push(`m beyan ${b.declared?.m} / hesap ${b.computed.m}`);
      warnings.push(`TOTAL_MISMATCH blok ${b.blockNo}: ${parts.join("; ")}`);
    } else if (b.status === "UNVERIFIED") {
      warnings.push(`TOTAL_UNVERIFIED blok ${b.blockNo}: beyan edilen toplam okunamadı, operatör sağlaması gerekir`);
    }
    const top = toScaled(input.declaredTopCount ?? null);
    if (top !== null && top !== b.computed.count * SCALE) {
      warnings.push(`DECLARED_TOP_COUNT_DIFF blok ${b.blockNo}: başlıkta ${input.declaredTopCount} top yazıyor, ${b.computed.count} satır okundu`);
    }
  }
  return {
    blocks: out,
    grand: {
      count: out.reduce((s, b) => s + b.computed.count, 0),
      kg: sumCanonical(out.map((b) => b.computed.kg)),
      m: sumCanonical(out.map((b) => b.computed.m)),
    },
    warnings,
  };
}
