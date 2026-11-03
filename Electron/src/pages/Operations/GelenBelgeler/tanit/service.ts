// Belge tipi tanıtma uçları (S1, izin `gelen-belge:template`) — yollar TAM (`/api/...`).
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { ScanWords, SuggestBody, SuggestResult, TemplateJson, UserTemplateDetail, UserTemplateView } from "./types";

const BASE = "/api/gelen-belge";
export const TEACH_QUERY_KEY = ["gelen-belge", "tanitma"] as const;
export const USER_TEMPLATES_QUERY_KEY = ["gelen-belge", "sablonlar", "ozel"] as const;

export async function getScanWords(scanId: string): Promise<ScanWords> {
  return (await apiClient.get<ApiResponse<ScanWords>>(`${BASE}/taramalar/${scanId}/kelimeler`)).data.data;
}

/** Öneri + aynı taramada önizleme; YAZMAZ. */
export async function suggestTemplate(body: SuggestBody): Promise<SuggestResult> {
  return (await apiClient.post<ApiResponse<SuggestResult>>(`${BASE}/sablonlar/oneri`, body)).data.data;
}

export async function listUserTemplates(): Promise<UserTemplateView[]> {
  return (await apiClient.get<ApiResponse<UserTemplateView[]>>(`${BASE}/sablonlar/ozel`)).data.data;
}

export async function getUserTemplate(code: string): Promise<UserTemplateDetail> {
  return (await apiClient.get<ApiResponse<UserTemplateDetail>>(`${BASE}/sablonlar/ozel/${encodeURIComponent(code)}`)).data.data;
}

/** Yeni belge tipi (kod addan `u-…`); `clientToken` mantıksal deneme başına. */
export async function createUserTemplate(body: { name: string; template: TemplateJson; clientToken: string }): Promise<UserTemplateView> {
  return (await apiClient.post<ApiResponse<UserTemplateView>>(`${BASE}/sablonlar/ozel`, body)).data.data;
}

/** Sürümlü güncelleme: araya giren kayıt → 409 USER_TEMPLATE_VERSION_CHANGED. */
export async function updateUserTemplate(code: string, body: { expectedVersion: number; template: TemplateJson; name?: string }): Promise<UserTemplateView> {
  return (await apiClient.put<ApiResponse<UserTemplateView>>(`${BASE}/sablonlar/ozel/${encodeURIComponent(code)}`, body)).data.data;
}
