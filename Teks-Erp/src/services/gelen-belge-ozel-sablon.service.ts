// =============================================================================
// Gelen belge KULLANICI ŞABLONU (S1, Gülkesim 2026-11-03): panelde/tablette tanıtılan belge tipi (`u-…` kodu)
// =============================================================================
// Şablon JSON'u dosya şablonlarıyla AYNI şemadır (`validateTemplate`); `SenderTemplate.template`te durur, motor dosya
// şablonlarıyla birlikte yükler (`engineTemplates`). Güncelleme SÜRÜMLÜDÜR: atomik `updateMany WHERE {code, version}`
// → version+1 + `SenderTemplateVersion` satırı (geçmiş değişmez; belge okunduğu sürümü `templateVersion`da tutar).
// Pasife alma mevcut PATCH /sablonlar/:code (isActive) ucundandır. Audit tx DIŞINDA.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { p2002OnField } from "../utils/p2002";
import { loadTemplates, validateTemplate, type DocumentTemplate } from "../lib/gelen-belge/motor";
import { setUserTemplates } from "../lib/gelen-belge/sablon-bul";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { USER_TEMPLATE_PREFIX } from "./gelen-belge-sablon.service";

export { USER_TEMPLATE_PREFIX };
const TABLE = "SENDER_TEMPLATE";
/** Şablon JSON tavanı — kullanıcı girdisi motorun her okumasında koşar; şişkin şablon reddedilir. */
const MAX_TEMPLATE_BYTES = 64 * 1024;
const FALLBACK = "genel";

const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));

/** Ad → `u-<ascii-slug>` (Türkçe harfler katlanır); boş kalırsa "sablon". */
export function userTemplateCode(name: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
  const slug = name
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${USER_TEMPLATE_PREFIX}${slug || "sablon"}`;
}

/** Gövdedeki şablonu kod/ad/sürümle mühürler ve doğrular (FAIL-CLOSED: şema dışı → 400). */
function sealTemplate(raw: unknown, code: string, name: string, version: number): DocumentTemplate {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw AppError.badRequest("Şablon bir nesne olmalı.", { code: "USER_TEMPLATE_INVALID", errors: ["şablon bir nesne olmalı"] });
  const t = { ...(raw as Record<string, unknown>), id: code, name, version };
  if (JSON.stringify(t).length > MAX_TEMPLATE_BYTES) throw AppError.badRequest("Şablon çok büyük.", { code: "USER_TEMPLATE_TOO_LARGE" });
  const v = validateTemplate(t);
  if (!v.ok) throw AppError.badRequest(`Şablon geçersiz: ${v.errors.slice(0, 5).join("; ")}`, { code: "USER_TEMPLATE_INVALID", errors: v.errors });
  return t as unknown as DocumentTemplate;
}

/** Aktif kullanıcı şablonları (doğrulamadan geçmeyen satır atlanır — bozuk satır okumayı düşürmez). Kayıt kümesini tazeler. */
export async function loadUserTemplates(): Promise<DocumentTemplate[]> {
  const rows = await prisma.senderTemplate.findMany({ where: { code: { startsWith: USER_TEMPLATE_PREFIX }, isActive: true }, select: { code: true, version: true, template: true }, orderBy: { code: "asc" } });
  const out: DocumentTemplate[] = [];
  for (const r of rows) {
    const t = { ...(r.template as Record<string, unknown>), id: r.code, version: r.version };
    if (validateTemplate(t).ok) out.push(t as unknown as DocumentTemplate);
  }
  setUserTemplates(out);
  return out;
}

/** Motorun şablon kümesi: dosya şablonları + aktif kullanıcı şablonları; GENEL yedek SONDA (classifyWithFallback sözleşmesi). */
export async function engineTemplates(): Promise<DocumentTemplate[]> {
  const files = loadTemplates();
  const user = await loadUserTemplates();
  return [...files.filter((t) => t.id !== FALLBACK), ...user, ...files.filter((t) => t.id === FALLBACK)];
}

const VIEW_SELECT = { id: true, code: true, version: true, isActive: true, template: true, clientToken: true, updatedAt: true, createdAt: true } as const;
type Row = Prisma.SenderTemplateGetPayload<{ select: typeof VIEW_SELECT }>;

export interface UserTemplateView {
  id: string;
  code: string;
  name: string;
  version: number;
  isActive: boolean;
  template: Prisma.JsonValue;
  updatedAt: Date;
}

const nameOf = (tpl: Prisma.JsonValue, code: string) => (tpl && typeof tpl === "object" && !Array.isArray(tpl) && typeof tpl.name === "string" ? tpl.name : code);
const viewOf = (r: Row): UserTemplateView => ({ id: r.id, code: r.code, name: nameOf(r.template, r.code), version: r.version, isActive: r.isActive, template: r.template, updatedAt: r.updatedAt });

export async function listUserTemplates(): Promise<UserTemplateView[]> {
  const rows = await prisma.senderTemplate.findMany({ where: { code: { startsWith: USER_TEMPLATE_PREFIX } }, select: VIEW_SELECT, orderBy: { code: "asc" } });
  return rows.map(viewOf);
}

export async function getUserTemplate(code: string): Promise<UserTemplateView & { versions: Array<{ version: number; createdAt: Date; createdById: string | null }> }> {
  const row = code.startsWith(USER_TEMPLATE_PREFIX) ? await prisma.senderTemplate.findUnique({ where: { code }, select: VIEW_SELECT }) : null;
  if (!row) throw AppError.notFound("Kullanıcı şablonu bulunamadı.", { code: "USER_TEMPLATE_NOT_FOUND" });
  const versions = await prisma.senderTemplateVersion.findMany({ where: { templateId: row.id }, select: { version: true, createdAt: true, createdById: true }, orderBy: { version: "desc" } });
  return { ...viewOf(row), versions };
}

export interface CreateUserTemplateInput {
  name: string;
  template: unknown;
  clientToken?: string | null;
}

/** Oluştur: kod addan (`u-<slug>`), v1 + sürüm satırı tek tx'te. Aynı ad → 409; aynı token → aynı şablon (replay). */
export async function createUserTemplate(input: CreateUserTemplateInput, userId: string): Promise<UserTemplateView> {
  const name = input.name.trim();
  const code = userTemplateCode(name);
  const tpl = sealTemplate(input.template, code, name, 1);
  const replay = tokenReplay<Row, UserTemplateView>({
    find: (db, clientToken) => db.senderTemplate.findUnique({ where: { clientToken }, select: VIEW_SELECT }),
    alive: { neverDies: "Kullanıcı şablonu silinmez; pasife alınsa da kimliği ve sürüm geçmişi aynı kalır." },
    identity: (hit) => [{ ad: "code", mevcut: hit.code, gelen: code }],
    collision: "Bu deneme başka bir şablon adıyla kaydedilmiş; yeni şablon için ekranı yenileyin.",
    respond: viewOf,
  });
  const row = await replay.run(input.clientToken, async () => {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const r = await tx.senderTemplate.create({ data: { code, version: 1, template: toJson(tpl), clientToken: input.clientToken ?? null }, select: VIEW_SELECT });
        await tx.senderTemplateVersion.create({ data: { templateId: r.id, version: 1, template: toJson(tpl), createdById: userId } });
        return r;
      });
      await AuditService.log({ userId, action: "CREATE", tableName: TABLE, recordId: created.id, newData: { code, version: 1, source: "USER", name } });
      return viewOf(created);
    } catch (err) {
      if (p2002OnField(err, "code")) throw AppError.conflict(`"${name}" adıyla bir şablon zaten var; başka ad verin ya da mevcut şablonu güncelleyin.`, { code: "USER_TEMPLATE_CODE_TAKEN", templateCode: code });
      throw err;
    }
  });
  await loadUserTemplates();
  return row;
}

export interface UpdateUserTemplateInput {
  expectedVersion: number;
  template: unknown;
  name?: string;
}

/** Güncelle: `updateMany WHERE {code, version: beklenen}` (araya giren kayıt → 409) → version+1 + yeni sürüm satırı. */
export async function updateUserTemplate(code: string, input: UpdateUserTemplateInput, userId: string): Promise<UserTemplateView> {
  if (!code.startsWith(USER_TEMPLATE_PREFIX)) throw AppError.badRequest("Dosya şablonu panelden düzenlenmez; yalnız kullanıcı şablonu (u-…) güncellenir.", { code: "USER_TEMPLATE_FILE_READONLY" });
  const before = await prisma.senderTemplate.findUnique({ where: { code }, select: VIEW_SELECT });
  if (!before) throw AppError.notFound("Kullanıcı şablonu bulunamadı.", { code: "USER_TEMPLATE_NOT_FOUND" });
  const next = input.expectedVersion + 1;
  const tpl = sealTemplate(input.template, code, input.name?.trim() || nameOf(before.template, code), next);
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.senderTemplate.updateMany({ where: { code, version: input.expectedVersion }, data: { version: next, template: toJson(tpl) } });
    if (c.count === 0) throw AppError.conflict("Şablon bu arada güncellendi; yenileyip tekrar deneyin.", { code: "USER_TEMPLATE_VERSION_CHANGED", currentVersion: before.version });
    await tx.senderTemplateVersion.create({ data: { templateId: before.id, version: next, template: toJson(tpl), createdById: userId } });
    return tx.senderTemplate.findUniqueOrThrow({ where: { code }, select: VIEW_SELECT });
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: row.id, oldData: { code, version: input.expectedVersion }, newData: { code, version: next, name: tpl.name } });
  await loadUserTemplates();
  return viewOf(row);
}
