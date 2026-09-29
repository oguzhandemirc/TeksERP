// KAYIT projeksiyonu satır kurucusu: kök kimliklerinden tel satırları. Yalnız katalogdaki
// opt-in kolonlar SEÇİLİR (Prisma `select`), türetilmiş alanlar tek kaynak yardımcılardan
// gelir, FINANS/KISISEL alanlar kök satırdan AYRILIP alt satıra bölünür (§3.1). Bulamadığı
// kök SILINDI, kapsamı geçmeyen kök KAPSAM_DISI döner — bulut satırı düşürür (§4.6).
import prisma from "../lib/prisma";
import { DERIVERS, DERIVER_ROW_FIELDS } from "./derived";
import { subRowName, type DataClass, type RecordProjection } from "./projections";
import { toWireValue, type DeleteReason, type WireValue } from "./wire";

export type WireRow = { id: string } & Record<string, WireValue>;

export interface BuiltRecords {
  /** Tel projeksiyon adı (`siparis`, `siparis.finans`…) → satırlar. */
  readonly rows: Map<string, WireRow[]>;
  readonly removed: Array<{ id: string; neden: DeleteReason }>;
}

/** `IN (...)` listesi tavanı — büyük kümeler parçalanır. */
const ID_CHUNK = 1000;

type Delegate = {
  findMany: (args: { where: Record<string, unknown>; select: Record<string, boolean> }) => Promise<Array<Record<string, unknown>>>;
};

function delegateOf(model: string): Delegate {
  const name = model.charAt(0).toLowerCase() + model.slice(1);
  const d = (prisma as unknown as Record<string, Delegate | undefined>)[name];
  if (!d || typeof d.findMany !== "function") throw new Error(`Eşitleme kataloğu: Prisma modeli yok (${model})`);
  return d;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Katalog kolonları + türeticinin ham satırdan okuduğu kolonlar (tel'e girmezler). */
export function selectionOf(p: RecordProjection): Record<string, boolean> {
  const fields = new Set<string>(["id", ...p.columns.map((c) => c.source), ...(DERIVER_ROW_FIELDS[p.name] ?? [])]);
  return Object.fromEntries([...fields].map((f) => [f, true]));
}

/**
 * Kök kimliklerini tel satırlarına çevirir. `nowMs` zamana bağlı türetilmiş alanların anı
 * (turun ufku DEĞİL — "gecikmiş" şimdiye göre hesaplanır, geçişi `crossings` yakalar).
 */
export async function buildRecords(p: RecordProjection, rootIds: readonly string[], nowMs: number): Promise<BuiltRecords> {
  const rows = new Map<string, WireRow[]>();
  const removed: Array<{ id: string; neden: DeleteReason }> = [];
  const delegate = delegateOf(p.root.model);
  const select = selectionOf(p);
  const classes = new Set<DataClass>(["ISLEM", ...p.columns.map((c) => c.dataClass), ...p.derived.map((d) => d.dataClass)]);
  for (const cls of classes) rows.set(subRowName(p, cls), []);

  for (const part of chunks([...new Set(rootIds)], ID_CHUNK)) {
    const where = p.scope ? { AND: [{ id: { in: part } }, p.scope.prismaWhere] } : { id: { in: part } };
    const found = (await delegate.findMany({ where, select })) as Array<Record<string, unknown> & { id: string }>;
    const foundIds = new Set(found.map((r) => r.id));
    const missing = part.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      const existing = p.scope ? new Set((await delegate.findMany({ where: { id: { in: missing } }, select: { id: true } })).map((r) => r.id as string)) : new Set<string>();
      for (const id of missing) removed.push({ id, neden: existing.has(id) ? "KAPSAM_DISI" : "SILINDI" });
    }
    if (found.length === 0) continue;
    const deriver = DERIVERS[p.name];
    const derived = deriver ? await deriver(found, nowMs) : new Map<string, Record<string, unknown>>();

    for (const raw of found) {
      const perClass = new Map<DataClass, WireRow>();
      const rowOf = (cls: DataClass): WireRow => {
        let r = perClass.get(cls);
        if (!r) {
          r = { id: raw.id };
          perClass.set(cls, r);
        }
        return r;
      };
      rowOf("ISLEM");
      for (const c of p.columns) {
        if (c.wire === "id") continue;
        rowOf(c.dataClass)[c.wire] = toWireValue(raw[c.source]);
      }
      const d = derived.get(raw.id) ?? {};
      for (const spec of p.derived) {
        if (!(spec.wire in d)) throw new Error(`Eşitleme: ${p.name}.${spec.wire} türetilmedi`);
        rowOf(spec.dataClass)[spec.wire] = toWireValue(d[spec.wire]);
      }
      for (const [cls, r] of perClass) rows.get(subRowName(p, cls))!.push(r);
    }
  }
  return { rows, removed };
}
