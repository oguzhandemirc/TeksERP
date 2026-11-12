import { isAxiosError } from "axios";
import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { LabelKind } from "./labelTemplateService";

// Çoklu etiket seti (global + müşteri) sözleşmesinin panel tarafı TEK yerde.
// Plan: PLAN-coklu-etiket.md §4. Varsayılanın evi değişmez (LabelContextDefault /
// CustomerTemplateRoute); bu uçlar yalnız ek seçenekleri + yıldızı birlikte yazar.

/** İlk sürümde set yalnız top etiketlerinde (K2); sunucu diğerlerine 400 döner. */
export const OPTION_SET_KINDS = ["ROLL_RAW", "ROLL_FINISHED"] as const;
export type OptionSetKind = (typeof OPTION_SET_KINDS)[number];

export function isOptionSetKind(kind: LabelKind): kind is OptionSetKind {
  return (OPTION_SET_KINDS as readonly string[]).includes(kind);
}

export interface LabelOptionItem {
  templateId: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  active: boolean;
}

/** GET global-options yanıtı; varsayılan sette satırı olmasa da listenin başında gelir. */
export interface LabelOptionSetResponse {
  kind: OptionSetKind;
  defaultTemplateId: string | null;
  items: LabelOptionItem[];
}

export interface CustomerLabelOptionSetResponse extends LabelOptionSetResponse {
  showGlobalTemplates: boolean;
  /** Herkes için set — müşteri ekranında salt-okunur önizleme. */
  globalItems: LabelOptionItem[];
}

export interface LabelOptionSetBody {
  kind: OptionSetKind;
  /** Sıralı, tekrarsız, ≤20; `defaultTemplateId` ya null ya da bu listede. */
  templateIds: string[];
  defaultTemplateId: string | null;
}

export interface CustomerLabelOptionSetBody extends LabelOptionSetBody {
  showGlobalTemplates?: boolean;
}

/** Eski backend bu uçları tanımaz → 404; çağıran editörü sessizce gizler. */
export function isEndpointMissing(err: unknown): boolean {
  return isAxiosError(err) && err.response?.status === 404;
}

// GET'lerde genel toast bastırılır: 404 = eski backend (sessiz gizlenme), diğer
// hatalar editör içinde satır-içi gösterilir.
export const labelTemplateOptionService = {
  getGlobal: (kind: OptionSetKind): Promise<LabelOptionSetResponse> =>
    apiClient
      .get<ApiResponse<LabelOptionSetResponse>>(
        `/api/label-templates/global-options?kind=${encodeURIComponent(kind)}`,
        { suppressErrorToast: true },
      )
      .then((r) => r.data.data),

  setGlobal: (body: LabelOptionSetBody): Promise<void> =>
    apiClient.put("/api/label-templates/global-options", body).then(() => undefined),

  getCustomer: (customerId: string, kind: OptionSetKind): Promise<CustomerLabelOptionSetResponse> =>
    apiClient
      .get<ApiResponse<CustomerLabelOptionSetResponse>>(
        `/api/customers/${customerId}/label-template-options?kind=${encodeURIComponent(kind)}`,
        { suppressErrorToast: true },
      )
      .then((r) => r.data.data),

  setCustomer: (customerId: string, body: CustomerLabelOptionSetBody): Promise<void> =>
    apiClient
      .put(`/api/customers/${customerId}/label-template-options`, body)
      .then(() => undefined),
};
