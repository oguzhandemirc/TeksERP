// Top etiketi elle düzenleme — backend `roll-label-edit.service` sözleşmesinin istemci aynası.
// Kayıt yalnız GÖSTERİMDİR (ölçü/cari/katalog değişmez); sonraki her basım (panel + tablet) uygular.
import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

export interface RollLabelEditField {
  key: string;
  label: string;
  /** Ölçülen değer (metraj/kg/en): ezme yalnız etikette görünür. */
  measured: boolean;
  /** Topun kendi etiket kolonu (kumaş adı / renk / müşteri parti). */
  column: boolean;
  value: string;
  overridden: boolean;
}

export interface RollLabelEditTemplate {
  id: string;
  name: string;
  boundKeys: string[];
}

export interface RollLabelEditView {
  rollId: string;
  barcode: string | null;
  locked: { code: string; reason: string } | null;
  labelEditedAt: string | null;
  templateId: string | null;
  chainTemplateId: string | null;
  templates: RollLabelEditTemplate[];
  fields: RollLabelEditField[];
  customerId: string | null;
  customerName: string | null;
  ownerCustomerId: string | null;
  consigneeId: string | null;
}

/** Müşteri seçimi: kayıtlı cari ya da stok (müşterisiz). Serbest ad `fields.customerName` ezmesidir. */
export type RollLabelCustomerChoice = { customerId: string } | { stock: true };

export interface RollLabelEditDraft {
  /** undefined = dokunma · null = bir seferlik şablonu kaldır · id = bir seferlik şablon. */
  templateId?: string | null;
  /** anahtar yok = dokunma · null = kaynağa dön · metin = yaz. */
  fields: Record<string, string | null>;
  customer?: RollLabelCustomerChoice;
}

export interface LabelPreviewResult {
  mode: "svg" | "html" | "text";
  language: string;
  content: string;
  kind: string;
  /** Zarf notları (ör. müşteri barkodu yerine iç barkod) — önizlemenin altında satır içi gösterilir. */
  warnings?: string[];
}

export const rollLabelEditService = {
  getEditForm: (rollId: string, peripheralId?: string): Promise<RollLabelEditView> =>
    apiClient
      .get<ApiResponse<RollLabelEditView>>(`/api/labels/rolls/${rollId}/edit-form`, {
        params: peripheralId ? { peripheralId } : {},
      })
      .then((r) => r.data.data),

  /** Kaydetmeden önizleme — hiçbir şey yazmaz; kaydet ile aynı yama kuralı. */
  previewDraft: (
    rollId: string,
    draft: RollLabelEditDraft,
    opts: { confirmScrap?: boolean; peripheralId?: string },
  ): Promise<LabelPreviewResult> =>
    apiClient
      .post<ApiResponse<LabelPreviewResult>>(`/api/labels/rolls/${rollId}/preview`, {
        ...(draft.templateId !== undefined ? { templateId: draft.templateId } : {}),
        fields: draft.fields,
        ...(draft.customer && "customerId" in draft.customer ? { customerId: draft.customer.customerId } : {}),
        ...(draft.customer && "stock" in draft.customer ? { stock: true } : {}),
        ...(opts.confirmScrap ? { confirmScrap: true } : {}),
        ...(opts.peripheralId ? { peripheralId: opts.peripheralId } : {}),
      }, { serverWarnings: "handled" })
      // Yazarken çağrılır: not her tuşta tost olmasın, önizlemenin altında satır içi (DraftPreview).
      .then((r) => ({ ...r.data.data, warnings: r.data.warnings ?? [] })),

  /** Kaydet (basmaz). `expectedEditedAt` bayatsa 409 LABEL_EDIT_STALE; aynı yamanın tekrarı no-op. */
  save: (
    rollId: string,
    draft: RollLabelEditDraft,
    expectedEditedAt: string | null,
  ): Promise<RollLabelEditView & { changed: boolean }> =>
    apiClient
      .put<ApiResponse<RollLabelEditView & { changed: boolean }>>(`/api/labels/rolls/${rollId}/overrides`, {
        ...(draft.templateId !== undefined ? { templateId: draft.templateId } : {}),
        fields: draft.fields,
        ...(draft.customer ? { customer: draft.customer } : {}),
        expectedEditedAt,
      })
      .then((r) => r.data.data),
};
