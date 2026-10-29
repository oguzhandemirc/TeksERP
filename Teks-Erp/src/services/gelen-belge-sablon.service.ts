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
export async function ensureSenderTemplate(code: string, userId?: string): Promise<{ id: string; isActive: boolean } | null> {
  const tpl = bindableTemplates().find((t) => t.id === code);
  if (!tpl) return null;
  const select = { id: true, isActive: true } as const;
  const found = await prisma.senderTemplate.findUnique({ where: { code }, select });
  if (found) return found;
  try {
    const row = await prisma.senderTemplate.create({ data: { code, version: tpl.version, template: toJson(tpl) }, select });
    await AuditService.log({ userId, action: "CREATE", tableName: TABLE, recordId: row.id, newData: { code, version: tpl.version, source: "OCR" } });
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
const ROW_SELECT = {
  id: true, code: true, version: true, isActive: true, hitCount: true, updatedAt: true,
  senderCustomerId: true, defaultOwnerCustomerId: true,
  senderCustomer: CUSTOMER_REF, defaultOwnerCustomer: CUSTOMER_REF,
} as const;
type Row = Prisma.SenderTemplateGetPayload<{ select: typeof ROW_SELECT }>;

export interface SenderTemplateView {
  code: string;
  name: string;
  /** Dosyadaki motor şablonunun sürümü (DB satırının doğduğu sürüm `rowVersion`). */
  version: number;
  rowVersion: number | null;
  /** Dosyada motor şablonu var mı (yoksa DB satırı yetim: motor artık bu kodu üretmez). */
  inEngine: boolean;
  id: string | null;
  isActive: boolean;
  hitCount: number;
  senderCustomer: Row["senderCustomer"];
  defaultOwnerCustomer: Row["defaultOwnerCustomer"];
  updatedAt: Date | null;
}

function view(t: { code: string; name: string; version: number; inEngine: boolean }, row: Row | undefined): SenderTemplateView {
  const { code, name, version, inEngine } = t;
  return {
    code, name, version, inEngine,
    rowVersion: row?.version ?? null,
    id: row?.id ?? null,
    // Satırı olmayan şablon motor tarafından kullanılır, öneri bağı yoktur → aktif sayılır (doğuş varsayılanı).
    isActive: row?.isActive ?? true,
    hitCount: row?.hitCount ?? 0,
    senderCustomer: row?.senderCustomer ?? null,
    defaultOwnerCustomer: row?.defaultOwnerCustomer ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Liste: dosyadaki motor şablonları + DB satırları, kodla birleşik (satırı olmayan şablon da listelenir). Salt okunur. */
export async function listSenderTemplates(): Promise<SenderTemplateView[]> {
  const rows = await prisma.senderTemplate.findMany({ select: ROW_SELECT, orderBy: { code: "asc" } });
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const out = bindableTemplates().map((t) => view({ code: t.id, name: t.name, version: t.version, inEngine: true }, byCode.get(t.id)));
  const fileCodes = new Set(out.map((v) => v.code));
  for (const r of rows) if (!fileCodes.has(r.code)) out.push(view({ code: r.code, name: r.code, version: r.version, inEngine: false }, r));
  return out;
}

export interface SenderTemplatePatch {
  isActive?: boolean;
  senderCustomerId?: string | null;
  defaultOwnerCustomerId?: string | null;
}

async function assertActiveCustomer(id: string, role: "gönderen" | "varsayılan sahip"): Promise<void> {
  const c = await prisma.customer.findUnique({ where: { id }, select: { isActive: true } });
  if (!c) throw AppError.badRequest(`Seçilen ${role} cari bulunamadı.`, { code: "SENDER_TEMPLATE_CUSTOMER_NOT_FOUND" });
  if (!c.isActive) throw AppError.badRequest(`Seçilen ${role} cari pasif; şablona bağlanamaz.`, { code: "SENDER_TEMPLATE_CUSTOMER_INACTIVE" });
}

const auditOf = (r: { isActive: boolean; senderCustomerId: string | null; defaultOwnerCustomerId: string | null }) => ({
  isActive: r.isActive, senderCustomerId: r.senderCustomerId, defaultOwnerCustomerId: r.defaultOwnerCustomerId,
});

/**
 * Güncelleme: yalnız patch'te TANIMLI alanlar yazılır. Satır yoksa idempotent doğar (motor şablonu olmalı).
 * Yazım `updateMany WHERE {id, updatedAt}` ile atomik (araya giren yazım → 409, kayıp güncelleme yok).
 */
export async function updateSenderTemplate(code: string, patch: SenderTemplatePatch, userId: string): Promise<SenderTemplateView> {
  const inEngine = bindableTemplates().some((t) => t.id === code);
  const existing = await prisma.senderTemplate.findUnique({ where: { code }, select: { id: true } });
  if (!inEngine && !existing) {
    throw AppError.notFound(code === FALLBACK_TEMPLATE_CODE ? "Genel yedek sözlük bir gönderene bağlanamaz." : "Gönderen şablonu bulunamadı.", { code: "SENDER_TEMPLATE_NOT_FOUND" });
  }
  if (patch.senderCustomerId) await assertActiveCustomer(patch.senderCustomerId, "gönderen");
  if (patch.defaultOwnerCustomerId) await assertActiveCustomer(patch.defaultOwnerCustomerId, "varsayılan sahip");
  const id = existing?.id ?? (await ensureSenderTemplate(code, userId))!.id;
  const before = await prisma.senderTemplate.findUniqueOrThrow({ where: { id }, select: { isActive: true, senderCustomerId: true, defaultOwnerCustomerId: true, updatedAt: true } });
  const data: Prisma.SenderTemplateUncheckedUpdateManyInput = {};
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.senderCustomerId !== undefined) data.senderCustomerId = patch.senderCustomerId;
  if (patch.defaultOwnerCustomerId !== undefined) data.defaultOwnerCustomerId = patch.defaultOwnerCustomerId;
  const c = await prisma.senderTemplate.updateMany({ where: { id, updatedAt: before.updatedAt }, data });
  if (c.count === 0) throw AppError.conflict("Şablon bu arada değişti; yenileyip tekrar deneyin.", { code: "SENDER_TEMPLATE_CHANGED" });
  const row = await prisma.senderTemplate.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: id, oldData: { code, ...auditOf(before) }, newData: { code, ...auditOf(row) } });
  const tpl = bindableTemplates().find((t) => t.id === code);
  return view({ code, name: tpl?.name ?? code, version: tpl?.version ?? row.version, inEngine: !!tpl }, row);
}
