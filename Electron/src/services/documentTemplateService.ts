// =============================================================================
// Belge tasarımcısı şablonları — client servisi (backend /api/document-templates)
// =============================================================================
// Varsayılan şablon seçicisi (T1C) + tasarımcının sözleşme/sistem okuması (T3) +
// liste, sürüm, yayın, atama ve arşiv/silme uçları (T5).

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { ContractView } from "@/pages/Definitions/DocumentDesigner/binding/contract";

export interface TemplateContractView {
  docType: string;
  hedef?: "musteri" | "ic";
  contractVersion?: number;
  copyable?: boolean;
}

/** `GET /system/:docType` — Sistem eşleniği + kopya anında dondurulacak etkin ayar (P-d). */
export interface SystemTemplateView {
  docType: string;
  copyable: boolean;
  /** Sistem tasarımının Liquid eşleniği (etkin ayarla üretilmiş); eşleniksiz türde null. */
  equivalent: { editMode: "VISUAL" | "CODE"; html: string; css: string; pageSettings: Record<string, unknown> } | null;
  settings: Record<string, unknown>;
  internalFields: string[];
  warnings: string[];
}

export type TemplateStatus = "ACTIVE" | "ARCHIVED";
export type TemplateEditMode = "VISUAL" | "CODE";

export interface DocumentTemplateRow {
  id: string;
  docType: string;
  name: string;
  description?: string | null;
  status: TemplateStatus;
  editMode?: TemplateEditMode;
  copiedFrom?: string | null;
  publishedVersionId: string | null;
  latestVersionNo?: number;
  archivedAt?: string | null;
  updatedAt?: string;
  publishedVersion: { versionNo: number; publishedAt: string | null } | null;
}

/** `GET /:id/versions` satırı — içerik yok; yazan/yayınlayan adı sunucudan. */
export interface TemplateVersionSummary {
  id: string;
  templateId: string;
  versionNo: number;
  editMode: TemplateEditMode;
  note: string | null;
  contentHash: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  publishedAt: string | null;
  publishedById: string | null;
  publishedByName: string | null;
  isPublished: boolean;
}

/** `GET /:id/versions/:vid` — değişmez sürümün tam içeriği. */
export interface TemplateVersionFull extends Omit<TemplateVersionSummary, "isPublished" | "createdByName" | "publishedByName"> {
  sourceHtml: string;
  css: string;
  pageSettings: Record<string, unknown>;
  tableBindings: Record<string, unknown>;
  settings: Record<string, unknown>;
  internalFields: string[];
  projectData: unknown;
}

export interface TemplateBrief {
  id: string;
  name: string;
  docType: string;
  status: TemplateStatus;
  publishedVersionId: string | null;
}

export interface AffectedParty {
  id: string;
  name: string;
}

export interface ProfileAssignmentRow {
  docType: string;
  template: TemplateBrief;
  profile: { id: string; name: string; isActive: boolean };
  affected: { customers: AffectedParty[]; subcontractors: AffectedParty[] };
}

/** Atama ızgarasının satırları: her profil + etkilediği müşteri/fasoncu + config ezmesi var mı. */
export interface ProfileCatalogRow {
  id: string;
  name: string;
  isActive: boolean;
  /** Ezme yapılan belge anahtarları (`documentsConfig` anahtarı). */
  overrideKeys: string[];
  affected: { customers: AffectedParty[]; subcontractors: AffectedParty[] };
}

export interface TemplateAssignments {
  defaults: Array<{ docType: string; template: TemplateBrief }>;
  profiles?: ProfileAssignmentRow[];
  profileCatalog?: ProfileCatalogRow[];
  note?: string;
}

export interface AssignmentRef {
  kind: "default" | "profile";
  docType: string;
  profileId: string | null;
  profileName: string | null;
}

export interface DeletePreview {
  template: { id: string; docType: string; name: string; status: TemplateStatus };
  versions: Array<{ id: string; versionNo: number; createdAt: string; publishedAt: string | null }>;
  assignments: AssignmentRef[];
  deletable: boolean;
  reason: string | null;
}

export type CopyFrom = { kind: "system" } | { kind: "template"; id: string } | { kind: "blank" };

export interface CreateTemplateResult {
  template: DocumentTemplateRow;
  warnings: string[];
}

export interface SaveVersionBody {
  baseVersionId: string;
  editMode: TemplateEditMode;
  sourceHtml: string;
  css: string;
  pageSettings: Record<string, unknown>;
  settings: Record<string, unknown>;
  internalFields: string[];
  tableBindings: Record<string, unknown>;
  note?: string | null;
  clientToken?: string;
}

export interface SaveVersionResult {
  created: boolean;
  version: TemplateVersionSummary;
  warnings: string[];
}

/** `POST /preview` gövdesi — kaydedilmemiş kaynak × örnek (plan §3.10). */
export interface TemplatePreviewRequest {
  docType: string;
  source: {
    editMode: "VISUAL" | "CODE";
    sourceHtml: string;
    css: string;
    pageSettings: Record<string, unknown>;
    settings: Record<string, unknown>;
    internalFields: string[];
  };
  sample: { kind: "senaryo"; key: string } | { kind: "kayit"; sourceId: string };
}

export interface TemplatePreviewResult {
  html: string;
  hatalar: Array<{ satir: number | null; sutun: number | null; mesaj: string }>;
  uyarilar: string[];
  kesilenler: string[];
  olcum: { ms: number; bayt: number };
}

export interface SampleSourceRow {
  id: string;
  sourceId: string;
  documentNo: string | null;
  version: number;
  createdAt: string;
}

/** Önizleme isteğinin üst süresi: aşılırsa son başarılı önizleme soluk gösterilir. */
export const PREVIEW_TIMEOUT_MS = 20_000;

const base = "/api/document-templates";

export const documentTemplateService = {
  contracts: (): Promise<ApiResponse<TemplateContractView[]>> =>
    apiClient.get<ApiResponse<TemplateContractView[]>>(`${base}/contracts`).then((r) => r.data),

  contract: (docType: string): Promise<ApiResponse<ContractView>> =>
    apiClient.get<ApiResponse<ContractView>>(`${base}/contracts/${encodeURIComponent(docType)}`).then((r) => r.data),

  system: (docType: string): Promise<ApiResponse<SystemTemplateView>> =>
    apiClient.get<ApiResponse<SystemTemplateView>>(`${base}/system/${encodeURIComponent(docType)}`).then((r) => r.data),

  /** Liste ekranı: süzme SUNUCUDA (`status`, isteğe bağlı `docType`). */
  listAll: (filter: { status: TemplateStatus; docType?: string }): Promise<ApiResponse<DocumentTemplateRow[]>> =>
    apiClient.get<ApiResponse<DocumentTemplateRow[]>>(base, { params: filter }).then((r) => r.data),

  get: (id: string): Promise<ApiResponse<DocumentTemplateRow>> =>
    apiClient.get<ApiResponse<DocumentTemplateRow>>(`${base}/${id}`).then((r) => r.data),

  /** `clientToken` mantıksal deneme başına (lib/attemptToken); yalnız belirsiz hatada yapışır. */
  create: (body: { docType: string; name: string; copyFrom: CopyFrom; clientToken: string }): Promise<ApiResponse<CreateTemplateResult>> =>
    apiClient.post<ApiResponse<CreateTemplateResult>>(base, body, { suppressErrorToast: true }).then((r) => r.data),

  versions: (id: string): Promise<ApiResponse<TemplateVersionSummary[]>> =>
    apiClient.get<ApiResponse<TemplateVersionSummary[]>>(`${base}/${id}/versions`).then((r) => r.data),

  version: (id: string, vid: string): Promise<ApiResponse<TemplateVersionFull>> =>
    apiClient.get<ApiResponse<TemplateVersionFull>>(`${base}/${id}/versions/${vid}`).then((r) => r.data),

  saveVersion: (id: string, body: SaveVersionBody): Promise<ApiResponse<SaveVersionResult>> =>
    apiClient.post<ApiResponse<SaveVersionResult>>(`${base}/${id}/versions`, body, { suppressErrorToast: true }).then((r) => r.data),

  publish: (id: string, body: { versionId: string; expectedPublishedVersionId: string | null }): Promise<ApiResponse<DocumentTemplateRow>> =>
    apiClient.post<ApiResponse<DocumentTemplateRow>>(`${base}/${id}/publish`, body, { suppressErrorToast: true }).then((r) => r.data),

  archive: (id: string): Promise<ApiResponse<DocumentTemplateRow>> =>
    apiClient.post<ApiResponse<DocumentTemplateRow>>(`${base}/${id}/archive`, {}, { suppressErrorToast: true }).then((r) => r.data),

  unarchive: (id: string): Promise<ApiResponse<DocumentTemplateRow>> =>
    apiClient.post<ApiResponse<DocumentTemplateRow>>(`${base}/${id}/unarchive`, {}).then((r) => r.data),

  deletePreview: (id: string): Promise<ApiResponse<DeletePreview>> =>
    apiClient.get<ApiResponse<DeletePreview>>(`${base}/${id}/delete-preview`).then((r) => r.data),

  remove: (id: string): Promise<ApiResponse<{ id: string; deleted: boolean }>> =>
    apiClient.delete<ApiResponse<{ id: string; deleted: boolean }>>(`${base}/${id}`, { suppressErrorToast: true }).then((r) => r.data),

  /** `templateId: null` → profil ezmesi kaldırılır (tür varsayılanına düşer). */
  setProfile: (profileId: string, docType: string, templateId: string | null): Promise<ApiResponse<unknown>> =>
    apiClient.put<ApiResponse<unknown>>(`${base}/profiles/${profileId}/${docType}`, { templateId }).then((r) => r.data),

  list: (docType: string): Promise<ApiResponse<DocumentTemplateRow[]>> =>
    apiClient
      .get<ApiResponse<DocumentTemplateRow[]>>(base, { params: { docType, status: "ACTIVE" } })
      .then((r) => r.data),

  assignments: (): Promise<ApiResponse<TemplateAssignments>> =>
    apiClient.get<ApiResponse<TemplateAssignments>>(`${base}/assignments`).then((r) => r.data),

  /** Sistem (yerleşik) tasarımın örnek veriyle çıktısı; yerleşik çıktısı olmayan tür 409 `NO_SYSTEM_PREVIEW`. */
  systemPreview: (docType: string): Promise<ApiResponse<{ html: string }>> =>
    apiClient
      .post<ApiResponse<{ html: string }>>(`${base}/sistem-onizleme/${encodeURIComponent(docType)}`, {}, { timeout: PREVIEW_TIMEOUT_MS, suppressErrorToast: true })
      .then((r) => r.data),

  preview: (body: TemplatePreviewRequest, signal?: AbortSignal): Promise<ApiResponse<TemplatePreviewResult>> =>
    apiClient
      .post<ApiResponse<TemplatePreviewResult>>(`${base}/preview`, body, { signal, timeout: PREVIEW_TIMEOUT_MS, suppressErrorToast: true })
      .then((r) => r.data),

  sampleSources: (docType: string, q: string): Promise<ApiResponse<SampleSourceRow[]>> =>
    apiClient
      .get<ApiResponse<SampleSourceRow[]>>(`${base}/sample-sources/${encodeURIComponent(docType)}`, { params: q ? { q } : {}, suppressErrorToast: true })
      .then((r) => r.data),

  /** `templateId: null` → varsayılan kaldırılır (Sistem tasarımı). */
  setDefault: (docType: string, templateId: string | null): Promise<ApiResponse<unknown>> =>
    apiClient.put<ApiResponse<unknown>>(`${base}/defaults/${docType}`, { templateId }).then((r) => r.data),
};
