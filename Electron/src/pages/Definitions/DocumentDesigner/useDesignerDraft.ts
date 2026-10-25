import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DOC_DEF_MAP, DOC_TYPE_TO_KEY } from "@/services/documentConfig";
import { documentTemplateService } from "@/services/documentTemplateService";
import type { ContractView } from "./binding/contract";
import { applySettingsPatch, lockLanguage, type DocumentSettings } from "./binding/docSettings";
import { DEFAULT_PAGE_SETTINGS, type PageSettings } from "./binding/pageSettings";
import type { EditMode } from "./code/editMode";

export const DEFAULT_DOC_TYPE = "SHIPMENT_DISPATCH";

/** Genel belge ayarında anahtarı olmayan, tasarımcıya canlı bağlı türler (P-e). */
const LIVE_DOC_LABELS: Record<string, string> = { TRAVELER_CARD: "Refakat Kartı", FREE_DOCUMENT: "Serbest Belge" };

export function docTypeLabel(docType: string): string {
  const key = DOC_TYPE_TO_KEY[docType];
  return (key && DOC_DEF_MAP[key]?.label) || LIVE_DOC_LABELS[docType] || docType;
}

/** Kayıtlı sürümden editöre yüklenen içerik (T5). */
export interface DraftSnapshot {
  docType: string;
  pageSettings: Record<string, unknown>;
  settings: Record<string, unknown>;
  internalFields: string[];
  editMode: EditMode;
  code: { html: string; css: string };
}

/**
 * Tasarımcının kayıt dışı taslağı: belge türü, sayfa ayarı, dondurulmuş `ayar` ve iç
 * alan opt-in'leri. Karalamada yeni tür seçilince ayar `GET /system/:docType`in etkin
 * ayarıyla dolar; kayıtlı şablonda (`hydrate`) ayar sürümden gelir ve ezilmez.
 */
export function useDesignerDraft() {
  const [docType, setDocType] = useState(DEFAULT_DOC_TYPE);
  const [pageSettings, setPageSettingsState] = useState<PageSettings>(DEFAULT_PAGE_SETTINGS);
  const [settings, setSettings] = useState<DocumentSettings>({ language: "tr" });
  const [internalFields, setInternalFields] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  // Kod kipinde kaynak burada yaşar; görsel kipte GrapesJS'tedir (plan §4, D7 `editMode`).
  const [editMode, setEditModeState] = useState<EditMode>("VISUAL");
  const [code, setCodeState] = useState<{ html: string; css: string }>({ html: "", css: "" });

  const contractsQ = useQuery({ queryKey: ["document-templates", "contracts"], queryFn: () => documentTemplateService.contracts() });
  const contractQ = useQuery({ queryKey: ["document-templates", "contract", docType], queryFn: () => documentTemplateService.contract(docType) });
  const systemQ = useQuery({ queryKey: ["document-templates", "system", docType], queryFn: () => documentTemplateService.system(docType) });

  const system = systemQ.data?.data;
  // Sürümden yüklenen türde Sistem'in etkin ayarı dondurulmuş `ayar`ı EZMEMELİ (P-d).
  const hydratedType = useRef<string | null>(null);
  useEffect(() => {
    if (!system || hydratedType.current === system.docType) return;
    setSettings(lockLanguage(system.settings ?? {}));
    setInternalFields(system.internalFields ?? []);
    setDirty(false);
  }, [system]);

  const contract: ContractView | null = contractQ.data?.data ?? null;
  const touch = useCallback(() => setDirty(true), []);

  return useMemo(
    () => ({
      docType,
      setDocType: (d: string) => setDocType(d),
      contracts: contractsQ.data?.data ?? [],
      contract,
      contractLoading: contractQ.isLoading,
      contractError: contractQ.isError,
      languageWarnings: system?.warnings ?? [],
      pageSettings,
      setPageSettings: (next: PageSettings) => {
        setPageSettingsState(next);
        touch();
      },
      settings,
      patchSettings: (patch: Record<string, unknown>) => {
        setSettings((s) => applySettingsPatch(s, patch));
        touch();
      },
      internalFields,
      openInternal: (code: string) => {
        setInternalFields((l) => (l.includes(code) ? l : [...l, code]));
        touch();
      },
      dirty,
      touch,
      /** Kayıtlı sürümün içeriği taslağa yazılır; kirli bayrağı düşer. */
      hydrate: (snap: DraftSnapshot) => {
        hydratedType.current = snap.docType;
        setDocType(snap.docType);
        setPageSettingsState({ ...DEFAULT_PAGE_SETTINGS, ...(snap.pageSettings as Partial<PageSettings>) });
        setSettings(lockLanguage(snap.settings));
        setInternalFields(snap.internalFields);
        setEditModeState(snap.editMode);
        setCodeState(snap.code);
        setDirty(false);
      },
      markSaved: () => setDirty(false),
      editMode,
      /** Kip geçişi: koda geçerken görsel kaynağın o anki hâli kod kaynağına kopyalanır. */
      setEditMode: (mode: EditMode, seed?: { html: string; css: string }) => {
        if (seed) setCodeState(seed);
        setEditModeState(mode);
        touch();
      },
      code,
      setCode: (patch: Partial<{ html: string; css: string }>) => {
        setCodeState((c) => ({ ...c, ...patch }));
        touch();
      },
    }),
    [docType, contractsQ.data, contract, contractQ.isLoading, contractQ.isError, system, pageSettings, settings, internalFields, dirty, touch, editMode, code],
  );
}

export type DesignerDraft = ReturnType<typeof useDesignerDraft>;
