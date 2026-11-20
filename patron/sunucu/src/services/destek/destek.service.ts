// ETKİLİ DESTEK — patron uygulamasının talep (ticket) servisi. Uygulama merkeze doğrudan GİTMEZ: bu servis isteği
// OTURUMDAN kurduğu kimlikle imzalı olarak merkeze iletir; talepler merkezde durur, bulutta tablo/kopya YOK (bulut hesap
// yapmaz, yalnız aktarır). Fabrika karşılığı `Teks-Erp/src/services/destek.service.ts` (uç adları, gövdeler, kodlar aynı).
//
// Kimlik istemciden ALINMAZ: `user.id` = bulut hesabının kimliği = fabrika `users.id` (üyelik C1: hesap fabrikanın malı,
// `accounts.id` fabrika kullanıcısının UUID'sidir) → panelden açılan talep telefonda da "benim" görünür; ad oturumdaki
// hesap adı; firma = lisans tesis kimliği (`supportTenantId(tesisId)`, fabrikayla AYNI) + tesis adı. Patron kullanıcısı FİRMA YÖNETİCİSİDİR
// (`isTenantAdmin: true`, kullanıcı kararı 2026-11-15): firmanın bütün taleplerini görür ve yanıtlar.
// Ayak izi `account_audit`e (talep no / tür / durum; mesaj metni ve dosya YOK), tx dışında, best-effort.
import type { SessionContext } from "../../auth/session.service";
import type { DestekAttachmentVariant, DestekTenant, DestekTicket, DestekTicketContext, DestekTicketList, DestekUser, TicketStatus, TicketType } from "../../integrations/destek";
import { accountActor, recordAudit } from "../../lib/audit";
import { CloudError } from "../../lib/errors";
import { withTesis } from "../../lib/tenant";
import type { CloudContext } from "../context";
import { decodeAttachments, type SupportFileInput } from "./attachments";
import { supportTenantId, type SupportApiConfig } from "./config";
import { SUPPORT_BADGE_TIMEOUT_MS, SUPPORT_TIMEOUT_MS, SUPPORT_UPLOAD_TIMEOUT_MS, callCenter, createSupportClient } from "./transport";

const MAX_CONTEXT_BYTES = 16 * 1024;
/** Merkezde görünen rol (fabrikadaki yönetici rolüyle aynı ad). */
const PATRON_ROLE = "Yönetici";
const CLIENT_KIND = "patron";

export type SupportScope = "mine" | "tenant";

export interface SupportContextInput {
  readonly screen?: string;
  readonly path?: string;
  readonly relatedRecord?: { readonly type: string; readonly ref: string; readonly url?: string };
  readonly client?: { readonly userAgent?: string; readonly browser?: string; readonly os?: string; readonly device?: string; readonly appVersion?: string; readonly locale?: string };
  readonly technical?: Record<string, unknown>;
}

export interface OpenTicketInput {
  readonly type: TicketType;
  readonly subject: string;
  readonly message: string;
  readonly clientToken: string;
  readonly context?: SupportContextInput;
  readonly files?: readonly SupportFileInput[];
}

export interface ListTicketsQuery {
  readonly scope: SupportScope;
  readonly status?: TicketStatus[];
  readonly page?: number;
  readonly limit?: number;
}

const moduleDisabled = (): CloudError => new CloudError(403, "MODULE_DISABLED", "Destek talebi özelliği bu kurulumda kapalı.", { modul: "destek" });

/** Etkin yapılandırma; yoksa 403 `MODULE_DISABLED` ve merkeze istek GİTMEZ. */
function requireConfig(ctx: CloudContext): SupportApiConfig {
  const api = ctx.destek?.api ?? null;
  if (!api) throw moduleDisabled();
  return api;
}

function client(ctx: CloudContext, cfg: SupportApiConfig, timeoutMs: number) {
  return createSupportClient(cfg, timeoutMs, ctx.destek!.fetch);
}

/** Oturumdan merkez kullanıcısı (gövdedeki kimlik hiçbir yerde okunmaz). */
export function supportUser(s: SessionContext): DestekUser {
  return { id: s.accountId, name: (s.accountName.trim() || "Patron").slice(0, 100), role: PATRON_ROLE, isTenantAdmin: true };
}

const identityQuery = (s: SessionContext) => ({ userId: s.accountId, tenantId: supportTenantId(s.tesisId), isTenantAdmin: true });

/** Firma adı: fabrikanın `company.name` ayarı buluta gelmez → tesis adı (`tesis-ac --ad`). Ürün sürümü = son fabrika sürümü. */
async function facilityFacts(ctx: CloudContext, s: SessionContext): Promise<{ tenant: DestekTenant; productVersion: string | null }> {
  const r = await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => ({
    facility: await tx.facility.findUnique({ where: { tesisId: s.tesisId }, select: { name: true } }),
    state: await tx.syncState.findUnique({ where: { tesisId: s.tesisId }, select: { appVersion: true } }),
  }));
  return { tenant: { id: supportTenantId(s.tesisId), name: (r.facility?.name ?? "Tesis").slice(0, 200) }, productVersion: r.state?.appVersion ?? null };
}

/** Sunucunun eklediği bağlam: fabrika ürün sürümü + istemci türü. İstemcinin `productVersion`/`appVersion`ı yok sayılır. IP yok. */
export function buildContext(input: SupportContextInput | undefined, productVersion: string | null): DestekTicketContext {
  const technical: Record<string, unknown> = { ...(input?.technical ?? {}), clientKind: CLIENT_KIND };
  const ctx: DestekTicketContext = {
    ...(productVersion ? { productVersion } : {}),
    ...(input?.screen ? { screen: input.screen } : {}),
    ...(input?.path ? { path: input.path } : {}),
    ...(input?.relatedRecord ? { relatedRecord: input.relatedRecord } : {}),
    ...(input?.client && Object.keys(input.client).length ? { client: input.client } : {}),
    technical,
  };
  if (Buffer.byteLength(JSON.stringify(ctx)) > MAX_CONTEXT_BYTES) {
    throw new CloudError(400, "CONTEXT_TOO_LARGE", "Talep bağlam bilgisi çok büyük (en çok 16 KB).");
  }
  return ctx;
}

/** Ayak izi: kod satırı, metin değil (mesaj ve dosya YOK). */
async function auditTicket(ctx: CloudContext, s: SessionContext, t: DestekTicket, event: string): Promise<void> {
  await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event, entity: "DestekTalebi", entityId: String(t.id).slice(0, 80), summary: { kod: t.number, tur: t.type, durum: t.status } });
}

export function supportStatus(ctx: CloudContext): { etkin: boolean } {
  return { etkin: (ctx.destek?.api ?? null) !== null };
}

export async function openTicket(ctx: CloudContext, s: SessionContext, input: OpenTicketInput): Promise<DestekTicket & { idempotentReplay: boolean }> {
  const cfg = requireConfig(ctx);
  const files = decodeAttachments(input.files);
  const facts = await facilityFacts(ctx, s);
  const context = buildContext(input.context, facts.productVersion);
  const c = client(ctx, cfg, files.length ? SUPPORT_UPLOAD_TIMEOUT_MS : SUPPORT_TIMEOUT_MS);
  const ticket = await callCenter(() =>
    c.createTicket({ type: input.type, subject: input.subject, message: input.message, tenant: facts.tenant, user: supportUser(s), context, files }, { idempotencyKey: input.clientToken }),
  );
  // Tekrar (aynı clientToken) ikinci iz bırakmaz: talep ilk denemede açılmış ve izlenmişti.
  if (!ticket.idempotentReplay) await auditTicket(ctx, s, ticket, "DESTEK_TALEP_ACILDI");
  return ticket;
}

export async function listTickets(ctx: CloudContext, s: SessionContext, q: ListTicketsQuery): Promise<DestekTicketList> {
  const cfg = requireConfig(ctx);
  return callCenter(() => client(ctx, cfg, SUPPORT_TIMEOUT_MS).listTickets({ ...identityQuery(s), scope: q.scope, status: q.status, page: q.page, limit: q.limit }));
}

export async function getTicket(ctx: CloudContext, s: SessionContext, ticketId: string): Promise<DestekTicket> {
  const cfg = requireConfig(ctx);
  return callCenter(() => client(ctx, cfg, SUPPORT_TIMEOUT_MS).getTicket(ticketId, identityQuery(s)));
}

export async function addMessage(ctx: CloudContext, s: SessionContext, ticketId: string, input: { message: string; files?: readonly SupportFileInput[] }): Promise<DestekTicket> {
  const cfg = requireConfig(ctx);
  const files = decodeAttachments(input.files);
  const { tenant } = await facilityFacts(ctx, s);
  const c = client(ctx, cfg, files.length ? SUPPORT_UPLOAD_TIMEOUT_MS : SUPPORT_TIMEOUT_MS);
  const ticket = await callCenter(() => c.addMessage(ticketId, { user: supportUser(s), tenant, message: input.message, files }));
  await auditTicket(ctx, s, ticket, "DESTEK_YANIT_YAZILDI");
  return ticket;
}

export async function closeTicket(ctx: CloudContext, s: SessionContext, ticketId: string): Promise<DestekTicket> {
  const cfg = requireConfig(ctx);
  const { tenant } = await facilityFacts(ctx, s);
  const ticket = await callCenter(() => client(ctx, cfg, SUPPORT_TIMEOUT_MS).closeTicket(ticketId, { user: supportUser(s), tenant }));
  await auditTicket(ctx, s, ticket, "DESTEK_TALEP_KAPATILDI");
  return ticket;
}

export async function markRead(ctx: CloudContext, s: SessionContext, ticketId: string): Promise<{ lastReadAt: string }> {
  const cfg = requireConfig(ctx);
  const { tenant } = await facilityFacts(ctx, s);
  return callCenter(() => client(ctx, cfg, SUPPORT_TIMEOUT_MS).markRead(ticketId, { user: supportUser(s), tenant }));
}

export async function unreadCount(ctx: CloudContext, s: SessionContext, scope: SupportScope): Promise<{ count: number; tickets: number }> {
  const cfg = requireConfig(ctx);
  return callCenter(() => client(ctx, cfg, SUPPORT_BADGE_TIMEOUT_MS).unreadCount({ ...identityQuery(s), scope }));
}

export async function attachmentLink(ctx: CloudContext, s: SessionContext, attachmentId: string, variant: DestekAttachmentVariant): Promise<{ url: string; expiresAt: string }> {
  const cfg = requireConfig(ctx);
  return callCenter(() => client(ctx, cfg, SUPPORT_TIMEOUT_MS).getAttachmentLink(attachmentId, identityQuery(s), { variant }));
}
