import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { CreateSupportTicketBody, SupportStatus, SupportTicket } from "@/pages/System/Support/types";

const BASE = "/api/destek";
// Hata cümlesi çağıranda (`apiErrorText`) tek toast olarak basılır.
const QUIET = { suppressErrorToast: true } as const;

const data = <T,>(p: Promise<{ data: ApiResponse<T> }>): Promise<T> => p.then((r) => r.data.data);

export const supportService = {
  list: (durum?: SupportStatus): Promise<SupportTicket[]> =>
    data(apiClient.get<ApiResponse<SupportTicket[]>>(BASE, { ...QUIET, params: durum ? { durum } : {} })),
  detail: (id: string): Promise<SupportTicket> => data(apiClient.get<ApiResponse<SupportTicket>>(`${BASE}/${id}`, QUIET)),
  create: (body: CreateSupportTicketBody): Promise<SupportTicket> => data(apiClient.post<ApiResponse<SupportTicket>>(BASE, body, QUIET)),
};
