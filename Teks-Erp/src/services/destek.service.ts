// =============================================================================
// ETKİLİ DESTEK — talep (ticket) servisi
// =============================================================================
// Panel ve saha uygulaması merkeze doğrudan gitmez: bu servis kullanıcının
// isteğini OTURUMDAN kurduğu kimlikle imzalı olarak merkeze iletir (giden HTTPS).
// Fabrikaya gelen port açılmadığı için webhook yoktur; rozet `unread-count`
// yoklamasıyla gelir. Talepler merkezde durur — burada tablo yok.
//
// Kimlik istemciden ALINMAZ: `user.id` oturumun kullanıcı kimliği, ad DB'deki
// `fullName`, firma = lisans tesis kimliği (HAK `tesis.id`, küçük harf) + `company.name`; firma yöneticisi
// (`isTenantAdmin`) = `admin:settings` izni ya da sistem hesabı. Merkez erişilemezken
// hata yalnız bu uçları etkiler; fabrika yazma yolları bu servise hiç uğramaz.
// =============================================================================

import prisma from "../lib/prisma";
import { APP_VERSION } from "../lib/app-version";
import { matchesPermission } from "../middlewares/rbac.middleware";
import type {
  DestekAttachmentVariant,
  DestekTenant,
  DestekTicket,
  DestekTicketContext,
  DestekTicketList,
  DestekUser,
  TicketStatus,
  TicketType,
} from "../integrations/destek";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { readCompanyName } from "./system-setting.service";
import { uyari } from "../lib/logger";
import {
  SUPPORT_ALLOWED_TYPES,
  decodeAttachments,
  matchesSignature,
  type SupportFileInput,
  type SupportFileType,
} from "./helpers/destek-attachment.helper";
import {
  SUPPORT_BADGE_TIMEOUT_MS,
  SUPPORT_TIMEOUT_MS,
  SUPPORT_UPLOAD_TIMEOUT_MS,
  createSupportClient,
  downloadSupportFile,
  isSupportDownloadUrl,
  mapSupportError,
  readSupportDeskConfig,
  type SupportDeskConfig,
} from "./helpers/destek-transport.helper";

/** Firma geneli görünümü açan izin (yeni izin kodu açılmadı). */
export const SUPPORT_TENANT_ADMIN_PERMISSION = "admin:settings";
const AUDIT_TABLE = "destek_talepleri";
const MAX_CONTEXT_BYTES = 16 * 1024;

export interface SupportActor {
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly isSystemAccount: boolean;
}

export interface SupportClientMeta {
  readonly kind: string | null;
  readonly version: string | null;
}

export type SupportScope = "mine" | "tenant";

export interface SupportContextInput {
  screen?: string;
  path?: string;
  relatedRecord?: { type: string; ref: string; url?: string };
  client?: { userAgent?: string; browser?: string; os?: string; device?: string; appVersion?: string; locale?: string };
  technical?: Record<string, unknown>;
}

export interface OpenTicketInput {
  type: TicketType;
  subject: string;
  message: string;
  clientToken: string;
  context?: SupportContextInput;
  files?: SupportFileInput[];
}

export interface ListTicketsQuery {
  scope: SupportScope;
  status?: TicketStatus[];
  page?: number;
  limit?: number;
}

interface ResolvedIdentity {
  user: DestekUser;
  tenant: DestekTenant;
  isTenantAdmin: boolean;
}

function moduleDisabled(): AppError {
  return AppError.forbidden("Destek talebi özelliği bu kurulumda kapalı.", { code: "MODULE_DISABLED", modul: "destek" });
}

/** Etkin yapılandırma; yoksa 403 `MODULE_DISABLED` (route kapısının arkasında ikinci hat). */
function requireConfig(): SupportDeskConfig {
  const cfg = readSupportDeskConfig();
  if (!cfg) throw moduleDisabled();
  return cfg;
}

export function isTenantAdmin(actor: SupportActor): boolean {
  return actor.isSystemAccount || matchesPermission(actor.permissions, SUPPORT_TENANT_ADMIN_PERMISSION);
}

/**
 * Merkezdeki firma kimliği = lisans HAK'ındaki tesis kimliği (küçük harf; patron bulutu da aynı
 * değeri gönderir, panel ve patron talepleri tek firmada buluşur). Yoksa yapılandırma zaten null.
 */
function resolveTenantId(cfg: SupportDeskConfig): string {
  return cfg.tenantId;
}

async function resolveIdentity(actor: SupportActor, cfg: SupportDeskConfig): Promise<ResolvedIdentity> {
  const row = await prisma.user.findUnique({ where: { id: actor.userId }, select: { fullName: true, username: true } });
  if (!row) throw AppError.unauthorized("Kullanıcı bulunamadı. Tekrar giriş yapın.");
  const admin = isTenantAdmin(actor);
  const role = actor.isSystemAccount ? "Sistem hesabı" : admin ? "Yönetici" : "Kullanıcı";
  return {
    user: { id: actor.userId, name: (row.fullName.trim() || row.username).slice(0, 100), role, isTenantAdmin: admin },
    tenant: { id: resolveTenantId(cfg), name: (await readCompanyName()).slice(0, 200) },
    isTenantAdmin: admin,
  };
}

function identityQuery(id: ResolvedIdentity): { userId: string; tenantId: string; isTenantAdmin: boolean } {
  return { userId: id.user.id, tenantId: id.tenant.id, isTenantAdmin: id.isTenantAdmin };
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw mapSupportError(e);
  }
}

/** Kod satırı, metin değil: yükte mesaj ve dosya içeriği YOK. */
async function auditTicket(userId: string, action: "CREATE" | "UPDATE", t: DestekTicket, event: string): Promise<void> {
  await AuditService.log({
    userId,
    action,
    tableName: AUDIT_TABLE,
    recordId: t.id,
    newData: { code: t.number, type: t.type, status: t.status, event },
  });
}

/** Sunucunun eklediği bağlam: ürün sürümü + istemci türü/sürümü (başlıktan). IP gönderilmez. */
export function buildContext(input: SupportContextInput | undefined, meta: SupportClientMeta): DestekTicketContext {
  const client = { ...(input?.client ?? {}) };
  if (meta.version) client.appVersion = meta.version;
  const technical: Record<string, unknown> = { ...(input?.technical ?? {}) };
  if (meta.kind) technical.clientKind = meta.kind;
  const ctx: DestekTicketContext = {
    productVersion: APP_VERSION,
    ...(input?.screen ? { screen: input.screen } : {}),
    ...(input?.path ? { path: input.path } : {}),
    ...(input?.relatedRecord ? { relatedRecord: input.relatedRecord } : {}),
    ...(Object.keys(client).length ? { client } : {}),
    ...(Object.keys(technical).length ? { technical } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(ctx)) > MAX_CONTEXT_BYTES) {
    throw AppError.badRequest("Talep bağlam bilgisi çok büyük (en çok 16 KB).", { code: "CONTEXT_TOO_LARGE" });
  }
  return ctx;
}

/**
 * Kapalıyken yalnız `{ etkin:false }`. Açıkken `firmaYoneticisi` = sunucunun `scope=tenant`
 * kararıyla AYNI helper (`isTenantAdmin`): istemci kendi izin çıkarımını yapmaz.
 */
export function getSupportStatus(actor: SupportActor): ApiResponse<{ etkin: boolean; firmaYoneticisi?: boolean }> {
  if (readSupportDeskConfig() === null) return { success: true, data: { etkin: false } };
  return { success: true, data: { etkin: true, firmaYoneticisi: isTenantAdmin(actor) } };
}

export async function openTicket(
  actor: SupportActor,
  input: OpenTicketInput,
  meta: SupportClientMeta,
): Promise<ApiResponse<DestekTicket & { idempotentReplay: boolean }>> {
  const cfg = requireConfig();
  const files = decodeAttachments(input.files);
  const context = buildContext(input.context, meta);
  const id = await resolveIdentity(actor, cfg);
  const client = createSupportClient(cfg, files.length ? SUPPORT_UPLOAD_TIMEOUT_MS : SUPPORT_TIMEOUT_MS);
  const ticket = await call(() =>
    client.createTicket(
      { type: input.type, subject: input.subject, message: input.message, tenant: id.tenant, user: id.user, context, files },
      { idempotencyKey: input.clientToken },
    ),
  );
  // Tekrar (aynı clientToken) ikinci iz bırakmaz: talep ilk denemede açılmış ve izlenmişti.
  if (!ticket.idempotentReplay) await auditTicket(actor.userId, "CREATE", ticket, "TALEP_ACILDI");
  return { success: true, data: ticket };
}

export async function listTickets(actor: SupportActor, q: ListTicketsQuery): Promise<ApiResponse<DestekTicketList>> {
  const cfg = requireConfig();
  assertScope(actor, q.scope);
  const id = await resolveIdentity(actor, cfg);
  const client = createSupportClient(cfg, SUPPORT_TIMEOUT_MS);
  const data = await call(() =>
    client.listTickets({ ...identityQuery(id), scope: q.scope, status: q.status, page: q.page, limit: q.limit }),
  );
  return { success: true, data };
}

function assertScope(actor: SupportActor, scope: SupportScope): void {
  if (scope === "tenant" && !isTenantAdmin(actor)) {
    throw AppError.forbidden("Firmanın bütün talepleri yalnız yöneticilere açıktır.", { code: "FORBIDDEN" });
  }
}

export async function getTicket(actor: SupportActor, ticketId: string): Promise<ApiResponse<DestekTicket>> {
  const cfg = requireConfig();
  const id = await resolveIdentity(actor, cfg);
  const client = createSupportClient(cfg, SUPPORT_TIMEOUT_MS);
  return { success: true, data: await call(() => client.getTicket(ticketId, identityQuery(id))) };
}

export async function addMessage(
  actor: SupportActor,
  ticketId: string,
  input: { message: string; files?: SupportFileInput[] },
): Promise<ApiResponse<DestekTicket>> {
  const cfg = requireConfig();
  const files = decodeAttachments(input.files);
  const id = await resolveIdentity(actor, cfg);
  const client = createSupportClient(cfg, files.length ? SUPPORT_UPLOAD_TIMEOUT_MS : SUPPORT_TIMEOUT_MS);
  const ticket = await call(() =>
    client.addMessage(ticketId, { user: id.user, tenant: id.tenant, message: input.message, files }),
  );
  await auditTicket(actor.userId, "UPDATE", ticket, "YANIT_YAZILDI");
  return { success: true, data: ticket };
}

export async function closeTicket(actor: SupportActor, ticketId: string): Promise<ApiResponse<DestekTicket>> {
  const cfg = requireConfig();
  const id = await resolveIdentity(actor, cfg);
  const client = createSupportClient(cfg, SUPPORT_TIMEOUT_MS);
  const ticket = await call(() => client.closeTicket(ticketId, { user: id.user, tenant: id.tenant }));
  await auditTicket(actor.userId, "UPDATE", ticket, "TALEP_KAPATILDI");
  return { success: true, data: ticket };
}

export async function markRead(actor: SupportActor, ticketId: string): Promise<ApiResponse<{ lastReadAt: string }>> {
  const cfg = requireConfig();
  const id = await resolveIdentity(actor, cfg);
  const client = createSupportClient(cfg, SUPPORT_TIMEOUT_MS);
  return { success: true, data: await call(() => client.markRead(ticketId, { user: id.user, tenant: id.tenant })) };
}

export async function unreadCount(
  actor: SupportActor,
  scope: SupportScope,
): Promise<ApiResponse<{ count: number; tickets: number }>> {
  const cfg = requireConfig();
  assertScope(actor, scope);
  const id = await resolveIdentity(actor, cfg);
  const client = createSupportClient(cfg, SUPPORT_BADGE_TIMEOUT_MS);
  return { success: true, data: await call(() => client.unreadCount({ ...identityQuery(id), scope })) };
}

export async function attachmentLink(
  actor: SupportActor,
  attachmentId: string,
  variant: DestekAttachmentVariant,
): Promise<ApiResponse<{ url: string; expiresAt: string }>> {
  const cfg = requireConfig();
  const id = await resolveIdentity(actor, cfg);
  const client = createSupportClient(cfg, SUPPORT_TIMEOUT_MS);
  return { success: true, data: await call(() => client.getAttachmentLink(attachmentId, identityQuery(id), { variant })) };
}

export interface SupportAttachmentContent {
  readonly contentType: SupportFileType;
  readonly disposition: "inline" | "attachment";
  readonly body: Buffer;
}

function badAttachment(merkezKodu: string): AppError {
  uyari("destek", `ek içeriği reddedildi: ${merkezKodu}`);
  return new AppError("Ek dosyası destek merkezinden beklenen biçimde alınamadı.", 502, true, {
    code: "DESTEK_ULASILAMADI",
    merkezKodu,
  });
}

/**
 * Ek baytlarını oturumlu istemciye vekil olarak verir (panel CSP'si merkez alan adına
 * izin vermez). Bağlantı merkezden alınır, YALNIZ merkezin kökeninden indirilir
 * (SSRF kapısı), tür izinli listede olmalı ve ilk baytlar türle uyuşmalı.
 */
export async function attachmentContent(
  actor: SupportActor,
  attachmentId: string,
  variant: DestekAttachmentVariant,
): Promise<SupportAttachmentContent> {
  const cfg = requireConfig();
  const link = (await attachmentLink(actor, attachmentId, variant)).data;
  const target = isSupportDownloadUrl(cfg, link.url);
  if (!target) throw badAttachment("FOREIGN_HOST");
  const res = await downloadSupportFile(target, SUPPORT_UPLOAD_TIMEOUT_MS);
  if (res.status === 410) {
    throw new AppError("Ek süresi dolduğu için silindi.", 410, true, { code: "ATTACHMENT_EXPIRED" });
  }
  if (res.status === 404) throw AppError.notFound("Ek bulunamadı.", { code: "NOT_FOUND" });
  if (res.status !== 200) throw badAttachment(`HTTP_${res.status}`);
  const type = SUPPORT_ALLOWED_TYPES.find((t) => t === res.contentType);
  if (!type || !matchesSignature(type, res.body)) throw badAttachment("MIME_NOT_ALLOWED");
  return { contentType: type, disposition: type === "application/pdf" ? "attachment" : "inline", body: res.body };
}
