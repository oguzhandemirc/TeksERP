// İçe aktarım geri sarma — ÇOCUK KÜMESİ dalı (REPLACE edilmiş koleksiyonlar + onlara bağlı
// skalerler). `import-revert.branches.ts`ten ayrıldı: dal yürütücüsü dosya sınırını aşmasın.
import { AppError } from "../../utils/app-error";
import type { ImportAdapter, ImportContext, PreparedRow } from "./import.types";
import { importKey } from "./import-key";
import type { BranchOutcome, RevertLine } from "./import-revert.branches";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** JSON'a yazılan tarih METİN döner; WHERE'de Date olmalı yoksa claim hiç tutmaz. */
export function fromJson(v: unknown): unknown {
  if (typeof v === "string" && ISO.test(v)) return new Date(v);
  return v ?? null;
}

/**
 * REPLACE edilmiş çocuk kümesini geri yazar. Yazım ADAPTÖRÜN kendi yolundan geçer
 * (kod→id çözümü + guard'lar korunsun), sonra sonuç `findExisting` ile OKUNUR:
 * beklenen kümeye eşit değilse hata fırlatılır (tx geri alınır) — kör geri yazım yok.
 */
export async function restoreChildren(
  adapter: ImportAdapter,
  line: RevertLine,
  userId?: string,
  permissions?: string[],
): Promise<BranchOutcome> {
  const snap = line.childSnapshot as Record<string, { from: unknown; to: unknown }> | null;
  if (!snap || Object.keys(snap).length === 0) return {};
  if (!line.keyValue) return { skipReason: "Çocuk geri yazımı için anahtar yok" };

  const before = await readChildSets(adapter, line.keyValue);
  if (!before) return { skipReason: "Çocuk geri yazımı: kayıt bulunamadı" };

  // Çocuğun CLAIM'i: küme hâlâ import'un yazdığı mı? Değilse DOKUNMA.
  const keys = Object.keys(snap);
  const coupled = coupledPairs(adapter, line);
  const changedByOthers = [...keys, ...Object.keys(coupled)].filter(
    (k) => !sameSet(before[k], (snap[k] ?? coupled[k])!.to),
  );
  if (changedByOthers.length > 0) {
    return {
      skipReason: `Çocuk satırlarını başkası değiştirdi (${changedByOthers.join(", ")}) — geri yazılmadı`,
    };
  }

  const ctx: ImportContext = { userId, cache: new Map(), permissions };
  const row = synthRow(adapter, { recordId: line.recordId, keyValue: line.keyValue, snap, existing: before });
  for (const [k, pair] of Object.entries(coupled)) row.values[k] = fromJson(pair.from);
  await adapter.validateRow?.(row, ctx);
  if (row.result.errors.length > 0) {
    return {
      skipReason: `Çocuk geri yazımı doğrulanamadı: ${row.result.errors.map((e) => e.message).join("; ")}`,
    };
  }
  await adapter.updateOne(row, ctx);

  const after = await readChildSets(adapter, line.keyValue);
  const unwritten = [...keys, ...Object.keys(coupled)].filter(
    (k) => !sameSet(after?.[k], (snap[k] ?? coupled[k])!.from),
  );
  if (unwritten.length > 0) {
    throw AppError.internal(
      `Çocuk geri yazımı doğrulanamadı (${unwritten.join(", ")}) — geri sarma iptal edildi.`,
    );
  }
  return { detail: { restoredChildren: keys, ...(Object.keys(coupled).length > 0 ? { restoredCoupled: Object.keys(coupled) } : {}) } };
}

/** `revertCoupledFields` içinden bu satırda değişmiş olanlar (`changedFields` çifti). */
function coupledPairs(adapter: ImportAdapter, line: RevertLine): Record<string, { from: unknown; to: unknown }> {
  const cf = (line.changedFields as Record<string, { from: unknown; to: unknown }> | null) ?? {};
  return Object.fromEntries((adapter.revertCoupledFields ?? []).filter((k) => k in cf).map((k) => [k, cf[k]!]));
}

async function readChildSets(
  adapter: ImportAdapter,
  keyValue: string,
): Promise<Record<string, unknown> | undefined> {
  const map = await adapter.findExisting([keyValue]);
  return map.get(importKey(keyValue)) ?? map.get(keyValue);
}

/** Motorun diff'iyle AYNI kanonikleştirme: sıra bağımsız, boş=null. */
function sameSet(a: unknown, b: unknown): boolean {
  return canon(a) === canon(b);
}
function canon(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return [...v].map((x) => canon(x)).sort().join("|");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .map((k) => `${k}=${canon(o[k])}`)
      .join(";");
  }
  return String(v);
}

/**
 * Adaptörün beklediği `PreparedRow`u kurar: yalnız ANAHTAR + geri yazılacak çocuk
 * kümeleri. Skaler alanlar BURAYA GİRMEZ (onlar atomik claim'le yazıldı; boş hücre
 * "dokunma" demek).
 */
function synthRow(
  adapter: ImportAdapter,
  args: {
    recordId: string;
    keyValue: string;
    snap: Record<string, { from: unknown; to: unknown }>;
    existing: Record<string, unknown>;
  },
): PreparedRow {
  const { recordId, keyValue, snap, existing } = args;
  const values: Record<string, unknown> = { [adapter.keyColumns[0]!]: keyValue };
  let children: PreparedRow["children"];
  for (const [k, pair] of Object.entries(snap)) {
    if (k === "__children") {
      const list = (pair.from as Array<Record<string, unknown>> | null) ?? [];
      children = list.map((vals, i) => ({ rowNo: i + 1, values: vals }));
    } else {
      values[k] = pair.from ?? [];
    }
  }
  return {
    input: { rowNo: 0, cells: {} },
    values,
    result: { rowNo: 0, action: "UPDATE", targetId: recordId, key: keyValue, errors: [], warnings: [] },
    existing,
    children,
  };
}
