// Tanıtma önizlemesi: gövdeye bağlı tazelik, yalnız EN SON isteğin yanıtı yazılır, rehberli kipte debounce'lu otomatik koşum (K30-T A2).
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "@/services/apiClient";
import { suggestTemplate } from "./service";
import type { SuggestBody, SuggestResult } from "./types";

export const PREVIEW_DEBOUNCE_MS = 400;

/** `autoReady`: otomatik önizleme koşabilir mi (rehberli kip + eksik yok + kayıt sürmüyor); tazelik/hata tekrarını hook ölçer. */
export function useTeachPreview(previewBody: SuggestBody | null, autoReady: boolean) {
  const bodyKey = previewBody ? JSON.stringify(previewBody) : "";
  const [preview, setPreview] = useState<{ key: string; result: SuggestResult } | null>(null);
  const [previewError, setPreviewError] = useState<{ key: string; text: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const seq = useRef(0);
  const fresh = Boolean(preview && preview.key === bodyKey);

  // Hızlı dokunuşta eski yanıt yenisini ezmesin: sıra numarası en sonuncuya aitse yazılır.
  const fetchPreview = useCallback(async (sent: SuggestBody): Promise<SuggestResult> => {
    const my = ++seq.current;
    const key = JSON.stringify(sent);
    setPreviewing(true);
    try {
      const result = await suggestTemplate(sent);
      if (my === seq.current) {
        setPreview({ key, result });
        setPreviewError(null);
      }
      return result;
    } catch (e) {
      if (my === seq.current) setPreviewError({ key, text: apiErrorMessage(e, "Önizleme alınamadı.") });
      throw e;
    } finally {
      if (my === seq.current) setPreviewing(false);
    }
  }, []);

  const bodyRef = useRef(previewBody);
  bodyRef.current = previewBody;
  const shouldRun = autoReady && Boolean(previewBody) && !fresh && previewError?.key !== bodyKey;
  useEffect(() => {
    if (!shouldRun) return undefined;
    const t = setTimeout(() => {
      if (bodyRef.current) fetchPreview(bodyRef.current).catch(() => undefined);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [shouldRun, bodyKey, fetchPreview]);

  return {
    result: preview?.result ?? null,
    fresh,
    error: previewError && previewError.key === bodyKey ? previewError.text : null,
    previewing,
    fetchPreview,
  };
}
