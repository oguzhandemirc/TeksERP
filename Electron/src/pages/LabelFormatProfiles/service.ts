import { createCrudService } from "@/services/crudService";
import apiClient from "@/services/apiClient";
import type { LabelFormatProfile } from "./types";

const BASE = "/api/label-format-profiles";

export const labelFormatProfileService = {
  ...createCrudService<LabelFormatProfile>(BASE),

  /** Bu profili TOP etiketi sistem-varsayılanı yap (atomik; kartela etkilenmez). */
  setRollDefault: (id: string): Promise<unknown> =>
    apiClient.post(`${BASE}/${id}/set-roll-default`).then((r) => r.data),

  /** Örnek etiketin native komutu (PPLA/PPLB/ZPL) — yerel test baskısı için ham metin. */
  sampleNative: (id: string, language: string): Promise<string> =>
    apiClient
      .get<string>(`${BASE}/${id}/sample-native`, {
        params: { language },
        responseType: "text",
        transformResponse: [(d) => d],
      })
      .then((r) => r.data),
};
