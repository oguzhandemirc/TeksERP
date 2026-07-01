import { createCrudService } from "@/services/crudService";
import apiClient from "@/services/apiClient";
import type { LabelFormatProfile } from "./types";

const BASE = "/api/label-format-profiles";

export const labelFormatProfileService = {
  ...createCrudService<LabelFormatProfile>(BASE),

  /** Bu profili TOP etiketi sistem-varsayılanı yap (atomik; kartela etkilenmez). */
  setRollDefault: (id: string): Promise<unknown> =>
    apiClient.post(`${BASE}/${id}/set-roll-default`).then((r) => r.data),

  /** Örnek etiketin native komutu — kind: ROLL_RAW/ROLL_FINISHED/SWATCH (ham/bitmiş/kartela). */
  sampleNative: (id: string, language: string, kind: string): Promise<string> =>
    apiClient
      .get<string>(`${BASE}/${id}/sample-native`, {
        params: { language, kind },
        responseType: "text",
        transformResponse: [(d) => d],
      })
      .then((r) => r.data),

  /** Örnek etiket önizleme HTML'i (seçilen türde). */
  sampleHtml: (id: string, kind: string): Promise<string> =>
    apiClient
      .get<string>(`${BASE}/${id}/sample-html`, {
        params: { kind },
        responseType: "text",
        transformResponse: [(d) => d],
      })
      .then((r) => r.data),
};
