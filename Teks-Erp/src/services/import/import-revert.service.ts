// =============================================================================
// İÇE AKTARIM GERİ SARMA — plan + uçların servisi
// =============================================================================
// Sözleşme: docs/design/IMPORT-EXPORT-TASARIM.md §8 · doktrin docs/kurallar/defter.md
// Dal yazımları `import-revert.branches.ts`te.
//
// ⚠️ KOŞUM SATIRI "OLDU" KAYDIDIR: geri sarma onu NE SİLER NE DEĞİŞTİRİR, üstüne
// damga yazar (`revertedAt`/`revertedById`/`revertReason`). İleri defter satırı da
// silinmez; damga KOLONLARI dolar. Geri sarma BUGÜNE yazılan karşı kayıttır.
import prisma from "../../lib/prisma";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { getImportAdapter } from "./import-registry";
import { delegateOf, revertOneLine, type RevertAuditEntry, type RevertMode } from "./import-revert.branches";
import type { ImportAdapter } from "./import.types";

/**
 * 17 varlık × ters yol. `hardDeleteForbidden`: fiziksel silme REDDEDİLMEZ ama canlı
 * belgeleri sessizce null'lar/cascade'ler ⇒ geri sarma YALNIZ pasife alır (§8.2).
 * İki alias pivotu soft-delete kolonu taşımıyor ⇒ ③b sınıfı fiziksel silme (§8.2a).
 */
export const REVERT_PLAN: Record<string, { model: string; mode: RevertMode; hardDeleteForbidden?: boolean }> = {
  item: { model: "item", mode: "DEACTIVATE" },
  customer: { model: "customer", mode: "DEACTIVATE" },
  customerBranch: { model: "customerBranch", mode: "DEACTIVATE", hardDeleteForbidden: true },
  color: { model: "color", mode: "DEACTIVATE" },
  fabricProperty: { model: "fabricProperty", mode: "DEACTIVATE" },
  qualityGrade: { model: "qualityGrade", mode: "DEACTIVATE", hardDeleteForbidden: true },
  defectType: { model: "defectType", mode: "DEACTIVATE", hardDeleteForbidden: true },
  returnReason: { model: "returnReason", mode: "DEACTIVATE", hardDeleteForbidden: true },
  station: { model: "station", mode: "DEACTIVATE" },
  machine: { model: "machine", mode: "DEACTIVATE" },
  subcontractorCategory: { model: "subcontractorCategory", mode: "DEACTIVATE", hardDeleteForbidden: true },
  subcontractor: { model: "subcontractor", mode: "DEACTIVATE" },
  customerItemAlias: { model: "customerItemAlias", mode: "DELETE_PIVOT" },
  customerColorAlias: { model: "customerColorAlias", mode: "DELETE_PIVOT" },
  productRecipe: { model: "productRecipe", mode: "DEACTIVATE", hardDeleteForbidden: true },
  route: { model: "route", mode: "DEACTIVATE", hardDeleteForbidden: true },
  order: { model: "order", mode: "CANCEL_DOCUMENT" },
};

export type RevertRowAction =
  | "DEACTIVATE"
  | "RESTORE_FIELDS"
  | "RESTORE_CHILDREN"
  | "CANCEL_DOCUMENT"
  | "DELETE_PIVOT"
  | "SKIP";

export interface RevertPlanRow {
  lineId: string;
  rowNo: number;
  rowNos?: number[];
  entity: string;
  recordId: string;
  keyValue: string | null;
  label: string | null;
  lineAction: "CREATE" | "UPDATE" | "REVIVE";
  action: RevertRowAction;
  /** Geri yazılacak skaler alan ADLARI — değer DEĞİL (§8.3 kişisel veri kuralı). */
  fields: string[];
  /** Geri yazılacak çocuk koleksiyonları. */
  children: string[];
  /** Atlanacak/atlanmış: gerekçe (ayrı ayrı; tek "atlandı" kovası yok). */
  skipReason?: string;
  alreadyReverted: boolean;
}

export interface RevertPlan {
  runId: string;
  entity: string;
  entityLabel: string;
  runRevertedAt: Date | null;
  rows: RevertPlanRow[];
  /** "Bunlar KALACAK" — başka varlığa yazılmış yan satırlar silinmez. */
  sideEffects: Array<{ rowNo: number; note: string }>;
}

function assertEntityPermission(adapter: ImportAdapter, permissions: string[]): void {
  const ok =
    matchesPermission(permissions, adapter.writePermission) || matchesPermission(permissions, "admin:*");
  if (!ok) {
    throw AppError.forbidden(
      `'${adapter.label}' koşumunu geri sarmak için '${adapter.writePermission}' yetkisi de gerekli.`,
    );
  }
}

/** Varlık koşumun KENDİSİNDEN çözülür (`:entity` parametresinden değil). */
async function loadRun(
  runId: string,
  permissions: string[],
): Promise<{
  run: { id: string; entity: string; revertedAt: Date | null };
  adapter: ImportAdapter;
  plan: { model: string; mode: RevertMode };
}> {
  const run = await prisma.importRun.findUnique({
    where: { id: runId },
    select: { id: true, entity: true, revertedAt: true },
  });
  if (!run) throw AppError.notFound("İçe aktarım kaydı bulunamadı");
  const adapter = getImportAdapter(run.entity);
  assertEntityPermission(adapter, permissions);
  const plan = REVERT_PLAN[run.entity];
  if (!plan) {
    throw AppError.badRequest(`'${run.entity}' için ters yol tanımlı değil — geri sarma yapılamaz.`, {
      code: "IMPORT_REVERT_UNSUPPORTED",
    });
  }
  return { run, adapter, plan };
}

const keysOf = (v: unknown): string[] => (v ? Object.keys(v as Record<string, unknown>) : []);

export class ImportRevertService {
  /**
   * Geri sarma planı — HİÇBİR ŞEY YAZMAZ. Etkilenen HER satır döner, atlanacaklar
   * gerekçesiyle (yıkıcı işlemde soyut sayı yetmez kuralı).
   */
  static async preview(runId: string, permissions: string[]): Promise<RevertPlan> {
    const { run, adapter, plan } = await loadRun(runId, permissions);
    const lines = await prisma.importRunLine.findMany({
      where: { importRunId: runId },
      orderBy: { rowNo: "asc" },
    });

    // Mevcut durum TEK sorguda (satır başına sorgu N+1 olurdu).
    const ids = [...new Set(lines.map((l) => l.recordId))];
    const current = new Map<string, Record<string, unknown>>();
    if (ids.length > 0) {
      const rows = await delegateOf(prisma, plan.model).findMany({ where: { id: { in: ids } } });
      for (const r of rows) current.set(String(r.id), r);
    }

    const rows: RevertPlanRow[] = lines.map((l) => {
      const row: RevertPlanRow = {
        lineId: l.id,
        rowNo: l.rowNo,
        rowNos: (l.rowNos as number[] | null) ?? undefined,
        entity: run.entity,
        recordId: l.recordId,
        keyValue: l.keyValue,
        label: l.label,
        lineAction: l.action,
        action: "SKIP",
        fields: keysOf(l.changedFields),
        children: keysOf(l.childSnapshot),
        alreadyReverted: l.revertedAt !== null,
      };
      if (l.revertedAt !== null) {
        row.skipReason = "Bu satır zaten geri sarıldı";
        return row;
      }
      const rec = current.get(l.recordId);
      if (!rec) {
        row.skipReason = "Kayıt bulunamadı (sonradan silinmiş)";
        return row;
      }
      return l.action === "CREATE" ? planCreate(row, rec, plan.mode) : planUpdate(row);
    });

    return {
      runId,
      entity: run.entity,
      entityLabel: adapter.label,
      runRevertedAt: run.revertedAt,
      rows,
      // Sipariş dalı başka varlığın master satırlarını yazar; geri sarma onları
      // SİLMEZ (import kararıyla başka varlığın ana verisini yok etmek olurdu).
      sideEffects: lines
        .filter((l) => l.sideEffects !== null)
        .map((l) => ({ rowNo: l.rowNo, note: "Bu satırın yan etkileri KALACAK (başka varlığın ana verisi)" })),
    };
  }

  /**
   * Seçilen satırları geri sarar. Seçim ZORUNLU (boş gövdeyi "hepsini geri sar"
   * diye okumak sessiz yıkım olurdu), gerekçe ≥10 karakter.
   */
  static async revert(
    runId: string,
    opts: { reason: string; selectedRowNos: number[]; permissions: string[]; userId?: string },
  ): Promise<{ runId: string; reverted: number; skipped: Array<{ rowNo: number; reason: string }> }> {
    const reason = opts.reason?.trim() ?? "";
    if (reason.length < 10) {
      throw AppError.badRequest("Geri sarma gerekçesi en az 10 karakter olmalı.", {
        code: "IMPORT_REVERT_REASON_REQUIRED",
      });
    }
    if (!opts.selectedRowNos || opts.selectedRowNos.length === 0) {
      throw AppError.badRequest("Geri sarılacak satır seçilmedi.", { code: "IMPORT_REVERT_NO_SELECTION" });
    }
    const { run, adapter, plan } = await loadRun(runId, opts.permissions ?? []);

    const lines = await prisma.importRunLine.findMany({
      where: { importRunId: runId, rowNo: { in: opts.selectedRowNos } },
      orderBy: { rowNo: "asc" },
    });
    if (lines.length === 0) throw AppError.notFound("Seçilen satırlar bu koşumda bulunamadı");
    // ÇİFT GERİ SARMA: seçilenlerin HEPSİ geri sarılmışsa 409. Kısmi seçim meşrudur
    // (5 satır şimdi, 5 satır sonra) — o yüzden koşul "hepsi".
    if (lines.every((l) => l.revertedAt !== null)) {
      throw AppError.conflict("Seçilen satırlar zaten geri sarıldı.");
    }

    const skipped: Array<{ rowNo: number; reason: string }> = [];
    const auditEntries: RevertAuditEntry[] = [];
    let reverted = 0;
    for (const line of lines) {
      const out = await revertOneLine({ line, plan, adapter, reason, userId: opts.userId });
      if (out.skipReason) {
        skipped.push({ rowNo: line.rowNo, reason: out.skipReason });
        continue;
      }
      reverted++;
      if (out.audit) auditEntries.push(out.audit);
    }

    await stampRun(runId, reason, reverted, opts.userId);
    await AuditService.logMany(auditEntries);
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "IMPORT_REVERT",
      tableName: adapter.tableName,
      recordId: runId,
      payload: { runId, entity: run.entity, reverted, skipped: skipped.length, reason },
    });
    return { runId, reverted, skipped };
  }
}

function planCreate(row: RevertPlanRow, rec: Record<string, unknown>, mode: RevertMode): RevertPlanRow {
  if (mode === "CANCEL_DOCUMENT") {
    row.action = "CANCEL_DOCUMENT";
    if (rec.status === "CANCELLED") row.skipReason = "Belge zaten iptal edilmiş";
    return row;
  }
  if (mode === "DELETE_PIVOT") {
    row.action = "DELETE_PIVOT";
    // Müşteriye ÖZEL renk satırı import tarafından yaratılmış OLAMAZ (§8.2a).
    if (rec.assigned === true) row.skipReason = "Müşteriye özel atanmış satır — silinmez";
    return row;
  }
  row.action = "DEACTIVATE";
  if (rec.isActive === false) row.skipReason = "Kayıt zaten pasif";
  return row;
}

function planUpdate(row: RevertPlanRow): RevertPlanRow {
  row.action =
    row.fields.length > 0 ? "RESTORE_FIELDS" : row.children.length > 0 ? "RESTORE_CHILDREN" : "SKIP";
  if (row.action === "SKIP") row.skipReason = "Geri yazılacak alan yok";
  return row;
}

/** Koşum damgası: geri sarılmamış satır kalmadıysa koşum da damgalanır. */
async function stampRun(
  runId: string,
  reason: string,
  reverted: number,
  userId?: string,
): Promise<void> {
  const remaining = await prisma.importRunLine.count({ where: { importRunId: runId, revertedAt: null } });
  if (remaining === 0) {
    await prisma.importRun.updateMany({
      where: { id: runId, revertedAt: null },
      data: { revertedAt: new Date(), revertedById: userId ?? null, revertReason: reason },
    });
  } else if (reverted > 0) {
    // Kısmi geri sarma da gerekçesini bırakır; damga satırlar bitince konur.
    await prisma.importRun.updateMany({
      where: { id: runId, revertReason: null },
      data: { revertReason: reason },
    });
  }
}
