// =============================================================================
// DESEN KARTI (WeaveDesign) — armür/örgü kataloğu (Seyitoğlu SY-A2, tasarım §2.4)
// =============================================================================
// Desen no = satılan ürünün kodu (K1); bu katalog yalnız örgü bilgisini taşır (tür, çerçeve,
// desen boyu, armür ızgarası, tezgâh dosya adı) ve `Item.weaveDesignId` ile bağlanır. Sıklık
// atkı kartında, en üründe kalır — ikinci kopya yok. Kart silinmez, pasife alınır; aktif ürün
// bağlıyken pasif 409 (MV-06). BaseController KULLANILMAZ: alanlar açıkça sayılır.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { isUniqueViolation, parseDecimalField, parseTextField } from "./helpers/cost-input.helper";
import { assertDrawingInMechanism, assertMechanismEnabled, parseDrawingInType } from "./helpers/weave-design-gates.helper";
import { LIFT_PLAN_MAX_FRAMES, LIFT_PLAN_MAX_PICKS, WEAVE_DESIGN_KINDS } from "../constants/weave-design";
import {
  KIND_TO_CLASS,
  kindFromClass,
  mechanismUsesHooks,
  mechanismUsesLiftPlan,
  resolveWeaveClass,
  WEAVE_SHED_MECHANISMS,
  WEAVE_STRUCTURES,
  type WeaveClass,
  type WeaveKindValue,
} from "../constants/weave-classification";

export const WEAVE_DESIGN_SELECT = {
  id: true,
  code: true,
  name: true,
  kind: true,
  shedMechanism: true,
  weaveStructure: true,
  hookCount: true,
  repeatWidthCm: true,
  familyLabel: true,
  frameCount: true,
  repeatCm: true,
  liftPlan: true,
  loomFileName: true,
  lenoSetup: true,
  lenoFrames: true,
  selvedgeFrames: true,
  drawingInNote: true,
  drawingInType: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
  image: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, updatedAt: true } },
} satisfies Prisma.WeaveDesignSelect;

/** Listede ızgara taşınmaz (JSON büyük olabilir); detayda gelir. */
const WEAVE_DESIGN_LIST_SELECT = { ...WEAVE_DESIGN_SELECT, liftPlan: false } satisfies Prisma.WeaveDesignSelect;

type RawRow = Prisma.WeaveDesignGetPayload<{ select: typeof WEAVE_DESIGN_SELECT }>;
type RawListRow = Prisma.WeaveDesignGetPayload<{ select: typeof WEAVE_DESIGN_LIST_SELECT }>;
/** Yanıt: sınıflama HER ZAMAN çözülmüş (yeni alan boş eski satırda `kind`dan türetilir). */
export type WeaveDesignRow = Omit<RawRow, "shedMechanism" | "weaveStructure"> & WeaveClass;
export type WeaveDesignListRow = Omit<RawListRow, "shedMechanism" | "weaveStructure"> & WeaveClass;

function present<T extends { kind: string; shedMechanism: string | null; weaveStructure: string | null }>(r: T): Omit<T, "shedMechanism" | "weaveStructure"> & WeaveClass {
  return { ...r, ...resolveWeaveClass(r) };
}

const ALLOWED = new Set([
  "code", "name", "kind", "shedMechanism", "weaveStructure", "hookCount", "repeatWidthCm", "familyLabel", "frameCount", "repeatCm",
  "liftPlan", "loomFileName", "lenoSetup", "lenoFrames", "selvedgeFrames", "drawingInNote", "drawingInType", "notes",
]);

function rejectUnknown(body: Record<string, unknown>): void {
  const unknown = Object.keys(body).filter((k) => !ALLOWED.has(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan alan: ${unknown.join(", ")}`);
}

/** Armür ızgarası: satır = atkı, sütun = çerçeve, hücre 0/1; tüm satırlar eşit uzunlukta. */
export function parseLiftPlan(raw: unknown): number[][] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0) throw AppError.badRequest("Desen örgüsü boş olmayan bir satır listesi olmalı.", { code: "LIFT_PLAN_INVALID" });
  if (raw.length > LIFT_PLAN_MAX_PICKS) throw AppError.badRequest(`Desen örgüsü en çok ${LIFT_PLAN_MAX_PICKS} atkı satırı olabilir.`, { code: "LIFT_PLAN_INVALID" });
  const width = Array.isArray(raw[0]) ? raw[0].length : 0;
  if (width === 0 || width > LIFT_PLAN_MAX_FRAMES) throw AppError.badRequest(`Desen örgüsü 1–${LIFT_PLAN_MAX_FRAMES} çerçeve genişliğinde olmalı.`, { code: "LIFT_PLAN_INVALID" });
  return raw.map((row, i) => {
    if (!Array.isArray(row) || row.length !== width) throw AppError.badRequest(`Desen örgüsünün ${i + 1}. satırı ${width} hücre olmalı.`, { code: "LIFT_PLAN_INVALID" });
    return row.map((c) => {
      if (c !== 0 && c !== 1) throw AppError.badRequest(`Desen örgüsünün ${i + 1}. satırında yalnız 0/1 olabilir.`, { code: "LIFT_PLAN_INVALID" });
      return c;
    });
  });
}

/** Çerçeve no listesi (döner/kenar): 1-tabanlı; tekil + sıralı normalize edilir (DB CHECK 1..32 ikizi). */
function parseFrameList(raw: unknown, label: "Döner" | "Kenar", code: string): number[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw AppError.badRequest(`${label} çerçeveleri çerçeve numarası listesi olmalı.`, { code });
  const seen = new Set<number>();
  for (const v of raw) {
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > LIFT_PLAN_MAX_FRAMES) {
      throw AppError.badRequest(`${label} çerçeve numarası 1–${LIFT_PLAN_MAX_FRAMES} arası tam sayı olmalı.`, { code });
    }
    if (seen.has(v as number)) throw AppError.badRequest(`${label} çerçeve ${String(v)} iki kez yazılmış.`, { code });
    seen.add(v as number);
  }
  return [...seen].sort((a, b) => a - b);
}

export const parseLenoFrames = (raw: unknown): number[] | undefined => parseFrameList(raw, "Döner", "LENO_FRAMES_INVALID");
export const parseSelvedgeFrames = (raw: unknown): number[] | undefined => parseFrameList(raw, "Kenar", "SELVEDGE_FRAMES_INVALID");

/** Bir çerçeve hem döner hem kenar olamaz (DB `weave_designs_selvedge_leno_disjoint_chk` ikizi); yazım sonrası değerle bakılır. */
function assertFrameRoles(out: Prisma.WeaveDesignUncheckedUpdateInput, current: RawRow | null): void {
  if (out.lenoFrames === undefined && out.selvedgeFrames === undefined) return;
  const leno = (out.lenoFrames as number[] | undefined) ?? current?.lenoFrames ?? [];
  const selvedge = (out.selvedgeFrames as number[] | undefined) ?? current?.selvedgeFrames ?? [];
  const both = selvedge.filter((f) => leno.includes(f));
  if (both.length > 0) {
    throw AppError.badRequest(`Çerçeve ${both.join(", ")} hem döner hem kenar olamaz — birini seçin.`, { code: "WEAVE_DESIGN_FRAME_ROLE_CONFLICT", frames: both });
  }
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

type ClassData = Pick<Prisma.WeaveDesignUncheckedUpdateInput, "kind" | "shedMechanism" | "weaveStructure">;

/**
 * Sınıflama yazımı (çift yazım): yeni eksen gelirse `kind` ondan türetilir; yalnız `kind` gelirse (eski istemci)
 * ve DEĞİŞTİYSE yeni eksenler ondan türetilir. İkisi birlikte gelip çelişirse 400. `effective` = yazım sonrası sınıf.
 */
function classWrite(body: Record<string, unknown>, current: RawRow | null): { data: ClassData; effective: WeaveClass } {
  const hasMech = body.shedMechanism !== undefined;
  const hasStruct = body.weaveStructure !== undefined;
  const hasKind = body.kind !== undefined;
  if (hasKind && !(WEAVE_DESIGN_KINDS as readonly unknown[]).includes(body.kind)) throw AppError.badRequest("Örgü türü PLAIN/DOBBY/JACQUARD/LENO olmalı.");
  if (hasMech && !(WEAVE_SHED_MECHANISMS as readonly unknown[]).includes(body.shedMechanism)) {
    throw AppError.badRequest("Mekanizma Eksantrik/Armür/Jakar (CAM/DOBBY/JACQUARD) olmalı.", { code: "WEAVE_DESIGN_MECHANISM_INVALID" });
  }
  if (hasStruct && body.weaveStructure !== null && !(WEAVE_STRUCTURES as readonly unknown[]).includes(body.weaveStructure)) {
    throw AppError.badRequest("Örgü Bezayağı/Dimi/Saten/Döner/Diğer ya da boş olmalı.", { code: "WEAVE_DESIGN_STRUCTURE_INVALID" });
  }
  const base = current ? resolveWeaveClass(current) : null;
  if (hasMech || hasStruct) {
    const shedMechanism = (body.shedMechanism ?? base?.shedMechanism) as WeaveClass["shedMechanism"] | undefined;
    if (!shedMechanism) throw AppError.badRequest("Mekanizma zorunludur.", { code: "WEAVE_DESIGN_MECHANISM_REQUIRED" });
    const weaveStructure = (hasStruct ? body.weaveStructure : base?.weaveStructure ?? null) as WeaveClass["weaveStructure"];
    const effective = { shedMechanism, weaveStructure };
    const kind = kindFromClass(effective);
    if (hasKind && body.kind !== kind) {
      throw AppError.badRequest(`Örgü türü (${String(body.kind)}) seçilen mekanizma/örgüyle çelişiyor.`, { code: "WEAVE_DESIGN_KIND_CONFLICT" });
    }
    return { data: { kind, shedMechanism, weaveStructure }, effective };
  }
  if (hasKind) {
    if (current && base && current.kind === body.kind) return { data: {}, effective: base };
    const effective = KIND_TO_CLASS[body.kind as WeaveKindValue];
    return { data: { kind: body.kind as WeaveKindValue, ...effective }, effective };
  }
  if (!base) throw AppError.badRequest("Mekanizma zorunludur.", { code: "WEAVE_DESIGN_MECHANISM_REQUIRED" });
  return { data: {}, effective: base };
}

/** Mekanizmaya ait olmayan alan YAZILMAZ (saklı eski değer silinmez; okuyucular görmez). */
function assertMechanismFields(out: Prisma.WeaveDesignUncheckedUpdateInput, effective: WeaveClass): void {
  if (out.liftPlan !== undefined && out.liftPlan !== Prisma.DbNull && !mechanismUsesLiftPlan(effective.shedMechanism)) {
    throw AppError.badRequest("Desen örgüsü yalnız Armür mekanizmalı desende girilir.", { code: "WEAVE_DESIGN_LIFT_PLAN_DOBBY_ONLY" });
  }
  if (Array.isArray(out.selvedgeFrames) && out.selvedgeFrames.length > 0 && !mechanismUsesLiftPlan(effective.shedMechanism)) {
    throw AppError.badRequest("Kenar çerçevesi yalnız Armür mekanizmalı desende işaretlenir.", { code: "WEAVE_DESIGN_SELVEDGE_DOBBY_ONLY" });
  }
  if (out.hookCount !== undefined && out.hookCount !== null && !mechanismUsesHooks(effective.shedMechanism)) {
    throw AppError.badRequest("Kanca sayısı yalnız Jakar desende girilir.", { code: "WEAVE_DESIGN_HOOKS_JACQUARD_ONLY" });
  }
}

function parseHookCount(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 30000) throw AppError.badRequest("Kanca sayısı 1–30000 arası tam sayı olmalı.");
  return n;
}

function parseScalars(body: Record<string, unknown>, partial: boolean, current: RawRow | null): Prisma.WeaveDesignUncheckedUpdateInput {
  const out: Prisma.WeaveDesignUncheckedUpdateInput = {};
  if (body.code !== undefined || !partial) out.code = requiredText(body.code, "Desen kodu", 32);
  if (body.name !== undefined || !partial) out.name = requiredText(body.name, "Desen adı", 100);
  const cls = classWrite(body, current);
  Object.assign(out, cls.data);
  const hooks = parseHookCount(body.hookCount);
  if (hooks !== undefined) out.hookCount = hooks;
  const repeatWidth = parseDecimalField(body.repeatWidthCm, { label: "Desen rapor eni (cm)", min: 0, minExclusive: true, scale: 2 });
  if (repeatWidth !== undefined) out.repeatWidthCm = repeatWidth;
  const texts: Array<[keyof typeof body & string, string, number]> = [
    ["familyLabel", "Aile etiketi", 40], ["loomFileName", "Tezgâh desen dosyası", 64], ["lenoSetup", "Döner kurulumu", 100],
    ["drawingInNote", "Tahar düzeni", 300], ["notes", "Not", 500],
  ];
  for (const [k, label, max] of texts) {
    const v = parseTextField(body[k], label, max);
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  const frames = parseFrameCount(body.frameCount);
  if (frames !== undefined) out.frameCount = frames;
  const repeat = parseDecimalField(body.repeatCm, { label: "Desen rapor boyu (cm)", min: 0, minExclusive: true, scale: 2 });
  if (repeat !== undefined) out.repeatCm = repeat;
  const plan = parseLiftPlan(body.liftPlan);
  if (plan !== undefined) out.liftPlan = plan === null ? Prisma.DbNull : plan;
  const leno = parseLenoFrames(body.lenoFrames);
  if (leno !== undefined) out.lenoFrames = leno;
  const selvedge = parseSelvedgeFrames(body.selvedgeFrames);
  if (selvedge !== undefined) out.selvedgeFrames = selvedge;
  const drawingInType = parseDrawingInType(body.drawingInType);
  if (drawingInType !== undefined) out.drawingInType = drawingInType;
  assertDrawingInMechanism(drawingInType, cls.effective.shedMechanism);
  assertMechanismFields(out, cls.effective);
  assertFrameRoles(out, current);
  return out;
}

function conflict(e: unknown): never {
  if (isUniqueViolation(e)) throw AppError.conflict("Bu kod ya da adla bir desen kartı zaten var.", { code: "WEAVE_DESIGN_DUPLICATE" });
  throw e;
}

function auditView(r: RawRow): Record<string, unknown> {
  return {
    code: r.code, name: r.name, kind: r.kind, shedMechanism: r.shedMechanism, weaveStructure: r.weaveStructure,
    hookCount: r.hookCount, repeatWidthCm: r.repeatWidthCm?.toString() ?? null, familyLabel: r.familyLabel, frameCount: r.frameCount,
    repeatCm: r.repeatCm?.toString() ?? null, loomFileName: r.loomFileName, lenoSetup: r.lenoSetup, lenoFrames: r.lenoFrames, selvedgeFrames: r.selvedgeFrames, drawingInNote: r.drawingInNote, drawingInType: r.drawingInType, notes: r.notes,
    liftPlanSize: Array.isArray(r.liftPlan) ? r.liftPlan.length : null,
  };
}

export async function listWeaveDesigns(opts: { includeInactive?: boolean; search?: string }): Promise<WeaveDesignListRow[]> {
  const s = opts.search?.trim();
  const rows = await prisma.weaveDesign.findMany({
    where: {
      AND: [
        opts.includeInactive ? {} : { isActive: true },
        s ? { OR: [{ code: { contains: s, mode: "insensitive" } }, { name: { contains: s, mode: "insensitive" } }, { familyLabel: { contains: s, mode: "insensitive" } }] } : {},
      ],
    },
    select: WEAVE_DESIGN_LIST_SELECT,
    orderBy: [{ code: "asc" }],
  });
  return rows.map(present);
}

async function getRaw(id: string): Promise<RawRow> {
  const row = await prisma.weaveDesign.findUnique({ where: { id }, select: WEAVE_DESIGN_SELECT });
  if (!row) throw AppError.notFound("Desen kartı bulunamadı.");
  return row;
}

export async function getWeaveDesign(id: string): Promise<WeaveDesignRow> {
  return present(await getRaw(id));
}

export async function createWeaveDesign(body: Record<string, unknown>, userId?: string): Promise<WeaveDesignRow> {
  rejectUnknown(body);
  const data = parseScalars(body, false, null) as Prisma.WeaveDesignUncheckedCreateInput;
  await assertMechanismEnabled(data.shedMechanism ?? undefined, null);
  let row: RawRow;
  try {
    row = await prisma.weaveDesign.create({ data: { ...data, createdById: userId ?? null, updatedById: userId ?? null }, select: WEAVE_DESIGN_SELECT });
  } catch (e) {
    conflict(e);
  }
  await AuditService.log({ userId, action: "CREATE", tableName: "WEAVE_DESIGN", recordId: row.id, newData: auditView(row) });
  return present(row);
}

export async function updateWeaveDesign(id: string, body: Record<string, unknown>, userId?: string): Promise<WeaveDesignRow> {
  rejectUnknown(body);
  const before = await getRaw(id);
  const data = parseScalars(body, true, before);
  if (Object.keys(data).length === 0) throw AppError.badRequest("Güncellenecek alan yok.");
  await assertMechanismEnabled(data.shedMechanism as WeaveClass["shedMechanism"] | undefined, resolveWeaveClass(before).shedMechanism);
  let after: RawRow;
  try {
    after = await prisma.weaveDesign.update({ where: { id }, data: { ...data, updatedById: userId ?? null }, select: WEAVE_DESIGN_SELECT });
  } catch (e) {
    conflict(e);
  }
  await AuditService.log({ userId, action: "UPDATE", tableName: "WEAVE_DESIGN", recordId: id, oldData: auditView(before), newData: auditView(after) });
  return present(after);
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
