import axios from "axios";
import apiClient from "@/services/apiClient";
import type {
  CreateTicketBody,
  ReplyBody,
  TicketListPage,
  TicketScope,
  TicketStatus,
  TicketView,
  UnreadCount,
} from "./types";

// ⚠️ Her destek isteği `suppressErrorToast` taşır: hata cümlesini ekran kendisi gösterir (`errors.ts`),
// yoklama ise hatayı sessizce yutar — destek merkezi düşükken panelde toast yağmuru OLMAZ.
const QUIET = { suppressErrorToast: true } as const;
/** Ekli istek: sunucu merkeze 60 sn bekler; istemci biraz daha uzun bekler ki sunucunun cevabını görsün. */
const UPLOAD_TIMEOUT_MS = 75_000;
const BADGE_TIMEOUT_MS = 8_000;

interface Envelope<T> {
  success: boolean;
  data: T;
}

export interface ListParams {
  scope: TicketScope;
  status?: TicketStatus[];
  page: number;
  limit: number;
}

export const destekService = {
  /** `firmaYoneticisi` sunucunun `scope=tenant` kararıdır; alan yoksa (eski backend) `false`. */
  async durum(): Promise<{ etkin: boolean; firmaYoneticisi: boolean }> {
    const r = await apiClient.get<Envelope<{ etkin: boolean; firmaYoneticisi?: boolean }>>("/api/etkili-destek/durum", QUIET);
    const etkin = r.data.data?.etkin === true;
    return { etkin, firmaYoneticisi: etkin && r.data.data?.firmaYoneticisi === true };
  },
  async list(p: ListParams): Promise<TicketListPage> {
    const params: Record<string, string | number> = { scope: p.scope, page: p.page, limit: p.limit };
    if (p.status && p.status.length > 0) params.status = p.status.join(",");
    const r = await apiClient.get<Envelope<TicketListPage>>("/api/etkili-destek/talepler", { ...QUIET, params });
    return r.data.data;
  },
  async detail(id: string): Promise<TicketView> {
    const r = await apiClient.get<Envelope<TicketView>>(`/api/etkili-destek/talepler/${id}`, QUIET);
    return r.data.data;
  },
  async create(body: CreateTicketBody): Promise<TicketView> {
    const r = await apiClient.post<Envelope<TicketView>>("/api/etkili-destek/talepler", body, {
      ...QUIET,
      timeout: UPLOAD_TIMEOUT_MS,
    });
    return r.data.data;
  },
  async reply(id: string, body: ReplyBody): Promise<TicketView> {
    const r = await apiClient.post<Envelope<TicketView>>(`/api/etkili-destek/talepler/${id}/mesajlar`, body, {
      ...QUIET,
      timeout: UPLOAD_TIMEOUT_MS,
    });
    return r.data.data;
  },
  async close(id: string): Promise<TicketView> {
    const r = await apiClient.post<Envelope<TicketView>>(`/api/etkili-destek/talepler/${id}/kapat`, undefined, QUIET);
    return r.data.data;
  },
  async markRead(id: string): Promise<void> {
    await apiClient.post(`/api/etkili-destek/talepler/${id}/okundu`, undefined, QUIET);
  },
  async unread(scope: TicketScope): Promise<UnreadCount> {
    const r = await apiClient.get<Envelope<UnreadCount>>("/api/etkili-destek/okunmamis", {
      ...QUIET,
      params: { scope },
      timeout: BADGE_TIMEOUT_MS,
    });
    return r.data.data;
  },
  async attachmentLink(id: string, variant: "original" | "thumb"): Promise<string> {
    const r = await apiClient.get<Envelope<{ url: string; expiresAt: string }>>(
      `/api/etkili-destek/ekler/${id}/baglanti`,
      { ...QUIET, params: { variant } },
    );
    return r.data.data.url;
  },
  /**
   * Ek baytları sunucu vekilinden (§5.10): CSP merkez alan adına izin vermediği için görsel `blob:` olarak
   * gösterilir. Hata gövdesi de blob gelir; `details.code` okunabilsin diye JSON'a çevrilip geri konur.
   */
  async attachmentContent(id: string, variant: "original" | "thumb"): Promise<Blob> {
    try {
      const r = await apiClient.get<Blob>(`/api/etkili-destek/ekler/${id}/icerik`, {
        ...QUIET,
        params: { variant },
        responseType: "blob",
        timeout: UPLOAD_TIMEOUT_MS,
      });
      return r.data;
    } catch (e) {
      await decodeBlobError(e);
      throw e;
    }
  },
};

async function decodeBlobError(e: unknown): Promise<void> {
  const res = axios.isAxiosError(e) ? e.response : undefined;
  if (!res || !(res.data instanceof Blob)) return;
  try {
    res.data = JSON.parse(await res.data.text()) as unknown;
  } catch {
    res.data = undefined;
  }
}
