import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

export const LabelKind = {
  ROLL: "ROLL",
  SWATCH: "SWATCH",
  SHIPMENT_DOCKET: "SHIPMENT_DOCKET",
} as const;
export type LabelKind = (typeof LabelKind)[keyof typeof LabelKind];

export const labelKindLabels: Record<LabelKind, string> = {
  ROLL: "Top Etiketi",
  SWATCH: "Kartela Etiketi",
  SHIPMENT_DOCKET: "Sevkiyat İrsaliyesi",
};

export type FieldType = "text" | "number" | "date" | "qr" | "barcode" | "table";

export interface TemplateField {
  key: string;
  label: string;
  order: number;
  isVisible: boolean;
  isBold?: boolean;
  fontSize?: "sm" | "md" | "lg" | "xl";
}

export interface LabelTemplate {
  id: string;
  name: string;
  kind: LabelKind;
  isDefault: boolean;
  isActive: boolean;
  fields: TemplateField[];
  createdAt: string;
  updatedAt: string;
}

export interface CatalogField {
  key: string;
  defaultLabel: string;
  type: FieldType;
  required?: boolean;
}

export interface CatalogResponse {
  kind: LabelKind;
  fields: CatalogField[];
}

export const labelTemplateService = {
  list: (kind?: LabelKind): Promise<ApiResponse<LabelTemplate[]>> => {
    const q = kind ? `?kind=${kind}` : "";
    return apiClient
      .get<ApiResponse<LabelTemplate[]>>(`/api/label-templates${q}`)
      .then((r) => r.data);
  },

  getById: (id: string): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .get<ApiResponse<LabelTemplate>>(`/api/label-templates/${id}`)
      .then((r) => r.data),

  getCatalog: (kind: LabelKind): Promise<ApiResponse<CatalogResponse>> =>
    apiClient
      .get<ApiResponse<CatalogResponse>>(`/api/label-templates/catalog/${kind}`)
      .then((r) => r.data),

  create: (body: {
    name: string;
    kind: LabelKind;
    fields: TemplateField[];
    isDefault?: boolean;
  }): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .post<ApiResponse<LabelTemplate>>(`/api/label-templates`, body)
      .then((r) => r.data),

  update: (
    id: string,
    body: Partial<{
      name: string;
      fields: TemplateField[];
      isDefault: boolean;
      isActive: boolean;
    }>,
  ): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .patch<ApiResponse<LabelTemplate>>(`/api/label-templates/${id}`, body)
      .then((r) => r.data),

  setDefault: (id: string): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .post<ApiResponse<LabelTemplate>>(`/api/label-templates/${id}/set-default`)
      .then((r) => r.data),

  remove: (id: string): Promise<ApiResponse<void>> =>
    apiClient
      .delete<ApiResponse<void>>(`/api/label-templates/${id}`)
      .then((r) => r.data),
};
