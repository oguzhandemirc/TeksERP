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
import type { ImportAdapter } from "./import.types";
import { fromJson, restoreChildren } from "./import-revert.children";

/** Ters yol sınıfı — §8.2 matrisinin koddaki karşılığı. */
export type RevertMode = "DEACTIVATE" | "DELETE_PIVOT" | "CANCEL_DOCUMENT" | "REVOKE_VERSION";

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

export interface BranchOutcome {
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
  permissions?: string[];
}): Promise<{ reverted: boolean; skipReason?: string; audit?: RevertAuditEntry }> {
  const { line, plan, adapter, reason, userId, permissions } = args;
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

  // ③a damgalı sürüm (SY-H2): adaptörün servis yolu kendi tx'ini ve claim'ini açar.
  if (plan.mode === "REVOKE_VERSION") {
    if (!adapter.revertVersion) throw AppError.internal(`'${adapter.entity}' için sürüm ters yolu tanımlı değil.`);
    const blocker = await adapter.revertVersion(line, userId);
    if (blocker) {
      await stampSkip(line.id, blocker);
      return { reverted: false, skipReason: blocker };
    }
    await stampReverted(line.id, userId);
    return { reverted: true, audit: auditOf(line, reason, userId, { action: "REVOKE_VERSION" }) };
  }

  // Çocuk geri yazımı adaptörün SERVİS yolundan geçer (kendi bağlantısı): skaler claim'in tx'i
  // aynı satırı kilitliyken çağrılırsa kendi kilidini bekler ve tx zaman aşımına düşer (SY-H2
  // ölçtü: desen kartı ızgara + aile). Bu yüzden ÖNCE çocuk (fırlatırsa skaler yazılmaz), sonra tx.
  const child = line.action === "CREATE" ? {} : await restoreChildren(adapter, line, userId, permissions);
  // Çocuk geri yazılamadıysa ona bağlı skaler (ör. atkı sıra kodu ↔ adetler) da yazılmaz: yarım kart olmaz.
  if (child.skipReason) {
    await stampSkip(line.id, child.skipReason);
    return { reverted: false, skipReason: child.skipReason };
  }
  const outcome = await prisma.$transaction(async (tx) => {
    if (line.action === "CREATE") {
      return plan.mode === "DELETE_PIVOT"
        ? await deletePivot(tx, plan.model, line)
        : await deactivate(tx, plan.model, line.recordId);
    }
    return await restoreRow(tx, { adapter, model: plan.model, line, child });
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

/**
 * ③b pivot CREATE satırının claim'i: koşumun YAZDIĞI kolonlar (`changedFields[k].to`).
 * `null` → defter yazılan değeri taşımıyor (claim'li yazımdan önceki koşum); o satır
 * silinmez, çünkü "sonradan değişti mi" sorusu sorulamaz (fail-closed).
 */
export function pivotClaimOf(line: { changedFields: unknown }): Record<string, unknown> | null {
  const cf = line.changedFields as Record<string, { from: unknown; to: unknown }> | null;
  if (!cf || Object.keys(cf).length === 0) return null;
  return Object.fromEntries(Object.entries(cf).map(([k, pair]) => [k, fromJson(pair.to)]));
}

export const PIVOT_LEGACY_SKIP =
  "Eski koşum satırı: içe aktarımın yazdığı değer defterde yok — satır silinmedi, gerekiyorsa panelden kaldırın";

/** Önizlemenin claim ikizi: claim'den sapan kolonlar (boş = claim tutar). */
export function pivotClaimDrift(claim: Record<string, unknown>, rec: Record<string, unknown>): string[] {
  return Object.keys(claim).filter((k) => String(rec[k] ?? "") !== String(claim[k] ?? ""));
}

/** ③b: yalnız koşumun yarattığı satır, yalnız yazdığı değerler hâlâ yerindeyse (defter.md). */
async function deletePivot(
  tx: Prisma.TransactionClient,
  model: string,
  line: RevertLine,
): Promise<BranchOutcome> {
  const claimed = pivotClaimOf(line);
  if (!claimed) return { skipReason: PIVOT_LEGACY_SKIP };
  const where: Record<string, unknown> = { ...claimed, id: line.recordId };
  // Müşteriye ÖZEL atanmış renk satırı import tarafından yaratılmış OLAMAZ (§8.2a).
  if (line.entity === "customerColorAlias") where.assigned = false;
  const claim = await delegateOf(tx, model).deleteMany({ where });
  if (claim.count === 0) {
    return {
      skipReason: "Satır silinemedi (içe aktarımdan sonra değişti/taşındı, müşteriye özel atandı ya da bulunamadı)",
    };
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
 * UPDATE/REVIVE satırının tersi: skaler alanlar (alan bazlı atomik claim); REPLACE edilmiş
 * çocuk koleksiyonları tx'ten ÖNCE yazılmış olarak (`child`) gelir. `REVIVE`ın tersi kör `isActive:false`
 * DEĞİLDİR — `changedFields.isActive.from` defterde ne yazıyorsa o yazılır.
 */
async function restoreRow(
  tx: Prisma.TransactionClient,
  args: { adapter: ImportAdapter; model: string; line: RevertLine; child: BranchOutcome },
): Promise<BranchOutcome> {
  const { adapter, model, line, child } = args;
  const cf = (line.changedFields as Record<string, { from: unknown; to: unknown }> | null) ?? {};
  const restored: string[] = [];
  const stale: string[] = [];

  // Referans (lookup) sütunu DB kolonu değildir (kod ↔ id): claim'e girerse Prisma doğrulaması
  // tüm geri sarmayı düşürür. Geri yazılmaz, gerekçesiyle raporlanır (SY-H2).
  const lookupKeys = new Set(adapter.columns.filter((c) => c.type === "lookup").map((c) => c.key));
  const unsupported: string[] = [];
  const coupledDone = new Set((child.detail?.restoredCoupled as string[] | undefined) ?? []);
  for (const [field, pair] of Object.entries(cf)) {
    if (coupledDone.has(field)) {
      restored.push(field);
      continue;
    }
    if (lookupKeys.has(field)) {
      unsupported.push(field);
      continue;
    }
    const claim = await delegateOf(tx, model).updateMany({
      where: { id: line.recordId, [field]: fromJson(pair.to) },
      data: { [field]: fromJson(pair.from) },
    });
    if (claim.count === 0) stale.push(field);
    else restored.push(field);
  }

  if (restored.length === 0 && stale.length === 0 && unsupported.length > 0 && !child.detail) {
    return { skipReason: `Referans alanı geri yazılmaz (${unsupported.join(", ")}) — panelden düzeltin` };
  }
  if (restored.length === 0 && stale.length > 0) {
    return { skipReason: `Kayıt içe aktarımdan sonra değişti (${stale.join(", ")}) — geri yazılmadı` };
  }
  return {
    detail: {
      action: "RESTORE_FIELDS",
      restored,
      ...(stale.length > 0 ? { staleFields: stale } : {}),
      ...(unsupported.length > 0 ? { unsupportedFields: unsupported } : {}),
      ...(child.detail ?? {}),
    },
  };
}
