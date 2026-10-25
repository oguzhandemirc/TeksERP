import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DOC_DEF_MAP, DOC_TYPE_TO_KEY } from "@/services/documentConfig";
import { documentTemplateService } from "@/services/documentTemplateService";
import type { ContractView } from "./binding/contract";
import { applySettingsPatch, lockLanguage, type DocumentSettings } from "./binding/docSettings";
import { DEFAULT_PAGE_SETTINGS, type PageSettings } from "./binding/pageSettings";

export const DEFAULT_DOC_TYPE = "SHIPMENT_DISPATCH";

export function docTypeLabel(docType: string): string {
  const key = DOC_TYPE_TO_KEY[docType];
  return (key && DOC_DEF_MAP[key]?.label) || docType;
}

/**
 * Tasarımcının kayıt dışı taslağı: belge türü, sayfa ayarı, dondurulmuş `ayar` ve iç
 * alan opt-in'leri. Kayıt (yeni sürüm) T5'in işi; burada değişiklik yalnız "taslak"
 * rozetine düşer. Yeni tür seçilince ayar `GET /system/:docType`in etkin ayarıyla dolar.
 */
export function useDesignerDraft() {
  const [docType, setDocType] = useState(DEFAULT_DOC_TYPE);
  const [pageSettings, setPageSettingsState] = useState<PageSettings>(DEFAULT_PAGE_SETTINGS);
  const [settings, setSettings] = useState<DocumentSettings>({ language: "tr" });
  const [internalFields, setInternalFields] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  const contractsQ = useQuery({ queryKey: ["document-templates", "contracts"], queryFn: () => documentTemplateService.contracts() });
  const contractQ = useQuery({ queryKey: ["document-templates", "contract", docType], queryFn: () => documentTemplateService.contract(docType) });
  const systemQ = useQuery({ queryKey: ["document-templates", "system", docType], queryFn: () => documentTemplateService.system(docType) });

  const system = systemQ.data?.data;
  useEffect(() => {
    if (!system) return;
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
    }),
    [docType, contractsQ.data, contract, contractQ.isLoading, contractQ.isError, system, pageSettings, settings, internalFields, dirty, touch],
  );
}

export type DesignerDraft = ReturnType<typeof useDesignerDraft>;
