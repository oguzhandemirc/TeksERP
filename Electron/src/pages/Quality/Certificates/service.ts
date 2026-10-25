// K4P-SERT — sertifika uçları (`/api/certificates`) ve müşteri lab spesifikasyonu (`/api/customer-lab-specs`).
// Süzme SUNUCUDA; liste, cursor ve özet şeridi backend'de tek where'den doğar — panel yalnız parametre taşır.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export type CertificateHolder = "OWN" | "PARTNER";
export type CertificateStatusFilter = "active" | "expiring" | "expired" | "revoked" | "renewed" | "all";
type Ref = { id: string; code: string; name: string } | null;
type UserRef = { id: string; fullName: string } | null;
type CertLink = { id: string; certificateNo: string; expiresOn: string } | null;

export interface CertificateRow {
  id: string; holder: CertificateHolder; partnerId: string | null; standard: string; certificateNo: string;
  issuer: string | null; scope: string | null; issuedOn: string | null; expiresOn: string; note: string | null;
  renewsId: string | null; revokedAt: string | null; revokeReason: string | null; createdAt: string; updatedAt: string;
  partner: Ref; renews: CertLink; renewedBy: CertLink; fileCount: number; active: boolean; daysLeft: number;
}
export interface CertificateFileRow {
  id: string; fileName: string; mimeType: string; sizeBytes: number; sha256: string; createdAt: string; uploadedBy: UserRef;
}
export interface CertificateDetail extends CertificateRow { revokedBy: UserRef; createdBy: UserRef; files: CertificateFileRow[] }
export interface CertificateSummary { active: number; expiring: number; expired: number; revoked: number; days: number }
export interface CertificatePage { items: CertificateRow[]; nextCursor: string | null; summary: CertificateSummary }

export interface CertificateListParams {
  status?: CertificateStatusFilter; days?: number; holder?: CertificateHolder | ""; partnerId?: string; q?: string;
  cursor?: string | null; limit?: number;
}
export interface CertificateFields {
  holder: CertificateHolder; partnerId?: string | null; standard: string; certificateNo: string; issuer?: string | null;
  scope?: string | null; issuedOn?: string | null; expiresOn: string; note?: string | null;
}

export interface CustomerLabSpec {
  id: string; customerId: string; itemId: string | null; testTypeId: string; specMin: string | number | null; specMax: string | number | null;
  note: string | null; isActive: boolean; updatedAt: string;
  customer: { id: string; code: string; name: string }; item: Ref;
  testType: { id: string; code: string; name: string; unit: string | null; resultKind: string; scaleMax: number | null };
}
export interface CustomerLabSpecInput {
  customerId: string; itemId?: string | null; testTypeId: string; specMin?: number | null; specMax?: number | null; note?: string | null;
}

/** Boş parametreyi göndermez — sunucu boş metni "süzgeç yok" saymak zorunda kalmasın. */
function compact<T extends object>(p: T): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") out[k] = v as string | number;
  return out;
}

/** Dosyayı base64'e çevirir (veri URL'sinin başı atılır); tür denetimi sunucuda sihirli bayttan yapılır. */
export function readFileBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("Dosya okunamadı."));
    r.readAsDataURL(file);
  });
}

export const certificateService = {
  list: (p: CertificateListParams) =>
    apiClient.get<ApiResponse<CertificatePage>>("/api/certificates", { params: compact(p) }).then((r) => r.data.data),
  get: (id: string) => apiClient.get<ApiResponse<CertificateDetail>>(`/api/certificates/${id}`).then((r) => r.data.data),
  standards: () => apiClient.get<ApiResponse<string[]>>("/api/certificates/standards").then((r) => r.data.data),
  create: (body: CertificateFields & { clientToken: string }) =>
    apiClient.post<ApiResponse<CertificateDetail>>("/api/certificates", body).then((r) => r.data.data),
  update: (id: string, body: CertificateFields) =>
    apiClient.put<ApiResponse<CertificateDetail>>(`/api/certificates/${id}`, body).then((r) => r.data.data),
  renew: (id: string, body: CertificateFields & { clientToken: string }) =>
    apiClient.post<ApiResponse<CertificateDetail>>(`/api/certificates/${id}/renew`, body).then((r) => r.data.data),
  revokePreview: (id: string) =>
    apiClient.get<ApiResponse<{ certificate: CertificateDetail; fileCount: number }>>(`/api/certificates/${id}/revoke-preview`).then((r) => r.data.data),
  revoke: (id: string, reason: string) =>
    apiClient.post<ApiResponse<CertificateDetail>>(`/api/certificates/${id}/revoke`, { reason }).then((r) => r.data.data),
  uploadFile: (id: string, fileName: string, contentBase64: string) =>
    apiClient.post<ApiResponse<{ file: CertificateFileRow; duplicate: boolean }>>(`/api/certificates/${id}/files`, { fileName, contentBase64 }).then((r) => r.data.data),
  downloadFile: (id: string, fileId: string) =>
    apiClient.get<Blob>(`/api/certificates/${id}/files/${fileId}`, { responseType: "blob" }).then((r) => r.data),
  deleteFile: (id: string, fileId: string) => apiClient.delete(`/api/certificates/${id}/files/${fileId}`),
};

export const customerLabSpecService = {
  list: (p: { customerId?: string; itemId?: string; testTypeId?: string; includeInactive?: "0" | "1" }) =>
    apiClient.get<ApiResponse<CustomerLabSpec[]>>("/api/customer-lab-specs", { params: compact(p) }).then((r) => r.data.data),
  create: (body: CustomerLabSpecInput) => apiClient.post<ApiResponse<CustomerLabSpec>>("/api/customer-lab-specs", body).then((r) => r.data.data),
  update: (id: string, body: { specMin?: number | null; specMax?: number | null; note?: string | null; isActive?: boolean }) =>
    apiClient.put<ApiResponse<CustomerLabSpec>>(`/api/customer-lab-specs/${id}`, body).then((r) => r.data.data),
};
