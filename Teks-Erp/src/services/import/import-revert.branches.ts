// =============================================================================
// İÇE AKTARIM GERİ SARMA — DAL YÜRÜTÜCÜLERİ
// =============================================================================
// Plan ve uçlar `import-revert.service.ts`te; YAZIM burada. Ayrım okunabilirlik
// içindir: her dalın kendi guard'ı var (pasife alma · pivot silme · belge iptali ·
// alan/çocuk geri yazımı) ve tek tek ölçülebilir kalmalı.
//
// ⚠️ HER YAZIM ATOMİK CLAIM: `updateMany WHERE {id, alan: import'un yazdığı değer}`.
// `count === 0` HATA DEĞİL BİR DALDIR — satır gerekçesiyle atlanır ve gerekçe
// `ImportRunLine.revertSkipReason`a yazılır (`findUnique→if→update` yasak).
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { OrderService } from "../order.service";
import type { ImportAdapter, ImportContext, PreparedRow } from "./import.types";

/** Ters yol sınıfı — §8.2 matrisinin koddaki karşılığı. */
export type RevertMode = "DEACTIVATE" | "DELETE_PIVOT" | "CANCEL_DOCUMENT";

export interface RevertLine {
  id: string;
  rowNo: number;
  entity: string;
  tableName: string;
  recordId: string;
  keyValue: string | null;
  action: "CREATE" | "UPDATE" | "REVIVE";
  changedFields: unknown;
  childSnapshot: unknown;
  revertedAt: Date | null;
}

export interface RevertAuditEntry {
  userId: string | undefined;
  action: "UPDATE";
  tableName: string;
  recordId: string;
  newData: Record<string, unknown>;
}

interface BranchOutcome {
  skipReason?: string;
  detail?: Record<string, unknown>;
}

type Delegate = {
  findMany: (a: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  updateMany: (a: Record<string, unknown>) => Promise<{ count: number }>;
  deleteMany: (a: Record<string, unknown>) => Promise<{ count: number }>;
};

/** `prisma["color"]` — model adı plan tablosundan gelir (BaseService emsali). */
export const delegateOf = (client: unknown, model: string): Delegate =>
  (client as Record<string, Delegate>)[model]!;

// Sipariş dalı MEVCUT iptal yolunu kullanır (atomik claim + WO/sevkiyat guard'ları).
// `orderService` örneği `routes/order.routes.ts`te yaşıyor; servis katmanının
// route'tan import etmesi emsalsiz bir ters bağımlılık olurdu. İptal yolu
// `this.config`ten YALNIZ `tableName` okuyor (ölçüldü: order.service.ts:2899).
const orderCancelService = new OrderService({ modelName: "order", tableName: "ORDER" });

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** JSON'a yazılan tarih METİN döner; WHERE'de Date olmalı yoksa claim hiç tutmaz. */
function fromJson(v: unknown): unknown {
  if (typeof v === "string" && ISO.test(v)) return new Date(v);
  return v ?? null;
}

/**
 * Bir defter satırının tersini yazar. Dönüş: uygulandı mı, atlandıysa gerekçe,
 * audit satırı. Damga KOLONLARI burada dolar — ileri satır ne silinir ne değişir.
 */
export async function revertOneLine(args: {
  line: RevertLine;
  plan: { model: string; mode: RevertMode };
  adapter: ImportAdapter;
  reason: string;
  userId?: string;
}): Promise<{ reverted: boolean; skipReason?: string; audit?: RevertAuditEntry }> {
  const { line, plan, adapter, reason, userId } = args;
  if (line.revertedAt !== null) {
    return { reverted: false, skipReason: "Bu satır zaten geri sarıldı" };
  }

  // Sipariş dalı KENDİ tx'ini açar (mevcut iptal yolu) → dış tx'e alınmaz.
  if (plan.mode === "CANCEL_DOCUMENT" && line.action === "CREATE") {
    const blocker = await cancelDocument(line.recordId, userId);
    if (blocker) {
      await stampSkip(line.id, blocker);
      return { reverted: false, skipReason: blocker };
    }
    await stampReverted(line.id, userId);
    return { reverted: true, audit: auditOf(line, reason, userId, { action: "CANCEL_DOCUMENT" }) };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    if (line.action === "CREATE") {
      return plan.mode === "DELETE_PIVOT"
        ? await deletePivot(tx, plan.model, line)
        : await deactivate(tx, plan.model, line.recordId);
    }
    return await restoreRow(tx, { adapter, model: plan.model, line, userId });
  });

  if (outcome.skipReason) {
    await stampSkip(line.id, outcome.skipReason);
    return { reverted: false, skipReason: outcome.skipReason };
  }
  await stampReverted(line.id, userId);
  return { reverted: true, audit: auditOf(line, reason, userId, outcome.detail) };
}

function auditOf(
  line: RevertLine,
  reason: string,
  userId: string | undefined,
  detail: Record<string, unknown> | undefined,
): RevertAuditEntry {
  return {
    userId,
    action: "UPDATE",
    tableName: line.tableName,
    recordId: line.recordId,
    newData: { event: "IMPORT_REVERT", rowNo: line.rowNo, reason, ...(detail ?? {}) },
  };
}

async function stampReverted(lineId: string, userId?: string): Promise<void> {
  await prisma.importRunLine.updateMany({
    where: { id: lineId, revertedAt: null },
    data: { revertedAt: new Date(), revertedById: userId ?? null, revertSkipReason: null },
  });
}

async function stampSkip(lineId: string, reason: string): Promise<void> {
  // İleri satır SİLİNMEZ: "neden atlandı" sorusu da deftere düşer.
  await prisma.importRunLine.updateMany({
    where: { id: lineId, revertedAt: null },
    data: { revertSkipReason: reason.slice(0, 300) },
  });
}

/** Yaratılan kaydı PASİFE al — atomik claim (hard delete YOK). */
async function deactivate(
  tx: Prisma.TransactionClient,
  model: string,
  recordId: string,
): Promise<BranchOutcome> {
  const claim = await delegateOf(tx, model).updateMany({
    where: { id: recordId, isActive: true },
    data: { isActive: false },
  });
  if (claim.count === 0) return { skipReason: "Kayıt zaten pasif ya da bulunamadı" };
  return { detail: { action: "DEACTIVATE" } };
}

/** ③b: yalnız koşumun yarattığı alias satırı, yalnız `assigned:false` ise (§8.2a). */
async function deletePivot(
  tx: Prisma.TransactionClient,
  model: string,
  line: RevertLine,
): Promise<BranchOutcome> {
  const where: Record<string, unknown> =
    line.entity === "customerColorAlias"
      ? { id: line.recordId, assigned: false }
      : { id: line.recordId };
  const claim = await delegateOf(tx, model).deleteMany({ where });
  if (claim.count === 0) {
    return { skipReason: "Satır silinemedi (müşteriye özel atanmış ya da bulunamadı)" };
  }
  return { detail: { action: "DELETE_PIVOT" } };
}

/** Mevcut iptal yolu. Dönüş: atlama gerekçesi ya da `null` (başarılı). */
async function cancelDocument(recordId: string, userId?: string): Promise<string | null> {
  try {
    const res = await orderCancelService.softDelete(recordId, userId);
    return res.success ? null : (res.message ?? "Belge iptal edilemedi");
  } catch (e) {
    // İş kuralı engeli bir DALDIR (sevk edilmiş/iş emri açılmış sipariş geri sarılamaz).
    if (e instanceof AppError && (e.statusCode === 409 || e.statusCode === 400)) return e.message;
    throw e;
  }
}

/**
 * UPDATE/REVIVE satırının tersi: önce skaler alanlar (alan bazlı atomik claim),
 * sonra REPLACE edilmiş çocuk koleksiyonları. `REVIVE`ın tersi kör `isActive:false`
 * DEĞİLDİR — `changedFields.isActive.from` defterde ne yazıyorsa o yazılır.
 */
async function restoreRow(
  tx: Prisma.TransactionClient,
  args: { adapter: ImportAdapter; model: string; line: RevertLine; userId?: string },
): Promise<BranchOutcome> {
  const { adapter, model, line, userId } = args;
  const cf = (line.changedFields as Record<string, { from: unknown; to: unknown }> | null) ?? {};
  const restored: string[] = [];
  const stale: string[] = [];

  for (const [field, pair] of Object.entries(cf)) {
    const claim = await delegateOf(tx, model).updateMany({
      where: { id: line.recordId, [field]: fromJson(pair.to) },
      data: { [field]: fromJson(pair.from) },
    });
    if (claim.count === 0) stale.push(field);
    else restored.push(field);
  }

  const child = await restoreChildren(adapter, line, userId);
  if (child.skipReason && restored.length === 0) return { skipReason: child.skipReason };
  if (restored.length === 0 && stale.length > 0) {
    return { skipReason: `Kayıt içe aktarımdan sonra değişti (${stale.join(", ")}) — geri yazılmadı` };
  }
  return {
    detail: {
      action: "RESTORE_FIELDS",
      restored,
      ...(stale.length > 0 ? { staleFields: stale } : {}),
      ...(child.detail ?? {}),
      ...(child.skipReason ? { childSkipReason: child.skipReason } : {}),
    },
  };
}

/**
 * REPLACE edilmiş çocuk kümesini geri yazar. Yazım ADAPTÖRÜN kendi yolundan geçer
 * (kod→id çözümü + guard'lar korunsun), sonra sonuç `findExisting` ile OKUNUR:
 * beklenen kümeye eşit değilse hata fırlatılır (tx geri alınır) — kör geri yazım yok.
 */
async function restoreChildren(
  adapter: ImportAdapter,
  line: RevertLine,
  userId?: string,
): Promise<BranchOutcome> {
  const snap = line.childSnapshot as Record<string, { from: unknown; to: unknown }> | null;
  if (!snap || Object.keys(snap).length === 0) return {};
  if (!line.keyValue) return { skipReason: "Çocuk geri yazımı için anahtar yok" };

  const before = await readChildSets(adapter, line.keyValue);
  if (!before) return { skipReason: "Çocuk geri yazımı: kayıt bulunamadı" };

  // Çocuğun CLAIM'i: küme hâlâ import'un yazdığı mı? Değilse DOKUNMA.
  const keys = Object.keys(snap);
  const changedByOthers = keys.filter((k) => !sameSet(before[k], snap[k]!.to));
  if (changedByOthers.length > 0) {
    return {
      skipReason: `Çocuk satırlarını başkası değiştirdi (${changedByOthers.join(", ")}) — geri yazılmadı`,
    };
  }

  const ctx: ImportContext = { userId, cache: new Map() };
  const row = synthRow(adapter, { recordId: line.recordId, keyValue: line.keyValue, snap, existing: before });
  await adapter.validateRow?.(row, ctx);
  if (row.result.errors.length > 0) {
    return {
      skipReason: `Çocuk geri yazımı doğrulanamadı: ${row.result.errors.map((e) => e.message).join("; ")}`,
    };
  }
  await adapter.updateOne(row, ctx);

  const after = await readChildSets(adapter, line.keyValue);
  const unwritten = keys.filter((k) => !sameSet(after?.[k], snap[k]!.from));
  if (unwritten.length > 0) {
    throw AppError.internal(
      `Çocuk geri yazımı doğrulanamadı (${unwritten.join(", ")}) — geri sarma iptal edildi.`,
    );
  }
  return { detail: { restoredChildren: keys } };
}

async function readChildSets(
  adapter: ImportAdapter,
  keyValue: string,
): Promise<Record<string, unknown> | undefined> {
  const map = await adapter.findExisting([keyValue]);
  return map.get(keyValue.toLocaleUpperCase("tr-TR")) ?? map.get(keyValue);
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
