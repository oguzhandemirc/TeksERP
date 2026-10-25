// =============================================================================
// Şablonlu belgenin `/tables` dalı (plan §3.8, TX)
// =============================================================================
// Donmuş şablon sürümünün kalem tablosu bağları varsa Excel tabloları PDF'in bağlamından
// (`frozenTemplateContext`) ve bağdan kurulur; başlık satırları/dipnotlar Sistem payload'ından
// kalır (panel `doc-tables-export.ts` aynı biçimi okur). Bağ yoksa Sistem tabloları + uyarı.
// =============================================================================

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import type { DocTablesPayload } from "../document-render/doc-model";
import { docNum } from "../document-render/fmt-num";
import { EXCEL_DEFAULT_COLUMNS_WARNING, buildBoundTables, readColumnFilters, readTableBindings } from "./excel-tables";
import { frozenTemplateContext, type FrozenTemplateRef, type TemplatedPrintMeta, type TemplatedPrintRecord } from "./print-binding";
import { getContract } from "./sozlesme/kayit";

export interface TemplatedTablesInput {
  docType: string;
  snapshot: { template?: FrozenTemplateRef; docConfigOverride: unknown; numberRounding?: unknown } & Record<string, unknown>;
  meta: TemplatedPrintMeta;
  rec: TemplatedPrintRecord;
}

/** `system`: aynı snapshot'ın Sistem tabloları — başlık/dipnot kaynağı ve bağsız sürümün yedeği. */
export async function templatedTables(
  input: TemplatedTablesInput,
  system: DocTablesPayload,
): Promise<{ data: DocTablesPayload; warnings: string[] }> {
  const ref = input.snapshot.template;
  if (!ref) throw AppError.internal("Şablonsuz belge şablon tablo yolundan üretilemez.");
  const v = await prisma.documentTemplateVersion.findUnique({
    where: { id: ref.versionId },
    select: { tableBindings: true, sourceHtml: true, internalFields: true },
  });
  if (!v) throw AppError.internal(`Belgenin şablon sürümü bulunamadı (${ref.name} v${ref.versionNo}).`);
  const bindings = readTableBindings(v.tableBindings);
  const internalFields = Array.isArray(v.internalFields) ? (v.internalFields as string[]) : [];
  const tables = bindings.length
    ? buildBoundTables({
        contract: getContract(input.docType),
        context: frozenTemplateContext(input.docType, input.snapshot, { meta: input.meta, rec: input.rec, internalFields }),
        bindings,
        filters: readColumnFilters(v.sourceHtml),
        internalFields,
        num: docNum(input.snapshot),
      })
    : [];
  if (!tables.length) return { data: system, warnings: [EXCEL_DEFAULT_COLUMNS_WARNING] };
  return { data: { ...system, tables }, warnings: [] };
}
