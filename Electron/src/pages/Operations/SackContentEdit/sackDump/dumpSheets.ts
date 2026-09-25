// =============================================================================
// Çuval İÇERİK DÖKÜMÜ — Excel sayfaları (buildWorkbook girdisi)
// =============================================================================
// Kolon, başlık, hücre değeri ve toplam `dumpModel`den gelir — PDF aynı modeli
// okur, burada kolon SEÇİLMEZ. Dosya düzeni PDF'in kâğıt düzenini izler:
//   • "Özet"    — yalnız çok çuvallı dökümde (PDF'teki ÖZET tablosu)
//   • <ÇuvalNo> — çuvalın başlık bilgileri + top tablosu + (varsa) kartela tablosu
// Her sayfa belge başlığıyla açılır: Excel'de sayfalar tek tek dolaşır.
// =============================================================================

import type { SheetColumn, SheetSpec } from "@/lib/xlsx-export";
import { buildSackDumpModel, EMPTY_SACK_TEXT, type DumpKind, type DumpTable } from "./dumpModel";
import type { SackDump, SackDumpOptions } from "./types";

/**
 * PDF metnini izleyen sayı biçimi — tam sayıda ondalık ayırıcı GÖRÜNMEZ
 * ("#,##0.###" 40'ı "40," gösterirdi); ondalıkta en çok 3 hane (PDF: tr-TR, ≤3).
 */
function numFmtOf(kind: DumpKind): SheetColumn["numFmt"] {
  if (kind === "text") return undefined;
  if (kind === "int") return "0";
  const suffix = kind === "cm" ? '" cm"' : "";
  return (v: unknown) =>
    typeof v === "number" ? `${Number.isInteger(v) ? "#,##0" : "#,##0.0##"}${suffix}` : undefined;
}

const alignOf = (kind: DumpKind): SheetColumn["align"] => (kind === "text" ? undefined : "right");

/** Excel sayfa adı: ≤31 karakter + `: \ / ? * [ ]` yasak; mükerrer ad " (2)" ile ayrışır. */
function uniqueSheetName(base: string, used: Set<string>): string {
  const name = base.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Çuval";
  for (let i = 1; i < 1000; i++) {
    const suffix = i === 1 ? "" : ` (${i})`;
    const candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return name; // ulaşılamaz (1000 mükerrer ad)
}

/** Modelin tablosu → sayfa kolonları + satırlar + toplam (anahtarlar kolon sırası). */
function tableParts(t: DumpTable): Pick<SheetSpec, "columns" | "rows" | "totalRow"> {
  const keys = t.columns.map((_, i) => `c${i}`);
  const rec = (vals: unknown[]) => Object.fromEntries(keys.map((k, i) => [k, vals[i] ?? null]));
  return {
    columns: t.columns.map((c, i) => ({
      header: c.label,
      key: keys[i]!,
      width: Math.min(40, Math.max(8, c.label.length + 2, ...t.rows.map((r) => String(r[i] ?? "").length + 2))),
      numFmt: numFmtOf(c.kind),
      align: alignOf(c.kind),
    })),
    rows: t.rows.map(rec),
    ...(t.foot ? { totalRow: rec(t.foot) } : {}),
  };
}

/** Döküm → çalışma kitabı sayfaları. `now` yalnız testte verilir. */
export function buildSackDumpSheets(dumps: SackDump[], opts: SackDumpOptions = {}, now?: Date): SheetSpec[] {
  const m = buildSackDumpModel(dumps, opts, now);
  const docHead: SheetSpec["preamble"] = [[m.title], [m.docMeta]];
  const used = new Set<string>(["Özet"]);
  const sheets: SheetSpec[] = [];
  if (m.summary) sheets.push({ name: "Özet", preamble: docHead, ...tableParts(m.summary) });
  for (const s of m.sacks) {
    const preamble: NonNullable<SheetSpec["preamble"]> = [
      ...docHead!,
      [s.sackNo],
      ...s.meta.map(([l, v]) => [l, v]),
      ...(s.note ? [["Not", s.note]] : []),
    ];
    sheets.push({
      name: uniqueSheetName(s.sackNo, used),
      preamble,
      ...(s.rolls ? tableParts(s.rolls) : { columns: [], rows: [], notes: [EMPTY_SACK_TEXT] }),
      ...(s.swatches
        ? {
            subTables: [
              {
                title: `KARTELALAR · ${s.swatches.rows.length}`,
                columns: s.swatches.columns.map((c) => ({ header: c.label, numFmt: numFmtOf(c.kind), align: alignOf(c.kind) })),
                rows: s.swatches.rows,
              },
            ],
          }
        : {}),
    });
  }
  return sheets;
}
