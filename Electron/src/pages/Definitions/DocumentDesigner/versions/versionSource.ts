import type { TemplatePreviewRequest, TemplateVersionFull } from "@/services/documentTemplateService";

/** Değişmez sürüm → `POST /preview` gövdesi (yayın özeti ve karşılaştırma aynı kaynağı çizer). */
export function versionPreviewRequest(docType: string, v: TemplateVersionFull, senaryo: string): TemplatePreviewRequest {
  return {
    docType,
    source: {
      editMode: v.editMode,
      sourceHtml: v.sourceHtml,
      css: v.css,
      pageSettings: v.pageSettings ?? {},
      settings: v.settings ?? {},
      internalFields: Array.isArray(v.internalFields) ? v.internalFields : [],
    },
    sample: { kind: "senaryo", key: senaryo },
  };
}
