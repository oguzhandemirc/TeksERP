import { useEffect, useMemo, useRef, useState } from "react";
import { apiErrorMessage } from "@/services/apiClient";
import { documentTemplateService, type TemplatePreviewRequest, type TemplatePreviewResult } from "@/services/documentTemplateService";
import type { ContractView } from "../binding/contract";
import type { DesignerSource } from "../code/useDesignerSource";
import type { DesignerDraft } from "../useDesignerDraft";
import { LatestRequestRunner, type RequestOutcome } from "./latestRequest";

export type PreviewStatus = "idle" | "loading" | "ok" | "error" | "timeout";
export type PreviewSample = TemplatePreviewRequest["sample"];

export interface PreviewState {
  status: PreviewStatus;
  /** Son cevap (hatalı derleme dahil — hata listesi buradan). */
  result: TemplatePreviewResult | null;
  /** Son BAŞARILI çizim; hata/zaman aşımında soluk gösterilir. */
  lastGood: TemplatePreviewResult | null;
  message: string | null;
}

export const PREVIEW_TIMEOUT_NOTE = "Önizleme zamanında gelmedi — son başarılı önizleme soluk gösteriliyor.";

export function isTimeoutError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "ECONNABORTED" || code === "ETIMEDOUT";
}

/** Durum geçişi (saf): yeni cevap son başarılıyı yalnız hatasız ve dolu HTML'de değiştirir. */
export function nextPreviewState(prev: PreviewState, o: RequestOutcome<TemplatePreviewResult>): PreviewState {
  if (o.kind === "ok") {
    const good = o.value.hatalar.length === 0 && o.value.html !== "";
    return { status: good ? "ok" : "error", result: o.value, lastGood: good ? o.value : prev.lastGood, message: null };
  }
  if (isTimeoutError(o.error)) return { ...prev, status: "timeout", message: PREVIEW_TIMEOUT_NOTE };
  return { ...prev, status: "error", result: null, message: apiErrorMessage(o.error, "Önizleme alınamadı") };
}

const INITIAL: PreviewState = { status: "idle", result: null, lastGood: null, message: null };

/** 400 ms debounce'lu canlı önizleme: yalnız son isteğin cevabı çizilir. İstemci Liquid ÇALIŞTIRMAZ. */
export function usePreview(enabled: boolean, request: TemplatePreviewRequest | null): PreviewState {
  const [state, setState] = useState<PreviewState>(INITIAL);
  const runner = useRef<LatestRequestRunner<TemplatePreviewRequest, TemplatePreviewResult> | null>(null);
  if (runner.current === null) {
    runner.current = new LatestRequestRunner(
      (body, signal) => documentTemplateService.preview(body, signal).then((r) => r.data),
      (o) => setState((prev) => nextPreviewState(prev, o)),
      () => setState((prev) => ({ ...prev, status: "loading" })),
    );
  }
  useEffect(() => () => runner.current?.dispose(), []);
  const key = request ? JSON.stringify(request) : null;
  useEffect(() => {
    if (!enabled || !request) return;
    runner.current?.schedule(request);
    // İstek gövdesi anahtarla izlenir (her çizimde yeni nesne gelir).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return state;
}

/** Seçili örnek: belge türü değişince sözleşmenin ilk senaryosuna döner. */
export function useSampleChoice(contract: ContractView | null): [PreviewSample | null, (s: PreviewSample) => void] {
  const [picked, setPicked] = useState<{ docType: string; sample: PreviewSample } | null>(null);
  const fallback = contract?.senaryolar[0] ? ({ kind: "senaryo", key: contract.senaryolar[0].ad } as const) : null;
  const sample = picked && contract && picked.docType === contract.docType ? picked.sample : fallback;
  return [sample, (s) => contract && setPicked({ docType: contract.docType, sample: s })];
}

/** Taslak + kaynak + örnek → `POST /preview` gövdesi. */
export function usePreviewRequest(draft: DesignerDraft, source: DesignerSource, sample: PreviewSample | null): TemplatePreviewRequest | null {
  return useMemo(() => {
    if (!draft.contract || !sample) return null;
    return {
      docType: draft.docType,
      source: {
        editMode: draft.editMode,
        sourceHtml: source.html,
        css: source.css,
        pageSettings: draft.pageSettings as unknown as Record<string, unknown>,
        settings: draft.settings,
        internalFields: draft.internalFields,
      },
      sample,
    };
  }, [draft.contract, draft.docType, draft.editMode, draft.pageSettings, draft.settings, draft.internalFields, source.html, source.css, sample]);
}

export function sampleLabel(contract: ContractView | null, sample: PreviewSample | null, recordNo?: string | null): string {
  if (!sample) return "Örnek yok";
  if (sample.kind === "kayit") return `Kayıt: ${recordNo ?? sample.sourceId.slice(0, 8)}`;
  const s = contract?.senaryolar.find((x) => x.ad === sample.key);
  return s ? s.aciklama || s.ad : sample.key;
}
