// =============================================================================
// KAYITLI RAPOR KOŞUSU — tanımı doğrular, bloklarını koşanın izniyle SIRAYLA çalıştırır (R1-KAYIT)
// =============================================================================
// Doğrulama her koşuda tekrarlanır (silinen ölçü → `isBroken` + 400); paylaşım veri yetkisi vermez.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { REPORT_BY_KEY } from "../constants/report-catalog";
import { factoryDateTimeTr } from "../constants/time";
import { checkReportDefinition, type ReportDefinitionBody } from "./reports/semantik/rapor-tanimi.schema";
import { resolveParams, runDefinitionBlocks, type BlockOutcome } from "./reports/semantik/definition-run";
import type { AccessContext } from "./reports/semantik/izin";
import type { RunOrigin } from "./reports/semantik/calistirici";
import { assertValidBody, brokenError, loadVisible, type Actor } from "./rapor-tanimi.service";
import { SYSTEM_TEMPLATE_BY_KEY } from "./reports/semantik/sistem-sablonlari";

export interface RunInput {
  parametreler: Record<string, unknown>;
  yenile: boolean;
  /** Önizleme: kaydedilmemiş gövde (oluşturucu); verilirse tanım okunmaz. */
  govde?: unknown;
}

export interface DefinitionRunResult {
  tanim: { id: string | null; ad: string; surumId: string | null; surumNo: number | null };
  baslik: string;
  itibariyla: string;
  itibariylaMetni: string;
  bloklar: BlockOutcome[];
  kisiAdi: boolean;
}

/** Bozukluk bayrağı doğrulamanın İZİDİR: değiştiyse atomik olarak çevrilir. */
async function markBroken(id: string, broken: boolean, a: Actor): Promise<void> {
  const n = await prisma.reportDefinition.updateMany({ where: { id, isBroken: !broken }, data: { isBroken: broken } });
  if (n.count) await AuditService.log({ userId: a.userId, action: "UPDATE", tableName: "REPORT_DEFINITION", recordId: id, oldData: { bozuk: !broken }, newData: { bozuk: broken } });
}

export async function runBody(
  body: ReportDefinitionBody,
  input: RunInput,
  ctx: AccessContext,
  source: { origin: RunOrigin | null; label: { id: string | null; ad: string; surumNo: number | null } },
): Promise<DefinitionRunResult> {
  const { origin, label } = source;
  const now = new Date();
  const params = resolveParams(body, input.parametreler, now);
  const blocks = await runDefinitionBlocks(body, params, ctx, { origin, refresh: input.yenile });
  return {
    tanim: { id: label.id, ad: label.ad, surumId: origin?.versionId ?? null, surumNo: label.surumNo },
    baslik: body.baslik,
    itibariyla: now.toISOString(),
    itibariylaMetni: factoryDateTimeTr(now),
    bloklar: blocks,
    kisiAdi: blocks.some((b) => b.durum === "tamam" && b.sonuclar.some((r) => r.kisiAdi)),
  };
}

/** Kayıtlı raporu çalıştırır: doğrulama HER koşuda (silinen ölçü → bozuk + 400), bloklar sırayla. */
export async function runDefinition(id: string, input: RunInput, ctx: AccessContext, a: Actor): Promise<DefinitionRunResult> {
  const row = await loadVisible(id, a);
  const template = row.kind === "SISTEM" && row.key ? SYSTEM_TEMPLATE_BY_KEY.get(row.key) : undefined;
  if (template) {
    // Şablon gövdesi koddadır; sürüm satırı yok → koşu tanıma bağlanır, sürüme bağlanmaz.
    const { body } = assertValidBody(template.govde);
    return runBody(body, input, ctx, { origin: { definitionId: id, versionId: null }, label: { id, ad: row.name, surumNo: null } });
  }
  if (row.kind === "SISTEM") {
    throw AppError.conflict("Sistem raporu kendi sayfasında çalışır.", { code: "RAPOR_SISTEM_TANIMI", panelYolu: row.key ? REPORT_BY_KEY.get(row.key)?.panelYolu ?? null : null });
  }
  if (!row.activeVersionId) throw brokenError([{ yol: "(kök)", mesaj: "Raporun yürürlükte sürümü yok." }]);
  const v = await prisma.reportDefinitionVersion.findUniqueOrThrow({ where: { id: row.activeVersionId }, select: { id: true, versionNo: true, body: true } });
  const check = checkReportDefinition(v.body);
  if (!check.gecerli) {
    await markBroken(id, true, a);
    throw brokenError(check.hatalar);
  }
  if (row.isBroken) await markBroken(id, false, a);
  return runBody(check.govde, input, ctx, { origin: { definitionId: id, versionId: v.id }, label: { id, ad: row.name, surumNo: v.versionNo } });
}

/** Oluşturucu önizlemesi: kaydedilmemiş gövde, koşu satırı tanıma bağlanmaz. */
export async function previewBody(raw: unknown, input: RunInput, ctx: AccessContext): Promise<DefinitionRunResult> {
  const { body } = assertValidBody(raw);
  return runBody(body, input, ctx, { origin: null, label: { id: null, ad: body.baslik, surumNo: null } });
}
