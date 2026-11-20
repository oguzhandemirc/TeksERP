import { randomUUID } from 'node:crypto';
import { DestekApiError } from './errors';
import { multipartBodyHash, sha256Hex, signRequest } from './signature';
import type {
  DestekAttachmentVariant,
  DestekCustomerAction,
  DestekFile,
  DestekIdentity,
  DestekPing,
  DestekRequestOptions,
  DestekTenant,
  DestekTicket,
  DestekTicketContext,
  DestekTicketList,
  DestekUser,
  TicketStatus,
  TicketType,
} from './types';

export interface DestekClientOptions {
  /** Entegrasyon API'sinin taban adresi, ör. `https://destek.etkiliyazilim.com/api/v1/integration`. */
  baseUrl: string;
  /** Kurulum API anahtarı (`dst_live_…`). Yalnız sunucuda tutulur; tarayıcıya/mobile verilmez. */
  apiKey: string;
  /** İstek zaman aşımı (ms), varsayılan 15 sn. İstek başına `options.timeoutMs` ile değiştirilebilir. */
  timeoutMs?: number;
  /** Dosyalı `createTicket`/`addMessage` zaman aşımı (ms), varsayılan 60 sn (yükleme + görsel küçültme sürer). */
  uploadTimeoutMs?: number;
  /** Testler için fetch yerine geçen işlev. */
  fetch?: typeof fetch;
}

export interface CreateTicketInput {
  type: TicketType;
  subject: string;
  message: string;
  tenant: DestekTenant;
  user: DestekUser;
  context?: DestekTicketContext;
  files?: DestekFile[];
}

export interface ListTicketsInput extends DestekIdentity {
  /** `mine` (varsayılan) ya da `tenant` (yalnız `isTenantAdmin: true` + `tenantId`). */
  scope?: 'mine' | 'tenant';
  status?: TicketStatus | TicketStatus[];
  page?: number;
  limit?: number;
}

interface RequestSpec {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  /** Multipart: `payload` (JSON) + dosyalar. */
  multipart?: { payload: unknown; files: DestekFile[] };
  headers?: Record<string, string>;
  /** Bu isteğin zaman aşımı (ms); yoksa istemcinin varsayılanı (multipart'ta `uploadTimeoutMs`). */
  timeoutMs?: number;
}

/** Rozet sorgusu: `scope: 'tenant'` firmanın bütün talepleri (yalnız `isTenantAdmin: true` + `tenantId`). */
export interface UnreadCountInput extends DestekIdentity {
  scope?: 'mine' | 'tenant';
}

/**
 * Etkili Destek entegrasyon istemcisi. Her isteği API anahtarı ve HMAC imzasıyla gönderir; hata yanıtında
 * `DestekApiError(code, status)` fırlatır. Her deneme yeni zaman damgasıyla imzalanır (aynı imza ikinci kez
 * kabul edilmez); talep açmayı yeniden denerken aynı `idempotencyKey` verilmelidir.
 */
export class DestekClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DestekClientOptions) {
    if (!options?.baseUrl) throw new Error('DestekClient: baseUrl gerekli.');
    if (!options.apiKey) throw new Error('DestekClient: apiKey gerekli.');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = assertTimeout(options.timeoutMs) ?? 15_000;
    this.uploadTimeoutMs = assertTimeout(options.uploadTimeoutMs) ?? 60_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Bağlantı ve imza testi. */
  async ping(options: DestekRequestOptions = {}): Promise<DestekPing> {
    return (await this.request<DestekPing>({ method: 'POST', path: '/ping', timeoutMs: options.timeoutMs })).body;
  }

  /**
   * Talep açar (dosya varsa multipart). `idempotencyKey` verilmezse rastgele üretilir; yeniden denemede aynısını
   * vermek için `idempotencyKey`'i kendiniz üretip saklayın (ör. form açıldığında bir UUID).
   */
  async createTicket(input: CreateTicketInput, options: DestekRequestOptions & { idempotencyKey?: string } = {}): Promise<DestekTicket & { idempotentReplay: boolean }> {
    const { files, ...payload } = input;
    const res = await this.request<DestekTicket>({
      method: 'POST',
      path: '/tickets',
      ...(files && files.length > 0 ? { multipart: { payload, files } } : { json: payload }),
      headers: { 'Idempotency-Key': options.idempotencyKey ?? randomUUID() },
      timeoutMs: options.timeoutMs,
    });
    return { ...res.body, idempotentReplay: res.headers.get('idempotent-replayed') === 'true' };
  }

  /** "Taleplerim" listesi. */
  async listTickets(input: ListTicketsInput, options: DestekRequestOptions = {}): Promise<DestekTicketList> {
    const status = Array.isArray(input.status) ? input.status.join(',') : input.status;
    return (
      await this.request<DestekTicketList>({
        method: 'GET',
        path: '/tickets',
        query: { ...identityQuery(input), scope: input.scope, status, page: input.page, limit: input.limit },
        timeoutMs: options.timeoutMs,
      })
    ).body;
  }

  /** Talep ayrıntısı ve yazışma (iç notlar hariç). */
  async getTicket(ticketId: string, identity: DestekIdentity, options: DestekRequestOptions = {}): Promise<DestekTicket> {
    return (
      await this.request<DestekTicket>({ method: 'GET', path: `/tickets/${encodeURIComponent(ticketId)}`, query: identityQuery(identity), timeoutMs: options.timeoutMs })
    ).body;
  }

  /** Müşteri yanıtı (+ dosyalar). Kapalı talep 14 gün içinde yeniden açılır; sonra `REOPEN_WINDOW_EXPIRED`. */
  async addMessage(
    ticketId: string,
    input: DestekCustomerAction & { message: string; files?: DestekFile[] },
    options: DestekRequestOptions = {},
  ): Promise<DestekTicket> {
    const { files, ...payload } = input;
    return (
      await this.request<DestekTicket>({
        method: 'POST',
        path: `/tickets/${encodeURIComponent(ticketId)}/messages`,
        ...(files && files.length > 0 ? { multipart: { payload, files } } : { json: payload }),
        timeoutMs: options.timeoutMs,
      })
    ).body;
  }

  /** Müşteri "çözüldü, kapat". */
  async closeTicket(ticketId: string, input: DestekCustomerAction, options: DestekRequestOptions = {}): Promise<DestekTicket> {
    return (
      await this.request<DestekTicket>({ method: 'POST', path: `/tickets/${encodeURIComponent(ticketId)}/close`, json: input, timeoutMs: options.timeoutMs })
    ).body;
  }

  /** Kullanıcı talebi okudu (okunmamış rozeti sıfırlanır). */
  async markRead(ticketId: string, input: DestekCustomerAction, options: DestekRequestOptions = {}): Promise<{ lastReadAt: string }> {
    return (
      await this.request<{ lastReadAt: string }>({ method: 'POST', path: `/tickets/${encodeURIComponent(ticketId)}/read`, json: input, timeoutMs: options.timeoutMs })
    ).body;
  }

  /**
   * Ekin 5 dk geçerli indirme adresi (kullanıcıya doğrudan verilebilir). `variant: 'thumb'` 320 px önizlemeyi verir.
   * Saklama süresi dolup dosyası silinen ekte `DestekApiError` (`ATTACHMENT_EXPIRED`, 410).
   */
  async getAttachmentLink(
    attachmentId: string,
    identity: DestekIdentity,
    options: DestekRequestOptions & { variant?: DestekAttachmentVariant } = {},
  ): Promise<{ url: string; expiresAt: string }> {
    const variant = options.variant && options.variant !== 'original' ? options.variant : undefined;
    return (
      await this.request<{ url: string; expiresAt: string }>({
        method: 'GET',
        path: `/attachments/${encodeURIComponent(attachmentId)}/link`,
        query: { ...identityQuery(identity), variant },
        timeoutMs: options.timeoutMs,
      })
    ).body;
  }

  /**
   * Rozet: okunmamış ekip yanıtı (`count`) ve bunların dağıldığı talep sayısı (`tickets`), isteği yapan kullanıcının
   * kendi okuma kaydına göre. `scope: 'tenant'` firmanın bütün taleplerini sayar (yalnız `isTenantAdmin: true` + `tenantId`).
   */
  async unreadCount(input: UnreadCountInput, options: DestekRequestOptions = {}): Promise<{ count: number; tickets: number }> {
    return (
      await this.request<{ count: number; tickets: number }>({
        method: 'GET',
        path: '/unread-count',
        query: { ...identityQuery(input), scope: input.scope },
        timeoutMs: options.timeoutMs,
      })
    ).body;
  }

  // ---------------------------------------------------------------- iç

  private async request<T>(spec: RequestSpec): Promise<{ status: number; headers: Headers; body: T }> {
    const url = new URL(this.baseUrl + spec.path);
    for (const [k, v] of Object.entries(spec.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { Accept: 'application/json', ...spec.headers };
    let body: string | FormData | undefined;
    let bodyHash: string;
    if (spec.multipart) {
      // JSON.stringify girintisiz: alan değerinde ham satır sonu olmaz (multipart CRLF dönüşümü imzayı bozmaz).
      const payload = JSON.stringify(spec.multipart.payload);
      const form = new FormData();
      form.append('payload', payload);
      for (const f of spec.multipart.files) {
        // TeksERP uyarlaması (TS 6 lib tipi): Blob, SharedArrayBuffer'lı görünümü kabul etmez; veri her zaman ArrayBuffer'lıdır.
        form.append('files', new Blob([f.data as Uint8Array<ArrayBuffer>], { type: f.contentType ?? 'application/octet-stream' }), f.name);
      }
      body = form;
      bodyHash = multipartBodyHash({ payload }, spec.multipart.files.map((f) => sha256Hex(f.data)));
    } else if (spec.json !== undefined) {
      body = JSON.stringify(spec.json);
      headers['Content-Type'] = 'application/json';
      bodyHash = sha256Hex(body);
    } else {
      bodyHash = sha256Hex('');
    }
    Object.assign(headers, { Authorization: `Bearer ${this.apiKey}` }, signRequest(this.apiKey, { method: spec.method, pathWithQuery: url.pathname + url.search, bodyHash }));

    const timeoutMs = assertTimeout(spec.timeoutMs) ?? (spec.multipart ? this.uploadTimeoutMs : this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: spec.method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timeout = (err as { name?: string })?.name === 'TimeoutError';
      throw new DestekApiError(timeout ? 'TIMEOUT' : 'NETWORK_ERROR', 0, timeout ? 'Destek merkezine istek zaman aşımına uğradı.' : 'Destek merkezine bağlanılamadı.');
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      const error = (parsed as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new DestekApiError(
        typeof error?.code === 'string' ? error.code : `HTTP_${res.status}`,
        res.status,
        typeof error?.message === 'string' ? error.message : `Destek merkezi HTTP ${res.status} döndü.`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return { status: res.status, headers: res.headers, body: parsed as T };
  }
}

/** Zaman aşımı pozitif sonlu sayı olmalı (0/NaN `AbortSignal.timeout`'ta isteği hemen keser ya da hata verir). */
function assertTimeout(ms: number | undefined): number | undefined {
  if (ms === undefined) return undefined;
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('DestekClient: timeoutMs pozitif bir sayı (ms) olmalı.');
  return ms;
}

function identityQuery(i: DestekIdentity): Record<string, string | undefined> {
  return { userId: i.userId, tenantId: i.tenantId, isTenantAdmin: i.isTenantAdmin ? 'true' : undefined };
}
