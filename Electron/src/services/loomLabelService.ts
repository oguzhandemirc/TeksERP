// =============================================================================
// TEZGAH (MACHINE) + LEVENT (WARP_BEAM) ETİKETİ — backend `routes/label.routes.ts`
// `/api/labels/machines/:id` · `/api/labels/warp-beams/:id` aynası (S1b)
// =============================================================================
// Baskı istemcide: `html?copies=N` → izole iframe (`printHtmlString`) → yazıcı;
// iz `print-event` YALNIZ kâğıt yolunda çağrılır (önizleme iz bırakmaz).
// =============================================================================
import type { AxiosResponseHeaders, RawAxiosResponseHeaders } from "axios";
import apiClient from "./apiClient";

export const LOOM_LABEL_COPIES_MIN = 1;
/** Backend `LABEL_BATCH_COPIES_MAX` (üstü 400 `LABEL_COPIES_RANGE`). */
export const LOOM_LABEL_COPIES_MAX = 200;

export type LoomLabelTarget = "machines" | "warp-beams";

/**
 * Metin istenen uçta hata gövdesi JSON gelir (şablon yok 400 `LABEL_TEMPLATE_MISSING`).
 * `responseType: "text"` onu ham dizi bırakırsa genel bildirim sunucunun cümlesi yerine
 * "Beklenmeyen bir hata" basar — JSON içerik tipi çözülür, HTML olduğu gibi kalır.
 */
export function htmlOrJsonBody(data: unknown, headers?: AxiosResponseHeaders | RawAxiosResponseHeaders): unknown {
  const type = String(headers?.["content-type"] ?? "");
  if (typeof data !== "string" || !type.includes("application/json")) return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

export const loomLabelService = {
  getHtml: (target: LoomLabelTarget, id: string, copies: number): Promise<string> =>
    apiClient
      .get<string>(`/api/labels/${target}/${id}/html`, {
        params: { copies },
        responseType: "text",
        headers: { Accept: "text/html" },
        transformResponse: [htmlOrJsonBody],
      })
      .then((r) => r.data),

  /** Baskı izi — çağıran sonucu kendisi söyler (`suppressErrorToast`; emsal `recordSackPrintEvent`). */
  recordPrint: (target: LoomLabelTarget, id: string, copies: number): Promise<unknown> =>
    apiClient
      .post(`/api/labels/${target}/${id}/print-event`, { copies }, { suppressErrorToast: true })
      .then((r) => r.data),
};

/** Adet girdisi → geçerli tam sayı ya da `null` (1–200 dışı, ondalık, boş). */
export function parseLabelCopies(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= LOOM_LABEL_COPIES_MIN && n <= LOOM_LABEL_COPIES_MAX ? n : null;
}
