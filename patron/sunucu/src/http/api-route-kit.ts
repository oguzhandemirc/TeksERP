// Hesap API'si rota kiti — rota tablosunun ortak tipleri ve gövde/parametre yardımcıları (rota dosyaları
// bölündüğünde tek kaynak kalsın diye ayrı dosyada; davranış `api-routes.ts`teki tabloyla aynı).
import type { Request } from "express";
import { z } from "zod";
import type { SessionContext } from "../auth/session.service";
import { CloudError, badRequest } from "../lib/errors";
import type { WriteResult } from "../lib/idempotency";
import type { CloudContext } from "../services/context";

export interface ApiCall {
  readonly ctx: CloudContext;
  readonly req: Request;
  /** `OTURUM` rotalarında dolu. */
  readonly session: SessionContext | null;
}

export interface ApiRouteDef {
  readonly method: "get" | "post" | "patch";
  readonly path: string;
  readonly auth: "ACIK" | "OTURUM";
  /** Yazma: işlem kimliğiyle idempotent ("ISLEM_KIMLIGI") ya da gerekçesi yazılı muafiyet; okuma "OKUMA". */
  readonly kimlik: "OKUMA" | "ISLEM_KIMLIGI" | { readonly muaf: string };
  readonly handler: (c: ApiCall) => Promise<{ status?: number; data: unknown; replayed?: boolean }>;
}

export const Uuid = z.uuid();
export const Token = z.uuid();
export const PermissionList = z.array(z.string().max(40)).max(40);
export const Template = z.enum(["PATRON", "MUHASEBE", "SATIS"]);

export function body<T>(c: ApiCall, schema: z.ZodType<T>): T {
  const r = schema.safeParse(c.req.body ?? {});
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const where = first && first.path.length > 0 ? ` (${first.path.join(".")})` : "";
  throw badRequest(`İstek gövdesi sözleşmeye uymuyor${where}: ${first?.message ?? "bilinmiyor"}`);
}

export function param(c: ApiCall, name: string): string {
  const v = c.req.params[name];
  if (typeof v !== "string" || !Uuid.safeParse(v).success) throw new CloudError(404, "BULUNAMADI", "Kayıt bulunamadı");
  return v;
}

export function text(c: ApiCall, name: string, max = 200): string | undefined {
  const v = c.req.query[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

export function page(c: ApiCall): { cursor: string | undefined; limit: number } {
  const raw = text(c, "limit");
  const limit = raw === undefined ? 50 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw badRequest("limit 1–200 olmalı");
  return { cursor: text(c, "imlec", 400), limit };
}

export function uuidCursor(cursor: string | undefined): string | undefined {
  if (cursor !== undefined && !Uuid.safeParse(cursor).success) throw badRequest("İmleç biçimsiz");
  return cursor;
}

export const s = (c: ApiCall): SessionContext => c.session!;
export const webPushKey = (c: ApiCall): string | null => c.ctx.notifications?.webPushKey ?? null;
export const written = (r: WriteResult) => ({ status: r.status, data: r.data, replayed: r.replayed });
