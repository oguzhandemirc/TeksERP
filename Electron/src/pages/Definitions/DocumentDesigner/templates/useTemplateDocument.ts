import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Editor } from "grapesjs";
import { documentTemplateService, type SaveVersionBody, type TemplateVersionFull } from "@/services/documentTemplateService";
import { tableBindingsFromHtml } from "../binding/itemTable";
import { exportVisual } from "../code/useDesignerSource";
import type { DesignerDraft } from "../useDesignerDraft";
import { versionsQueryKey } from "../versions/VersionsSheet";

export const templateQueryKey = (id: string | null) => ["document-templates", "template", id] as const; // VersionsSheet ile aynı anahtar

/** Sürüm içeriği → editör: görsel kipte kanvasa, kod kipinde taslağın kod kaynağına. */
export function applyVersion(editor: Editor | null, draft: DesignerDraft, v: TemplateVersionFull, docType: string): void {
  // Kanvas ÖNCE: setComponents'in component:add olayları taslağı kirletir; hydrate SONRA kirli bayrağını düşürür.
  if (editor && v.editMode === "VISUAL") {
    editor.setComponents(v.sourceHtml);
    editor.setStyle(v.css);
  }
  draft.hydrate({
    docType,
    pageSettings: v.pageSettings ?? {},
    settings: v.settings ?? {},
    internalFields: Array.isArray(v.internalFields) ? v.internalFields : [],
    editMode: v.editMode,
    code: { html: v.sourceHtml, css: v.css },
  });
}

/** Editörün o anki kaynağı → `POST /:id/versions` gövdesi (kayıt anında dışa aktarılır). */
export function buildSaveBody(editor: Editor | null, draft: DesignerDraft, baseVersionId: string, note: string | null): SaveVersionBody {
  const src = draft.editMode === "CODE" || !editor ? draft.code : exportVisual(editor);
  return {
    baseVersionId,
    editMode: draft.editMode,
    sourceHtml: src.html,
    css: src.css,
    pageSettings: draft.pageSettings as unknown as Record<string, unknown>,
    settings: draft.settings,
    internalFields: draft.internalFields,
    tableBindings: tableBindingsFromHtml(src.html) as unknown as Record<string, unknown>,
    note: note?.trim() ? note.trim() : null,
  };
}

/**
 * Kayıtlı şablonu editöre bağlar: son sürümü BİR KEZ yükler; `baseVersionId` yüklenen/kaydedilen
 * sürümde kalır — başkası arada kaydederse sunucu 409 `TEMPLATE_VERSION_STALE` verir (sessiz ezme yok).
 */
export function useTemplateDocument(templateId: string | null, editor: Editor | null, draft: DesignerDraft) {
  const qc = useQueryClient();
  const [baseVersionId, setBase] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);
  const templateQ = useQuery({ queryKey: templateQueryKey(templateId), enabled: !!templateId, queryFn: () => documentTemplateService.get(templateId!) });
  const versionsQ = useQuery({ queryKey: versionsQueryKey(templateId ?? undefined), enabled: !!templateId, queryFn: () => documentTemplateService.versions(templateId!) });
  const template = templateQ.data?.data ?? null;
  const latest = versionsQ.data?.data[0] ?? null;

  const load = useCallback(
    async (versionId: string) => {
      if (!templateId || !template) return;
      const v = (await documentTemplateService.version(templateId, versionId)).data;
      applyVersion(editor, draft, v, template.docType);
      setBase(versionId);
    },
    [templateId, template, editor, draft],
  );

  useEffect(() => {
    // Görsel kip kanvası ister: editör hazır olmadan yükleme beklenir.
    if (!template || !latest || !editor || loaded.current === templateId) return;
    loaded.current = templateId;
    void load(latest.id);
  }, [template, latest, editor, templateId, load]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["document-templates"] }), [qc]);
  const baseVersion = versionsQ.data?.data.find((v) => v.id === baseVersionId) ?? null;
  return { template, versions: versionsQ.data?.data ?? [], baseVersionId, baseVersion, setBase, load, refresh, loading: templateQ.isLoading || versionsQ.isLoading };
}

export type TemplateDocument = ReturnType<typeof useTemplateDocument>;
