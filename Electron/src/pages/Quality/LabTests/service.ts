// K4P-LAB — lab testi uçları (`/api/lab-tests`, `/api/lab-test-types`). Süzme SUNUCUDA; liste, cursor
// ve özet şeridi backend'de tek where'den doğar — panel yalnız parametre taşır.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export type LabResultKind = "NUMERIC" | "SCALE" | "PASS_FAIL";
export type LabTestStatus = "DRAFT" | "APPROVED" | "VOIDED";
export type LabVerdict = "PASS" | "FAIL";
type Dec = string | number | null;
type UserRef = { id: string; fullName: string } | null;

export interface LabTestType {
  id: string; code: string; name: string; method: string | null; resultKind: LabResultKind; scaleMax: number | null;
  unit: string | null; specMin: Dec; specMax: Dec; sortOrder: number; isActive: boolean;
}
export interface LabTestTypeInput {
  code: string; name: string; method?: string | null; resultKind: LabResultKind; scaleMax?: number | null;
  unit?: string | null; specMin?: number | null; specMax?: number | null; isActive?: boolean;
}
export interface LabPreset { code: string; name: string; method?: string | null; resultKind: LabResultKind; unit?: string | null; exists: boolean }

export interface LabTestListRow {
  id: string; testNo: string; testedOn: string | null; status: LabTestStatus; sampleCode: string | null; labName: string | null; createdAt: string;
  roll: { id: string; barcode: string | null } | null; batch: { id: string; batchNumber: string } | null;
  item: { id: string; code: string; name: string } | null; resultCount: number; hasFail: boolean;
  /** K4P-SERT — müşteri seçiliyse sonuç sınırı müşteri spesifikasyonundan gelir. Eski sunucuda yok. */
  customer?: { id: string; code: string; name: string } | null;
}
export interface LabSummary { total: number; draft: number; approved: number; voided: number; failing: number }
export interface LabTestPage { items: LabTestListRow[]; nextCursor: string | null; summary: LabSummary }

export interface LabResult {
  id: string; testTypeId: string; resultKind: LabResultKind; scaleMax: number | null; value: Dec; unit: string | null;
  specMin: Dec; specMax: Dec; verdict: LabVerdict; verdictSource: "AUTO" | "MANUAL"; note: string | null; updatedAt: string;
  testType: { code: string; name: string; method: string | null };
}
export interface LabTestDetail extends Omit<LabTestListRow, "resultCount" | "hasFail"> {
  rollId: string | null; batchId: string | null; itemId: string; note: string | null;
  approvedAt: string | null; voidedAt: string | null; voidReason: string | null;
  approvedBy: UserRef; voidedBy: UserRef; createdBy: UserRef; results: LabResult[];
}

export interface LabListParams {
  status?: LabTestStatus | ""; verdict?: LabVerdict | ""; testTypeId?: string; batchNo?: string; q?: string;
  from?: string; to?: string; forRollId?: string; batchId?: string; cursor?: string | null; limit?: number;
}
export interface LabCreateInput { clientToken: string; rollId?: string | null; batchId?: string | null; customerId?: string | null; sampleCode?: string | null; labName?: string | null; testedOn?: string | null; note?: string | null }
export interface LabResultInput { testTypeId: string; value: number | null; verdict?: LabVerdict | null; specMin?: number | null; specMax?: number | null; note?: string | null }

/** Boş parametreyi göndermez — sunucu boş metni "süzgeç yok" saymak zorunda kalmasın. */
function compact(p: LabListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") out[k] = v as string | number;
  return out;
}

export const labTestService = {
  list: (p: LabListParams) => apiClient.get<ApiResponse<LabTestPage>>("/api/lab-tests", { params: compact(p) }).then((r) => r.data.data),
  get: (id: string) => apiClient.get<ApiResponse<LabTestDetail>>(`/api/lab-tests/${id}`).then((r) => r.data.data),
  create: (body: LabCreateInput) => apiClient.post<ApiResponse<LabTestDetail>>("/api/lab-tests", body).then((r) => r.data.data),
  removeDraft: (id: string) => apiClient.delete(`/api/lab-tests/${id}`),
  saveResult: (id: string, body: LabResultInput) => apiClient.put<ApiResponse<LabTestDetail>>(`/api/lab-tests/${id}/results`, body).then((r) => r.data.data),
  deleteResult: (id: string, testTypeId: string) => apiClient.delete(`/api/lab-tests/${id}/results/${testTypeId}`),
  approve: (id: string) => apiClient.post<ApiResponse<LabTestDetail>>(`/api/lab-tests/${id}/approve`).then((r) => r.data.data),
  voidPreview: (id: string) =>
    apiClient.get<ApiResponse<{ test: LabTestDetail; resultCount: number; wasApproved: boolean }>>(`/api/lab-tests/${id}/void-preview`).then((r) => r.data.data),
  void: (id: string, reason: string) => apiClient.post<ApiResponse<LabTestDetail>>(`/api/lab-tests/${id}/void`, { reason }).then((r) => r.data.data),
};

export const labTestTypeService = {
  list: (activeOnly = false) =>
    apiClient.get<ApiResponse<LabTestType[]>>("/api/lab-test-types", { params: activeOnly ? { activeOnly: "1" } : {} }).then((r) => r.data.data),
  create: (body: LabTestTypeInput) => apiClient.post<ApiResponse<LabTestType>>("/api/lab-test-types", body).then((r) => r.data.data),
  update: (id: string, body: LabTestTypeInput) => apiClient.put<ApiResponse<LabTestType>>(`/api/lab-test-types/${id}`, body).then((r) => r.data.data),
  presets: () => apiClient.get<ApiResponse<LabPreset[]>>("/api/lab-test-types/presets").then((r) => r.data.data),
  addPresets: (codes: string[]) =>
    apiClient.post<ApiResponse<{ requested: number; created: number }>>("/api/lab-test-types/presets", { codes }).then((r) => r.data.data),
};
