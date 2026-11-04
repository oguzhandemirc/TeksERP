// =============================================================================
// Gelen belge GÖNDEREN ŞABLONU (E2): motor şablonu (dosya) ↔ `SenderTemplate` satırı (DB) bağı
// =============================================================================
// Motor şablonları dosyadadır (`lib/gelen-belge/motor/templates/*.json`); DB satırı yalnız fabrikaya özgü
// bağı tutar (gönderen cari, varsayılan sahip, aktiflik, isabet sayısı) ve şablon KODU (`code @unique`) ile
// dosyaya bağlanır. Satır yoksa İDEMPOTENT doğar (P2002 → yeniden oku; iki paralel okuma tek satır).
// GENEL yedek sözlük gönderene özgü değildir → bağlanmaz, listelenmez. GET uçları YAZMAZ.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { p2002OnField } from "../utils/p2002";
import { loadTemplates, type DocumentTemplate } from "../lib/gelen-belge/motor";
import { AuditService } from "./audit.service";

/** Kullanıcı şablonu kod öneki — tek kaynak (gelen-belge-ozel-sablon.service yeniden dışa verir). */
export const USER_TEMPLATE_PREFIX = "u-";

/** Motorun yedek sözlüğü (classifyWithFallback) — tek kaynak; okuma işi `extractDocument`e bunu verir. */
export const FALLBACK_TEMPLATE_CODE = "genel";
const TABLE = "SENDER_TEMPLATE";

/** Bağlanabilir (gönderene özgü) motor şablonları — yedek sözlük hariç. */
export function bindableTemplates(): DocumentTemplate[] {
  return loadTemplates().filter((t) => t.id !== FALLBACK_TEMPLATE_CODE);
}

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v));
}

/**
 * Şablon koduna bağlı satırı döner; yoksa oluşturur. Paralel iki çağrıda biri P2002 alır ve kazananın
 * satırını YENİDEN OKUR (tek satır). Bilinmeyen/yedek kod null (bağ kurulmaz).
 */
export async function ensureSenderTemplate(code: string, userId?: string, source: "OCR" | "PANEL" = "OCR"): Promise<{ id: string; isActive: boolean; version: number } | null> {
  const select = { id: true, isActive: true, version: true } as const;
  // Kullanıcı şablonu (`u-…`) satırıyla doğar (gelen-belge-ozel-sablon.service); burada yalnız okunur.
  if (code.startsWith(USER_TEMPLATE_PREFIX)) return prisma.senderTemplate.findUnique({ where: { code }, select });
  const tpl = bindableTemplates().find((t) => t.id === code);
  if (!tpl) return null;
  const found = await prisma.senderTemplate.findUnique({ where: { code }, select });
  if (found) return found;
  try {
    const row = await prisma.senderTemplate.create({ data: { code, version: tpl.version, template: toJson(tpl) }, select });
    await AuditService.log({ userId, action: "CREATE", tableName: TABLE, recordId: row.id, newData: { code, version: tpl.version, source } });
    return row;
  } catch (err) {
    if (p2002OnField(err, "code")) return prisma.senderTemplate.findUniqueOrThrow({ where: { code }, select });
    throw err;
  }
}

/** Okuma isabeti sayacı — best-effort (sayaç defter değil; düşerse okuma sürer). */
export async function bumpTemplateHit(id: string): Promise<void> {
  await prisma.senderTemplate.updateMany({ where: { id }, data: { hitCount: { increment: 1 } } }).catch(() => undefined);
}

const CUSTOMER_REF = { select: { id: true, code: true, name: true, isActive: true } } as const;
const templateName = (t: Prisma.JsonValue, code: string): string => (t && typeof t === "object" && !Array.isArray(t) && typeof t.name === "string" ? t.name : code);

const ROW_SELECT = {
  id: true, code: true, version: true, template: true, isActive: true, hitCount: true, updatedAt: true,
  senderCustomerId: true, defaultOwnerCustomerId: true, batchNoKey: true,
  senderCustomer: CUSTOMER_REF, defaultOwnerCustomer: CUSTOMER_REF,
} as const;
type Row = Prisma.SenderTemplateGetPayload<{ select: typeof ROW_SELECT }>;

export interface SenderTemplateView {
  code: string;
  name: string;
  /** FILE = dosyadaki motor şablonu; USER = panelde tanıtılan (`u-…`, DB'de, sürümlü). */
  kind: "FILE" | "USER";
  /** Dosyadaki motor şablonunun sürümü (DB satırının doğduğu sürüm `rowVersion`). */
  version: number;
  rowVersion: number | null;
  /** Motor bu şablonla belge tanır mı: dosya şablonu dosyada VE aktif; kullanıcı şablonu aktif. */
  inEngine: boolean;
  /** Dosya şablonu dosyada var mı (yoksa DB satırı yetim: motor artık bu kodu üretmez); kullanıcı şablonunda false. */
  inFile: boolean;
  id: string | null;
  isActive: boolean;
  hitCount: number;
  senderCustomer: Row["senderCustomer"];
  defaultOwnerCustomer: Row["defaultOwnerCustomer"];
  /** "Bu formda parti no hangi alan" — onayda öğrenilen ya da elle seçilen aday anahtarı; null = hatırlanan yok. */
  batchNoKey: string | null;
  updatedAt: Date | null;
}

function view(t: { code: string; name: string; version: number; inFile: boolean }, row: Row | undefined): SenderTemplateView {
  const { code, name, version, inFile } = t;
  const user = code.startsWith(USER_TEMPLATE_PREFIX);
  return {
    code, name, version, inFile,
    // Pasif şablon (dosya ya da kullanıcı) motora girmez (`engineTemplates`); satırsız dosya şablonu aktiftir.
    inEngine: (inFile || user) && (row?.isActive ?? true),
    kind: user ? "USER" : "FILE",
    rowVersion: row?.version ?? null,
    id: row?.id ?? null,
    // Satırı olmayan şablon motor tarafından kullanılır, öneri bağı yoktur → aktif sayılır (doğuş varsayılanı).
    isActive: row?.isActive ?? true,
    hitCount: row?.hitCount ?? 0,
    senderCustomer: row?.senderCustomer ?? null,
    defaultOwnerCustomer: row?.defaultOwnerCustomer ?? null,
    batchNoKey: row?.batchNoKey ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Liste: dosyadaki motor şablonları + DB satırları, kodla birleşik (satırı olmayan şablon da listelenir). Salt okunur. */
export async function listSenderTemplates(): Promise<SenderTemplateView[]> {
  const rows = await prisma.senderTemplate.findMany({ select: ROW_SELECT, orderBy: { code: "asc" } });
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const out = bindableTemplates().map((t) => view({ code: t.id, name: t.name, version: t.version, inFile: true }, byCode.get(t.id)));
  const fileCodes = new Set(out.map((v) => v.code));
  for (const r of rows) {
    if (fileCodes.has(r.code)) continue;
    const user = r.code.startsWith(USER_TEMPLATE_PREFIX);
    // Kullanıcı şablonu motordadır (aktifken); adı kendi JSON'undan.
    out.push(view({ code: r.code, name: user ? templateName(r.template, r.code) : r.code, version: r.version, inFile: false }, r));
  }
  return out;
}

export interface SenderTemplatePatch {
  isActive?: boolean;
  senderCustomerId?: string | null;
  defaultOwnerCustomerId?: string | null;
  batchNoKey?: string | null;
}

async function assertActiveCustomer(id: string, role: "gönderen" | "varsayılan sahip"): Promise<void> {
  const c = await prisma.customer.findUnique({ where: { id }, select: { isActive: true } });
  if (!c) throw AppError.badRequest(`Seçilen ${role} cari bulunamadı.`, { code: "SENDER_TEMPLATE_CUSTOMER_NOT_FOUND" });
  if (!c.isActive) throw AppError.badRequest(`Seçilen ${role} cari pasif; şablona bağlanamaz.`, { code: "SENDER_TEMPLATE_CUSTOMER_INACTIVE" });
}

const auditOf = (r: { isActive: boolean; senderCustomerId: string | null; defaultOwnerCustomerId: string | null; batchNoKey: string | null }) => ({
  isActive: r.isActive, senderCustomerId: r.senderCustomerId, defaultOwnerCustomerId: r.defaultOwnerCustomerId, batchNoKey: r.batchNoKey,
});

/** Parti no aday anahtarı biçimi — şablon alan anahtarı (`isEmriNo`…); `MANUAL` aday değildir, hatırlanmaz. */
export const BATCH_NO_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
export const MANUAL_BATCH_NO_KEY = "MANUAL";

/**
 * Hatırlama (tasarım §2.4) — onayda giren belgenin parti no anahtarı aday anahtarıysa ve şablonunkinden farklıysa TEK koşullu
 * `updateMany` (alias emsali; eşzamanlı iki onayda son yazan kazanır, çift yazım yok). Best-effort çağrılır; audit'li.
 */
export async function learnBatchNoKey(templateId: string, ourBatchNo: string | null, key: string | null, userId: string): Promise<boolean> {
  if (!ourBatchNo?.trim() || !key || key === MANUAL_BATCH_NO_KEY || !BATCH_NO_KEY_RE.test(key)) return false;
  const before = await prisma.senderTemplate.findUnique({ where: { id: templateId }, select: { code: true, batchNoKey: true } });
  const c = await prisma.senderTemplate.updateMany({ where: { id: templateId, OR: [{ batchNoKey: null }, { batchNoKey: { not: key } }] }, data: { batchNoKey: key } });
  if (c.count === 0) return false;
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: templateId, oldData: { code: before?.code ?? null, batchNoKey: before?.batchNoKey ?? null }, newData: { code: before?.code ?? null, batchNoKey: key, source: "APPROVAL" } });
  return true;
}

/**
 * Güncelleme: yalnız patch'te TANIMLI alanlar yazılır. Satır yoksa idempotent doğar (motor şablonu olmalı).
 * Yazım `updateMany WHERE {id, yazılabilir alanların eski değerleri}` ile atomik (araya giren yazım → 409);
 * kilit updatedAt'e kurulmaz: okuma işinin hitCount artışı PATCH'e haksız 409 verdirmesin.
 */
export async function updateSenderTemplate(code: string, patch: SenderTemplatePatch, userId: string): Promise<SenderTemplateView> {
  const inEngine = bindableTemplates().some((t) => t.id === code);
  const existing = await prisma.senderTemplate.findUnique({ where: { code }, select: { id: true } });
  if (!inEngine && !existing) {
    throw AppError.notFound(code === FALLBACK_TEMPLATE_CODE ? "Genel yedek sözlük bir gönderene bağlanamaz." : "Gönderen şablonu bulunamadı.", { code: "SENDER_TEMPLATE_NOT_FOUND" });
  }
  if (patch.senderCustomerId) await assertActiveCustomer(patch.senderCustomerId, "gönderen");
  if (patch.defaultOwnerCustomerId) await assertActiveCustomer(patch.defaultOwnerCustomerId, "varsayılan sahip");
  const id = existing?.id ?? (await ensureSenderTemplate(code, userId, "PANEL"))!.id;
  const before = await prisma.senderTemplate.findUniqueOrThrow({ where: { id }, select: { isActive: true, senderCustomerId: true, defaultOwnerCustomerId: true, batchNoKey: true } });
  const data: Prisma.SenderTemplateUncheckedUpdateManyInput = {};
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.senderCustomerId !== undefined) data.senderCustomerId = patch.senderCustomerId;
  if (patch.defaultOwnerCustomerId !== undefined) data.defaultOwnerCustomerId = patch.defaultOwnerCustomerId;
  if (patch.batchNoKey !== undefined) data.batchNoKey = patch.batchNoKey;
  const c = await prisma.senderTemplate.updateMany({
    where: { id, isActive: before.isActive, senderCustomerId: before.senderCustomerId, defaultOwnerCustomerId: before.defaultOwnerCustomerId, batchNoKey: before.batchNoKey },
    data,
  });
  if (c.count === 0) throw AppError.conflict("Şablon bu arada değişti; yenileyip tekrar deneyin.", { code: "SENDER_TEMPLATE_CHANGED" });
  const row = await prisma.senderTemplate.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: id, oldData: { code, ...auditOf(before) }, newData: { code, ...auditOf(row) } });
  const tpl = bindableTemplates().find((t) => t.id === code);
  const user = code.startsWith(USER_TEMPLATE_PREFIX);
  return view({ code, name: tpl?.name ?? (user ? templateName(row.template, code) : code), version: tpl?.version ?? row.version, inFile: !!tpl }, row);
}
