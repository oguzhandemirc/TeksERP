// =============================================================================
// Destek (Etkili Destek talepleri) — fabrika backend'inin `/api/etkili-destek/*` uçları
// (`/api/destek` eski satıcı destek sisteminindir; karıştırılmaz).
// =============================================================================
// Sözleşme: docs/ops/DESTEK-ENTEGRASYONU-BULUT.md (fabrika sözleşmesi backend dilimindedir). Uygulama destek merkezine HİÇ
// gitmez ve anahtar görmez; yalnız kendi backend'ine mevcut oturumla konuşur.
// Yollar `/etkili-destek/...` biçimindedir: apiClient taban adresi zaten `/api` ile
// biter (bekçi `src/test/api-prefix.guard.test.ts`).
// =============================================================================

import { apiClient } from './api';

export type DestekTur = 'BUG' | 'QUESTION' | 'REQUEST';
export type DestekDurum = 'NEW' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ANSWERED' | 'CLOSED';
export type DestekScope = 'mine' | 'tenant';

/** `GET /etkili-destek/durum` özeti: özellik açık mı + sunucunun firma yöneticisi kararı. */
export interface DestekVisibility {
  etkin: boolean;
  firmaYoneticisi: boolean;
}

export interface DestekFile {
  name: string;
  contentType: 'image/png' | 'image/jpeg';
  /** Düz base64 (`data:` öneki YOK). */
  dataBase64: string;
}

export interface DestekBaglam {
  screen?: string;
  path?: string;
  client?: { os?: string; device?: string; appVersion?: string; locale?: string };
  technical?: Record<string, unknown>;
}

export interface CreateTicketBody {
  type: DestekTur;
  subject: string;
  message: string;
  clientToken: string;
  context?: DestekBaglam;
  files?: DestekFile[];
}

export interface DestekEk {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  hasThumb: boolean;
  deleted: boolean;
  deletedAt: string | null;
}

export interface DestekMesaj {
  id: string;
  kind: 'CUSTOMER' | 'AGENT_REPLY' | 'SYSTEM';
  body: string;
  authorName: string | null;
  createdAt: string;
  attachments: DestekEk[];
}

export interface DestekTalep {
  id: string;
  number: string;
  type: DestekTur;
  status: DestekDurum;
  subject: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  messages: DestekMesaj[];
  idempotentReplay?: boolean;
}

export interface DestekTicketRow {
  id: string;
  number: string;
  type: DestekTur;
  status: DestekDurum;
  subject: string;
  requester: { id: string; name: string } | null;
  unreadReplies: number;
  lastActivityAt: string;
  closedAt: string | null;
}

export interface DestekTicketPage {
  items: DestekTicketRow[];
  total: number;
  page: number;
  limit: number;
}

export interface DestekOkunmamis {
  count: number;
  tickets: number;
}

interface Zarf<T> {
  success: boolean;
  data: T;
}

/** Ekli istekte backend → merkez 60 sn bekler; istemci biraz daha uzun bekler. */
const EKLI_ISTEK_MS = 75_000;
/** Merkeze giden ekSİZ istekte backend 15 sn bekler. */
const DUZ_ISTEK_MS = 20_000;
/** Rozet: backend 5 sn'de keser; istemci kısa tutar, saha işini bekletmesin. */
const ROZET_MS = 8_000;

export const destekService = {
  /**
   * Özellik açık mı? Dış istek yapmaz; eski backend'de uç yoktur (404).
   * `firmaYoneticisi` sunucunun `scope=tenant` kararıdır (tek kaynak, sözleşme §5.1);
   * istemci izinden çıkarım YAPMAZ. Alan yoksa / özellik kapalıysa `false`.
   */
  async durum(): Promise<DestekVisibility> {
    const res = await apiClient.get<Zarf<{ etkin: boolean; firmaYoneticisi?: boolean }>>('/etkili-destek/durum');
    const etkin = res.data?.data?.etkin === true;
    return { etkin, firmaYoneticisi: etkin && res.data?.data?.firmaYoneticisi === true };
  },

  async talepAc(govde: CreateTicketBody): Promise<DestekTalep> {
    const res = await apiClient.post<Zarf<DestekTalep>>('/etkili-destek/talepler', govde, {
      timeout: govde.files && govde.files.length > 0 ? EKLI_ISTEK_MS : DUZ_ISTEK_MS,
    });
    return res.data.data;
  },

  async liste(p: { scope: DestekScope; page: number; limit?: number }): Promise<DestekTicketPage> {
    const res = await apiClient.get<Zarf<DestekTicketPage>>('/etkili-destek/talepler', {
      params: { scope: p.scope, page: p.page, limit: p.limit ?? 20 },
      timeout: DUZ_ISTEK_MS,
    });
    return res.data.data;
  },

  async detay(id: string): Promise<DestekTalep> {
    const res = await apiClient.get<Zarf<DestekTalep>>(`/etkili-destek/talepler/${id}`, {
      timeout: DUZ_ISTEK_MS,
    });
    return res.data.data;
  },

  async yanitYaz(id: string, message: string): Promise<DestekTalep> {
    const res = await apiClient.post<Zarf<DestekTalep>>(
      `/etkili-destek/talepler/${id}/mesajlar`,
      { message },
      { timeout: DUZ_ISTEK_MS },
    );
    return res.data.data;
  },

  async kapat(id: string): Promise<DestekTalep> {
    const res = await apiClient.post<Zarf<DestekTalep>>(`/etkili-destek/talepler/${id}/kapat`, undefined, {
      timeout: DUZ_ISTEK_MS,
    });
    return res.data.data;
  },

  async okundu(id: string): Promise<void> {
    await apiClient.post(`/etkili-destek/talepler/${id}/okundu`, undefined, { timeout: DUZ_ISTEK_MS });
  },

  async okunmamis(scope: DestekScope = 'mine'): Promise<DestekOkunmamis> {
    const res = await apiClient.get<Zarf<DestekOkunmamis>>('/etkili-destek/okunmamis', {
      params: { scope },
      timeout: ROZET_MS,
    });
    const d = res.data?.data;
    return { count: Number(d?.count) || 0, tickets: Number(d?.tickets) || 0 };
  },

  /** Ek bağlantısı (5 dk geçerli, oturum istemez). Silinmiş ek için ÇAĞRILMAZ. */
  async ekBaglanti(id: string, variant: 'original' | 'thumb'): Promise<string> {
    const res = await apiClient.get<Zarf<{ url: string; expiresAt: string }>>(
      `/etkili-destek/ekler/${id}/baglanti`,
      { params: { variant }, timeout: DUZ_ISTEK_MS },
    );
    return res.data.data.url;
  },
};
