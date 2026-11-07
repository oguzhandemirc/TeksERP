// =============================================================================
// BEKÇİ — dinamik cursor where'i SARGABLE sınır taşır, sonuç kümesi DEĞİŞMEZ
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts cursor_sargable_sinir   (DB'siz)
//
// ⭐ NEDEN (perf 2026-11-07): `(f < v) OR (f = v AND id < c)` tek başına index koşulu olamaz; Adnan
//    kopyasında "Tümü" 100. sayfası `rolls_createdAt_id_idx`i BAŞTAN gezip 10.000 satır süzüyordu
//    (4,7 ms; Seq Scan'li eski hâl 2,4 ms). Gereksiz `f <= v` sınırı eklenince Index Cond olur (0,27 ms).
//
// NE ÖLÇER:
//   §1 şekil: null olmayan değer + nullable DEĞİL → `{AND:[{f:{lte|gte:v}}, {OR:[…]}]}` (yön doğru)
//   §2 nullable sıralama ve null fazı sınır TAŞIMAZ (null kuyruğu düşmesin)
//   §3 eşdeğerlik: sentetik satırlarda (eşit değerler + null'lar) yeni where'in seçtiği küme =
//      eski formül (sınırsız OR) — asc/desc × sayı/tarih/metin; sınır anlamı değiştirmez
// =============================================================================
import { dynamicCursorWhere, type DynamicCursor } from "../src/utils/cursor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

type Row = Record<string, unknown> & { id: string };
const cmp = (a: unknown, b: unknown): number => {
  const x = a instanceof Date ? a.getTime() : a, y = b instanceof Date ? b.getTime() : b;
  return (x as number | string) < (y as number | string) ? -1 : (x as number | string) > (y as number | string) ? 1 : 0;
};
/** Prisma where alt kümesi değerlendiricisi (AND · OR · eşitlik · null · lt/lte/gt/gte). SQL üç-değerli: null karşılaştırması false. */
function sec(w: unknown, r: Row): boolean {
  const o = w as Record<string, unknown>;
  return Object.entries(o).every(([k, v]) => {
    if (k === "AND") return (v as unknown[]).every((x) => sec(x, r));
    if (k === "OR") return (v as unknown[]).some((x) => sec(x, r));
    const val = r[k];
    if (v === null) return val === null;
    if (v instanceof Date || typeof v !== "object") return val !== null && cmp(val, v) === 0;
    return Object.entries(v as Record<string, unknown>).every(([op, t]) => {
      if (val === null) return false;
      const c = cmp(val, t);
      return op === "lt" ? c < 0 : op === "lte" ? c <= 0 : op === "gt" ? c > 0 : op === "gte" ? c >= 0 : false;
    });
  });
}
function eski(cur: DynamicCursor, typed: unknown, f: string, ord: "asc" | "desc", nullable: boolean) {
  const op = ord === "asc" ? "gt" : "lt";
  if (cur.v === null) return { [f]: null, id: { [op]: cur.id } };
  const b: unknown[] = [{ [f]: { [op]: typed } }, { AND: [{ [f]: typed }, { id: { [op]: cur.id } }] }];
  if (nullable) b.push({ [f]: null });
  return { OR: b };
}

// §1–§2 şekil
const d = new Date("2026-10-07T06:31:14.778Z");
const w1 = dynamicCursorWhere({ v: d.toISOString(), id: "m", t: "d" }, "createdAt", "desc") as { AND?: unknown[] };
const s1 = JSON.stringify(w1.AND?.[0]);
check("§1 desc: AND[0] = createdAt lte değer", Array.isArray(w1.AND) && s1 === JSON.stringify({ createdAt: { lte: d } }), s1);
const w2 = dynamicCursorWhere({ v: "5", id: "m", t: "n" }, "currentQty", "asc") as { AND?: unknown[] };
check("§1 asc: AND[0] = gte değer", JSON.stringify(w2.AND?.[0]) === JSON.stringify({ currentQty: { gte: 5 } }), JSON.stringify(w2.AND?.[0]));
const w3 = dynamicCursorWhere({ v: "B1", id: "m", t: "s" }, "barcode", "desc", true) as Record<string, unknown>;
check("§2 nullable sıralama sınır taşımaz (yalnız OR)", !("AND" in w3) && Array.isArray(w3.OR), JSON.stringify(w3));
const w4 = dynamicCursorWhere({ v: null, id: "m" }, "barcode", "desc", true) as Record<string, unknown>;
check("§2 null fazı sınır taşımaz", JSON.stringify(w4) === JSON.stringify({ barcode: null, id: { lt: "m" } }), JSON.stringify(w4));

// §3 eşdeğerlik
const ids = "abcdefghijklmnopqrstuvwxyz".split("");
const kumeler: Array<{ ad: string; f: string; tag: "n" | "d" | "s"; deger: (i: number) => unknown; ser: (x: unknown) => string }> = [
  { ad: "sayı", f: "q", tag: "n", deger: (i) => (i % 7 === 0 ? null : i % 5), ser: (x) => String(x) },
  { ad: "tarih", f: "t", tag: "d", deger: (i) => (i % 9 === 0 ? null : new Date(Date.UTC(2026, 0, 1 + (i % 4)))), ser: (x) => (x as Date).toISOString() },
  { ad: "metin", f: "s", tag: "s", deger: (i) => (i % 8 === 0 ? null : ["A", "B", "C"][i % 3]), ser: (x) => String(x) },
];
let denenen = 0, ayrisan = 0;
for (const k of kumeler) {
  const rows: Row[] = ids.map((id, i) => ({ id, [k.f]: k.deger(i) }));
  for (const ord of ["asc", "desc"] as const) for (const nullable of [false, true]) for (const r of rows) {
    const v = r[k.f];
    if (v === null && !nullable) continue;
    const cur: DynamicCursor = { v: v === null ? null : k.ser(v), id: r.id, t: k.tag };
    const typed = v;
    const yeni = dynamicCursorWhere(cur, k.f, ord, nullable);
    const old = eski(cur, typed, k.f, ord, nullable);
    denenen++;
    const a = rows.filter((x) => sec(yeni, x)).map((x) => x.id).join(","), b = rows.filter((x) => sec(old, x)).map((x) => x.id).join(",");
    if (a !== b) { ayrisan++; if (ayrisan <= 3) console.log(`   ayrışma ${k.ad} ${ord} nullable=${nullable} cursor=${JSON.stringify(cur)}: yeni[${a}] eski[${b}]`); }
  }
}
check("§3 yeni where = eski where (seçilen küme)", ayrisan === 0 && denenen > 100, `${denenen} cursor denendi, ${ayrisan} ayrışma`);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
