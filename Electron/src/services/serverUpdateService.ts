import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { RecordUpdateApprovalInput, UpdateApprovalResult, UpdateStatus } from "@/types/server-update";

const BASE = "/api/guncelleme";

// Hata backend'in kendi cümlesiyle (409 nedenleri) TEK toast olarak çağıranda basılır (`apiErrorText`).
const QUIET = { suppressErrorToast: true } as const;

const data = <T,>(p: Promise<{ data: ApiResponse<T> }>): Promise<T> => p.then((r) => r.data.data);

/** Sunucu güncellemesi (Dağıtım v2): durum `license:view ∨ license:manage`, onay `license:manage`. */
export const serverUpdateService = {
  status: () => data(apiClient.get<ApiResponse<UpdateStatus>>(`${BASE}/durum`, QUIET)),
  approve: (input: RecordUpdateApprovalInput) => data(apiClient.post<ApiResponse<UpdateApprovalResult>>(`${BASE}/onay`, input, QUIET)),
};
