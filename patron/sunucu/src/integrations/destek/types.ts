/** Merkezin entegrasyon sözleşmesindeki tipler (tarihler ISO metni). */

export type TicketType = 'BUG' | 'QUESTION' | 'REQUEST';
export type TicketStatus = 'NEW' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ANSWERED' | 'CLOSED';

export interface DestekTenant {
  /** Ürün tarafındaki firma kimliği. */
  id: string;
  name: string;
}

export interface DestekUser {
  /** Ürün tarafındaki kullanıcı kimliği. */
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  /** Firma yöneticisi: firmanın bütün taleplerini görür ve yanıtlar. */
  isTenantAdmin?: boolean;
}

export interface DestekTicketContext {
  /** Ürün sürümü, ör. `"2.48.0"` (ekip panelinde "sürüm" olarak görünür). */
  productVersion?: string;
  /** `productVersion` için takma ad (eski ad); ikisi birden verilirse `productVersion` geçerlidir. */
  appVersion?: string;
  path?: string;
  screen?: string;
  relatedRecord?: { type: string; ref: string; url?: string };
  client?: { userAgent?: string; browser?: string; os?: string; device?: string; appVersion?: string; locale?: string };
  technical?: Record<string, unknown>;
}

/** Yüklenecek dosya (görsel ya da PDF, ≤ 10 MB, istek başına ≤ 5). */
export interface DestekFile {
  name: string;
  data: Uint8Array;
  contentType?: string;
}

/**
 * Ek. Görseller merkezde küçültülür (uzun kenar ≤ 1920 px, çoğunlukla WebP): `name`/`mime`/`size` saklanan dosyanın.
 * Talep kapandıktan sonra saklama süresi dolan ekin dosyası silinir; kayıt `deleted: true` ile yazışmada kalır
 * (ad ve boyut bilgi için), bağlantısı alınamaz (410 `ATTACHMENT_EXPIRED`).
 */
export interface DestekAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  /** Ayrı 320 px önizlemesi var mı (yoksa `variant: 'thumb'` asıl dosyayı verir). */
  hasThumb: boolean;
  deleted: boolean;
  deletedAt: string | null;
}

/** `thumb`: 320 px WebP önizleme (liste/yazışma için); `original` (varsayılan): asıl dosya. */
export type DestekAttachmentVariant = 'original' | 'thumb';

export interface DestekMessage {
  id: string;
  kind: 'CUSTOMER' | 'AGENT_REPLY' | 'SYSTEM';
  body: string;
  authorName: string | null;
  authorExternalUserId: string | null;
  createdAt: string;
  attachments: DestekAttachment[];
}

export interface DestekTicket {
  id: string;
  number: string;
  type: TicketType;
  status: TicketStatus;
  subject: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  messages: DestekMessage[];
}

export interface DestekTicketListItem {
  id: string;
  number: string;
  type: TicketType;
  status: TicketStatus;
  subject: string;
  requester: { id: string; name: string };
  unreadReplies: number;
  lastActivityAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DestekTicketList {
  items: DestekTicketListItem[];
  total: number;
  page: number;
  limit: number;
}

/** İstek başına seçenekler (her metodun son parametresi). */
export interface DestekRequestOptions {
  /**
   * Bu isteğin zaman aşımı (ms). Verilmezse dosyalı `createTicket`/`addMessage` için `uploadTimeoutMs`
   * (varsayılan 60 sn), diğerleri için `timeoutMs` (varsayılan 15 sn) kullanılır.
   */
  timeoutMs?: number;
}

/** GET uçlarında kimlik. */
export interface DestekIdentity {
  userId: string;
  tenantId?: string;
  isTenantAdmin?: boolean;
}

/** Var olan talep üzerinde işlem (yanıt, kapatma, okundu). */
export interface DestekCustomerAction {
  user: DestekUser;
  /** Firma yöneticisi başkasının talebinde işlem yapıyorsa zorunlu. */
  tenant?: DestekTenant;
}

export interface DestekPing {
  ok: true;
  installation: { id: string; name: string; code: string; environment: 'PROD' | 'TEST' };
  product: { code: string; name: string };
  serverTime: string;
}

export type DestekWebhookType = 'ticket.replied' | 'ticket.status_changed';

/** Panelden gönderilen deneme webhook'u ("Deneme webhook'u gönder"); talep verisi taşımaz, 2xx dönmek yeter. */
export interface DestekPingEvent {
  eventId: string;
  type: 'ping';
  occurredAt: string;
  installationId: string;
  data: { message: string };
}

export type DestekWebhookEvent = DestekTicketEvent | DestekPingEvent;

export interface DestekTicketEvent {
  eventId: string;
  type: DestekWebhookType;
  occurredAt: string;
  installationId: string;
  data: {
    ticketId: string;
    number: string;
    status: TicketStatus;
    subject: string;
    externalUserId: string;
    externalTenantId: string;
    lastMessage: { id: string; kind: 'CUSTOMER' | 'AGENT_REPLY'; authorName: string | null; excerpt: string; createdAt: string } | null;
    messageId?: string;
    previousStatus?: TicketStatus;
    by?: 'agent' | 'system';
  };
}
