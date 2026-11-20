// ETKİLİ DESTEK uçları (`/api/destek/*`) — patron uygulaması → bulut → destek merkezi. Sözleşme
// `docs/ops/DESTEK-ENTEGRASYONU-BULUT.md`; uç adları/gövdeleri fabrikanınkiyle (`docs/ops/DESTEK-ENTEGRASYONU.md`) aynı.
// İzin kodu YOK: oturum açmış her patron hesabı firma yöneticisidir (kullanıcı kararı). `durum` kapalıyken de 200 döner;
// diğer her uç önce kapıdan geçer (kapalı → 403 `MODULE_DISABLED`, gövde okunmadan ve merkeze gitmeden).
// Gövde: genel 256 KB JSON sınırı YALNIZ ekli iki POST ucunda (talep aç · yanıt yaz) 70 MB'a çıkar ve aynı anda tek ekli
// istek okunur (api kapsayıcısı 512 MB; base64 JSON belleği ~1,4 × dosya). Webhook ucu tablo DIŞINDADIR (oturumsuz,
// HAM gövde): `app.ts` onu `/api` yönlendiricisinden ÖNCE bağlar.
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { CloudError, badRequest } from "../lib/errors";
import type { CloudContext } from "../services/context";
import { SUPPORT_MAX_BASE64_CHARS, SUPPORT_MAX_FILES } from "../services/destek/attachments";
import { addMessage, attachmentLink, closeTicket, getTicket, listTickets, markRead, openTicket, supportStatus, unreadCount } from "../services/destek/destek.service";
import { receiveWebhook } from "../services/destek/webhook.service";
import { body, param, s, type ApiCall, type ApiRouteDef } from "./api-route-kit";
import { readRawBody } from "./raw-body";
import { rateLimit } from "./rate-limit";

/** Ekli uçların gövde sınırı: 5 dosya × 10 MB, base64 (×4/3) + metin payı (fabrikayla aynı). */
export const SUPPORT_BODY_LIMIT = "70mb";
/** Aynı anda okunan ekli istek sayısı (bellek tavanı); aşan 429 `RATE_LIMITED` + Retry-After. */
export const SUPPORT_UPLOAD_CONCURRENCY = 1;
/** Webhook gövdesi (kılavuz: olay ≤ birkaç KB; `lastMessage.excerpt` ≤ 280 karakter). */
export const WEBHOOK_BODY_LIMIT = 256 * 1024;
export const WEBHOOK_PATH = "/api/destek/webhook";

const STATUSES = ["NEW", "IN_PROGRESS", "WAITING_CUSTOMER", "ANSWERED", "CLOSED"] as const;
const shortText = (max: number) => z.string().trim().max(max, `En çok ${max} karakter olabilir.`);
const FileBody = z.strictObject({
  name: z.string().min(1, "Dosya adı boş olamaz.").max(255, "Dosya adı çok uzun."),
  contentType: z.string().min(1, "Dosya türü gerekli.").max(100),
  dataBase64: z.string().min(1, "Dosya içeriği boş.").max(SUPPORT_MAX_BASE64_CHARS + 1024, "Dosya 10 MB sınırını aşıyor."),
});
const FilesBody = z.array(FileBody).max(SUPPORT_MAX_FILES, `En çok ${SUPPORT_MAX_FILES} dosya eklenebilir.`).optional();
const MessageText = z.string().trim().min(1, "Mesaj boş olamaz.").max(20_000, "Mesaj en çok 20.000 karakter olabilir.");
const ContextBody = z.strictObject({
  screen: shortText(200).optional(),
  path: shortText(500).optional(),
  relatedRecord: z.strictObject({ type: shortText(50), ref: shortText(100), url: shortText(500).optional() }).optional(),
  client: z
    .strictObject({ userAgent: shortText(500).optional(), browser: shortText(100).optional(), os: shortText(100).optional(), device: shortText(100).optional(), appVersion: shortText(50).optional(), locale: shortText(20).optional() })
    .optional(),
  technical: z.record(z.string(), z.unknown()).optional(),
  // İstemci gönderse de YOK SAYILIR: ürün sürümünü sunucu yazar.
  productVersion: z.string().optional(),
  appVersion: z.string().optional(),
});
const OpenBody = z.strictObject({
  type: z.enum(["BUG", "QUESTION", "REQUEST"], { message: "Talep türü BUG, QUESTION ya da REQUEST olmalı." }),
  subject: z.string().trim().min(1, "Konu boş olamaz.").max(200, "Konu en çok 200 karakter olabilir."),
  message: MessageText,
  clientToken: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/, "clientToken 1–100 karakter [A-Za-z0-9_.:-] olmalı (önerilen UUID)."),
  context: ContextBody.optional(),
  files: FilesBody,
});
const ReplyBody = z.strictObject({ message: MessageText, files: FilesBody });
const Empty = z.strictObject({});
const Scope = z.enum(["mine", "tenant"], { message: "scope mine ya da tenant olmalı." }).default("mine");
const ListQuery = z.object({
  scope: Scope,
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(STATUSES, { message: "Geçersiz durum." })).optional()),
  page: z.coerce.number().int().min(1, "page en az 1 olmalı.").optional(),
  limit: z.coerce.number().int().min(1).max(100, "limit en çok 100 olabilir.").optional(),
});
const VariantQuery = z.object({ variant: z.enum(["original", "thumb"], { message: "variant original ya da thumb olmalı." }).default("original") });

/** Sorgu doğrulaması: tekrarlı parametre (dizi) ya da biçimsiz değer 400 `GOVDE_GECERSIZ`. */
function query<T>(c: ApiCall, schema: z.ZodType<T>): T {
  const r = schema.safeParse(c.req.query);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  throw badRequest(`Sorgu geçersiz${first?.path.length ? ` (${first.path.join(".")})` : ""}: ${first?.message ?? "bilinmiyor"}`);
}

/** Kapı: özellik kapalıysa gövde/sorgu okunmadan 403 (merkeze istek yok). */
function enabled(c: ApiCall): void {
  if (!c.ctx.destek?.api) throw new CloudError(403, "MODULE_DISABLED", "Destek talebi özelliği bu kurulumda kapalı.", { modul: "destek" });
}

export const DESTEK_ROUTES: readonly ApiRouteDef[] = [
  { method: "get", path: "/destek/durum", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: supportStatus(c.ctx) }) },
  {
    method: "post",
    path: "/destek/talepler",
    auth: "OTURUM",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      enabled(c);
      const t = await openTicket(c.ctx, s(c), body(c, OpenBody));
      return { status: t.idempotentReplay ? 200 : 201, data: t, replayed: t.idempotentReplay };
    },
  },
  {
    method: "get",
    path: "/destek/talepler",
    auth: "OTURUM",
    kimlik: "OKUMA",
    handler: async (c) => {
      enabled(c);
      return { data: await listTickets(c.ctx, s(c), query(c, ListQuery)) };
    },
  },
  { method: "get", path: "/destek/talepler/:id", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => {
      enabled(c);
      return { data: await getTicket(c.ctx, s(c), param(c, "id")) };
    } },
  {
    method: "post",
    path: "/destek/talepler/:id/mesajlar",
    auth: "OTURUM",
    kimlik: { muaf: "merkezdeki yazışmaya yanıt; merkez yanıtta işlem kimliği almaz — istemci gönderirken düğmeyi kilitler, ağ hatasında yazışmayı yeniden okur" },
    handler: async (c) => {
      enabled(c);
      const id = param(c, "id");
      return { status: 201, data: await addMessage(c.ctx, s(c), id, body(c, ReplyBody)) };
    },
  },
  {
    method: "post",
    path: "/destek/talepler/:id/kapat",
    auth: "OTURUM",
    kimlik: { muaf: "kapalı talepte tekrar çağrı merkezde bir şey değiştirmez (kılavuz §4.6)" },
    handler: async (c) => {
      enabled(c);
      const id = param(c, "id");
      body(c, Empty);
      return { data: await closeTicket(c.ctx, s(c), id) };
    },
  },
  {
    method: "post",
    path: "/destek/talepler/:id/okundu",
    auth: "OTURUM",
    kimlik: { muaf: "okuma damgası (talep × kullanıcı); tekrarı yalnız damgayı ileri alır" },
    handler: async (c) => {
      enabled(c);
      const id = param(c, "id");
      body(c, Empty);
      return { data: await markRead(c.ctx, s(c), id) };
    },
  },
  { method: "get", path: "/destek/okunmamis", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => {
      enabled(c);
      return { data: await unreadCount(c.ctx, s(c), query(c, z.object({ scope: Scope })).scope) };
    } },
  {
    method: "get",
    path: "/destek/ekler/:id/baglanti",
    auth: "OTURUM",
    kimlik: "OKUMA",
    handler: async (c) => {
      enabled(c);
      const id = param(c, "id");
      return { data: await attachmentLink(c.ctx, s(c), id, query(c, VariantQuery).variant) };
    },
  },
];

/** Ekli iki uç (yönlendirici göreli yolu). */
export function isSupportUpload(req: Request): boolean {
  return req.method === "POST" && /^\/destek\/talepler(?:\/[^/]+\/mesajlar)?\/?$/.test(req.path);
}

/**
 * JSON gövde katmanı: ekli iki uçta (özellik AÇIKKEN) 70 MB + tek eşzamanlı okuma; geri kalan her yerde `small`
 * (genel 256 KB). Özellik kapalıyken ekli uç da küçük sınırla okunur (büyük gövde merkeze hiç uğramadan 413/403).
 */
export function jsonBodies(ctx: CloudContext, small: RequestHandler): RequestHandler {
  const big = express.json({ limit: SUPPORT_BODY_LIMIT, strict: true });
  let inflight = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isSupportUpload(req) || !ctx.destek?.api) return small(req, res, next);
    if (inflight >= SUPPORT_UPLOAD_CONCURRENCY) {
      next(new CloudError(429, "RATE_LIMITED", "Şu an başka bir ek yükleniyor; birkaç saniye sonra tekrar deneyin.", { retryAfterSec: 10 }));
      return;
    }
    inflight++;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      inflight--;
    };
    res.once("finish", release);
    res.once("close", release);
    big(req, res, next);
  };
}

/**
 * Webhook (`POST /api/destek/webhook`, oturumsuz): HAM gövde → imza → tekilleştirme → 200; push yanıttan SONRA.
 * Sır yoksa gövde okunmadan 404. Hız sınırı `/v1` ile aynı tavan (IP başına).
 */
export function supportWebhookHandlers(ctx: CloudContext): RequestHandler[] {
  const handle = async (req: Request, res: Response): Promise<void> => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (!ctx.destek?.webhookSecret) throw new CloudError(404, "BULUNAMADI", "Bulunamadı");
    const raw = await readRawBody(req, WEBHOOK_BODY_LIMIT);
    const r = receiveWebhook(ctx, raw, req.headers);
    res.status(200).json({ success: true, data: r.data });
    if (!r.push) return;
    const pending = ctx.destek.pending;
    const job: Promise<unknown> = r.push().catch((err: Error) => console.error(`[patron] destek bildirimi başarısız: ${err.name}`));
    pending.add(job);
    void job.finally(() => pending.delete(job));
  };
  return [rateLimit({ perMinute: ctx.config.V1_HIZ_DK, config: ctx.config }), handle];
}
