// Destek uç sözleşmesi tipleri — tek kaynak `docs/ops/DESTEK-ENTEGRASYONU.md` §5.

export type TicketType = "BUG" | "QUESTION" | "REQUEST";
export type TicketStatus = "NEW" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "ANSWERED" | "CLOSED";
export type MessageKind = "CUSTOMER" | "AGENT_REPLY" | "SYSTEM";
export type TicketScope = "mine" | "tenant";

export interface TicketAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  hasThumb: boolean;
  deleted: boolean;
  deletedAt: string | null;
}

export interface TicketMessage {
  id: string;
  kind: MessageKind;
  body: string;
  authorName: string | null;
  authorExternalUserId: string | null;
  createdAt: string;
  attachments: TicketAttachment[];
}

export interface TicketView {
  id: string;
  number: string;
  type: TicketType;
  status: TicketStatus;
  subject: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  messages: TicketMessage[];
  idempotentReplay?: boolean;
}

export interface TicketListItem {
  id: string;
  number: string;
  type: TicketType;
  status: TicketStatus;
  subject: string;
  requester: { id: string; name: string } | null;
  unreadReplies: number;
  lastActivityAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketListPage {
  items: TicketListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface UnreadCount {
  count: number;
  tickets: number;
}

/** Gönderime hazır ek (sözleşme §3: düz base64, `data:` öneki yok). */
export interface OutgoingFile {
  name: string;
  contentType: string;
  dataBase64: string;
}

export interface SupportContext {
  screen?: string;
  path?: string;
  client?: { userAgent?: string; os?: string; device?: string; locale?: string };
  technical?: Record<string, unknown>;
}

export interface CreateTicketBody {
  type: TicketType;
  subject: string;
  message: string;
  clientToken: string;
  context?: SupportContext;
  files?: OutgoingFile[];
}

export interface ReplyBody {
  message: string;
  files?: OutgoingFile[];
}
