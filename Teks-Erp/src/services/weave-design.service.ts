// =============================================================================
// DESEN KARTI (WeaveDesign) — armür/örgü kataloğu (Seyitoğlu SY-A2, tasarım §2.4)
// =============================================================================
// Desen no = satılan ürünün kodu (K1); bu katalog yalnız örgü bilgisini taşır (tür, çerçeve,
// desen boyu, armür ızgarası, tezgâh dosya adı) ve `Item.weaveDesignId` ile bağlanır. Sıklık
// atkı kartında, en üründe kalır — ikinci kopya yok. Kart silinmez, pasife alınır; aktif ürün
// bağlıyken pasif 409 (MV-06). BaseController KULLANILMAZ: alanlar açıkça sayılır.
// =============================================================================
import { Prisma, WeaveDesignKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { isUniqueViolation, parseDecimalField, parseTextField } from "./helpers/cost-input.helper";
import { LIFT_PLAN_MAX_FRAMES, LIFT_PLAN_MAX_PICKS, WEAVE_DESIGN_KINDS } from "../constants/weave-design";

export const WEAVE_DESIGN_SELECT = {
  id: true,
  code: true,
  name: true,
  kind: true,
  familyLabel: true,
  frameCount: true,
  repeatCm: true,
  liftPlan: true,
  loomFileName: true,
  lenoSetup: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
} satisfies Prisma.WeaveDesignSelect;

/** Listede ızgara taşınmaz (JSON büyük olabilir); detayda gelir. */
const WEAVE_DESIGN_LIST_SELECT = { ...WEAVE_DESIGN_SELECT, liftPlan: false } satisfies Prisma.WeaveDesignSelect;

export type WeaveDesignRow = Prisma.WeaveDesignGetPayload<{ select: typeof WEAVE_DESIGN_SELECT }>;
export type WeaveDesignListRow = Prisma.WeaveDesignGetPayload<{ select: typeof WEAVE_DESIGN_LIST_SELECT }>;

const ALLOWED = new Set(["code", "name", "kind", "familyLabel", "frameCount", "repeatCm", "liftPlan", "loomFileName", "lenoSetup", "notes"]);

function rejectUnknown(body: Record<string, unknown>): void {
  const unknown = Object.keys(body).filter((k) => !ALLOWED.has(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan alan: ${unknown.join(", ")}`);
}

/** Armür ızgarası: satır = atkı, sütun = çerçeve, hücre 0/1; tüm satırlar eşit uzunlukta. */
export function parseLiftPlan(raw: unknown): number[][] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0) throw AppError.badRequest("Armür ızgarası boş olmayan bir satır listesi olmalı.", { code: "LIFT_PLAN_INVALID" });
  if (raw.length > LIFT_PLAN_MAX_PICKS) throw AppError.badRequest(`Armür ızgarası en çok ${LIFT_PLAN_MAX_PICKS} atkı satırı olabilir.`, { code: "LIFT_PLAN_INVALID" });
  const width = Array.isArray(raw[0]) ? raw[0].length : 0;
  if (width === 0 || width > LIFT_PLAN_MAX_FRAMES) throw AppError.badRequest(`Armür ızgarası 1–${LIFT_PLAN_MAX_FRAMES} çerçeve genişliğinde olmalı.`, { code: "LIFT_PLAN_INVALID" });
  return raw.map((row, i) => {
    if (!Array.isArray(row) || row.length !== width) throw AppError.badRequest(`Armür ızgarasının ${i + 1}. satırı ${width} hücre olmalı.`, { code: "LIFT_PLAN_INVALID" });
    return row.map((c) => {
      if (c !== 0 && c !== 1) throw AppError.badRequest(`Armür ızgarasının ${i + 1}. satırında yalnız 0/1 olabilir.`, { code: "LIFT_PLAN_INVALID" });
      return c;
    });
  });
}

function parseFrameCount(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > LIFT_PLAN_MAX_FRAMES) throw AppError.badRequest(`Çerçeve sayısı 1–${LIFT_PLAN_MAX_FRAMES} arası tam sayı olmalı.`);
  return n;
}

function requiredText(raw: unknown, label: string, max: number): string {
  const v = parseTextField(raw, label, max);
  if (!v) throw AppError.badRequest(`${label} zorunludur.`);
  return v;
}

function parseScalars(body: Record<string, unknown>, partial: boolean): Prisma.WeaveDesignUncheckedUpdateInput {
  const out: Prisma.WeaveDesignUncheckedUpdateInput = {};
  if (body.code !== undefined || !partial) out.code = requiredText(body.code, "Desen kodu", 32);
  if (body.name !== undefined || !partial) out.name = requiredText(body.name, "Desen adı", 100);
  if (body.kind !== undefined || !partial) {
    if (!(WEAVE_DESIGN_KINDS as readonly unknown[]).includes(body.kind)) throw AppError.badRequest("Örgü türü PLAIN/DOBBY/JACQUARD/LENO olmalı.");
    out.kind = body.kind as WeaveDesignKind;
  }
  const texts: Array<[keyof typeof body & string, string, number]> = [
    ["familyLabel", "Aile etiketi", 40], ["loomFileName", "Tezgâh desen dosyası", 64], ["lenoSetup", "Döner kurulumu", 100], ["notes", "Not", 500],
  ];
  for (const [k, label, max] of texts) {
    const v = parseTextField(body[k], label, max);
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  const frames = parseFrameCount(body.frameCount);
  if (frames !== undefined) out.frameCount = frames;
  const repeat = parseDecimalField(body.repeatCm, { label: "Desen boyu (cm)", min: 0, minExclusive: true, scale: 2 });
  if (repeat !== undefined) out.repeatCm = repeat;
  const plan = parseLiftPlan(body.liftPlan);
  if (plan !== undefined) out.liftPlan = plan === null ? Prisma.DbNull : plan;
  return out;
}

function conflict(e: unknown): never {
  if (isUniqueViolation(e)) throw AppError.conflict("Bu kod ya da adla bir desen kartı zaten var.", { code: "WEAVE_DESIGN_DUPLICATE" });
  throw e;
}

function auditView(r: WeaveDesignRow): Record<string, unknown> {
  return {
    code: r.code, name: r.name, kind: r.kind, familyLabel: r.familyLabel, frameCount: r.frameCount,
    repeatCm: r.repeatCm?.toString() ?? null, loomFileName: r.loomFileName, lenoSetup: r.lenoSetup, notes: r.notes,
    liftPlanSize: Array.isArray(r.liftPlan) ? r.liftPlan.length : null,
  };
}

export async function listWeaveDesigns(opts: { includeInactive?: boolean; search?: string }): Promise<WeaveDesignListRow[]> {
  const s = opts.search?.trim();
  return prisma.weaveDesign.findMany({
    where: {
      AND: [
        opts.includeInactive ? {} : { isActive: true },
        s ? { OR: [{ code: { contains: s, mode: "insensitive" } }, { name: { contains: s, mode: "insensitive" } }, { familyLabel: { contains: s, mode: "insensitive" } }] } : {},
      ],
    },
    select: WEAVE_DESIGN_LIST_SELECT,
    orderBy: [{ code: "asc" }],
  });
}

export async function getWeaveDesign(id: string): Promise<WeaveDesignRow> {
  const row = await prisma.weaveDesign.findUnique({ where: { id }, select: WEAVE_DESIGN_SELECT });
  if (!row) throw AppError.notFound("Desen kartı bulunamadı.");
  return row;
}

export async function createWeaveDesign(body: Record<string, unknown>, userId?: string): Promise<WeaveDesignRow> {
  rejectUnknown(body);
  const data = parseScalars(body, false) as Prisma.WeaveDesignUncheckedCreateInput;
  let row: WeaveDesignRow;
  try {
    row = await prisma.weaveDesign.create({ data: { ...data, createdById: userId ?? null, updatedById: userId ?? null }, select: WEAVE_DESIGN_SELECT });
  } catch (e) {
    conflict(e);
  }
  await AuditService.log({ userId, action: "CREATE", tableName: "WEAVE_DESIGN", recordId: row.id, newData: auditView(row) });
  return row;
}

export async function updateWeaveDesign(id: string, body: Record<string, unknown>, userId?: string): Promise<WeaveDesignRow> {
  rejectUnknown(body);
  const before = await getWeaveDesign(id);
  const data = parseScalars(body, true);
  if (Object.keys(data).length === 0) throw AppError.badRequest("Güncellenecek alan yok.");
  let after: WeaveDesignRow;
  try {
    after = await prisma.weaveDesign.update({ where: { id }, data: { ...data, updatedById: userId ?? null }, select: WEAVE_DESIGN_SELECT });
  } catch (e) {
    conflict(e);
  }
  await AuditService.log({ userId, action: "UPDATE", tableName: "WEAVE_DESIGN", recordId: id, oldData: auditView(before), newData: auditView(after) });
  return after;
}

/** Pasife al — aktif kumaş bağlıyken 409 + liste (MV-06); atomik claim. */
export async function deactivateWeaveDesign(id: string, userId?: string): Promise<{ id: string }> {
  await getWeaveDesign(id);
  // Canlı ürün = arşivlenmemiş (archive-gate emsali); `isActive` kararı yalnız item-usage helper'ında.
  const users = await prisma.item.findMany({ where: { weaveDesignId: id, lifecycleStatus: { not: "ARCHIVED" } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" }, take: 50 });
  if (users.length > 0) {
    throw AppError.conflict(`Desen kartı ${users.length} arşivlenmemiş üründe kullanılıyor — önce ürünlerden kaldırın.`, { code: "WEAVE_DESIGN_IN_USE", items: users });
  }
  const claim = await prisma.weaveDesign.updateMany({ where: { id, isActive: true }, data: { isActive: false, updatedById: userId ?? null } });
  if (claim.count === 0) throw AppError.conflict("Desen kartı zaten pasif.");
  await AuditService.log({ userId, action: "UPDATE", tableName: "WEAVE_DESIGN", recordId: id, oldData: { isActive: true }, newData: { isActive: false } });
  return { id };
}

/** Yeniden aktif et — atomik claim. */
export async function activateWeaveDesign(id: string, userId?: string): Promise<{ id: string }> {
  await getWeaveDesign(id);
  const claim = await prisma.weaveDesign.updateMany({ where: { id, isActive: false }, data: { isActive: true, updatedById: userId ?? null } });
  if (claim.count === 0) throw AppError.conflict("Desen kartı zaten aktif.");
  await AuditService.log({ userId, action: "UPDATE", tableName: "WEAVE_DESIGN", recordId: id, oldData: { isActive: false }, newData: { isActive: true } });
  return { id };
}
