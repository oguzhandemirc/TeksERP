// =============================================================================
// ATKI KARTI (WeftSpec + WeftSpecYarn) — dokuma ürün yapısı çekirdeği (MAL-1, S2 seçenek B)
// =============================================================================
// Çözgü kartının (`warp-spec.service.ts`) atkı ikizi: bir atkı tanımı N kumaşı besler.
// Atkı ipliği TEKİL kolon değil, rapordaki atkı adedi paylı satırlardır (`WeftSpecYarn`) —
// maliyet her ipliği payıyla hesaplar (MALIYET-TEKLIF-PLAN §2.2). İplik satırları ③b SAF
// YAPILANDIRMA PİVOTU: gövde REPLACE edilir, audit'e eski/yeni küme yazılır.
// ⚠️ BaseController KULLANILMAZ: alanlar açıkça sayılır (yeni skaler kolon sessizce yazılabilir
// olmasın). Kart silinmez, pasife alınır (isActive claim).
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { assertItemUsable } from "./helpers/item-usage.helper";
import { isUniqueViolation, parseDecimalField, parseTextField } from "./helpers/cost-input.helper";

export const WEFT_SPEC_SELECT = {
  id: true,
  code: true,
  name: true,
  picksPerCm: true,
  sequenceNote: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
  yarns: {
    select: {
      id: true,
      yarnItemId: true,
      picksInRepeat: true,
      sortOrder: true,
      yarnItem: { select: { id: true, code: true, name: true, linearDensityDen: true } },
    },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.WeftSpecSelect;

export type WeftSpecRow = Prisma.WeftSpecGetPayload<{ select: typeof WEFT_SPEC_SELECT }>;

interface YarnLine {
  yarnItemId: string;
  picksInRepeat: number;
}

const ALLOWED = new Set(["code", "name", "picksPerCm", "sequenceNote", "notes", "yarns"]);

function rejectUnknown(body: Record<string, unknown>): void {
  const unknown = Object.keys(body).filter((k) => !ALLOWED.has(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan alan: ${unknown.join(", ")}`);
}

/** İplik satırları: her biri İPLİK + denyesi dolu + kullanılabilir; aynı iplik iki kez yazılmaz. */
async function parseYarns(raw: unknown): Promise<YarnLine[]> {
  if (!Array.isArray(raw)) throw AppError.badRequest("Atkı iplikleri bir liste olmalı.");
  const lines: YarnLine[] = raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const n = Number(o.picksInRepeat);
    if (typeof o.yarnItemId !== "string" || o.yarnItemId.length === 0) throw AppError.badRequest(`${i + 1}. satır: iplik seçilmedi.`);
    if (!Number.isInteger(n) || n <= 0) throw AppError.badRequest(`${i + 1}. satır: rapordaki atkı adedi sıfırdan büyük bir tam sayı olmalı.`);
    return { yarnItemId: o.yarnItemId, picksInRepeat: n };
  });
  if (new Set(lines.map((l) => l.yarnItemId)).size !== lines.length) {
    throw AppError.badRequest("Aynı iplik atkı kartına iki kez yazılamaz — rapordaki adedini artırın.");
  }
  for (const l of lines) {
    const item = await prisma.item.findUnique({ where: { id: l.yarnItemId }, select: { id: true, name: true, itemType: true, linearDensityDen: true } });
    if (!item) throw AppError.badRequest("Atkı ipliği bulunamadı.");
    if (item.itemType !== ItemType.YARN) throw AppError.badRequest(`"${item.name}" bir İPLİK kalemi değil — atkıya yalnız iplik seçilir.`);
    await assertItemUsable(prisma, item.id, "DEFINITION");
    if (item.linearDensityDen === null) {
      throw AppError.badRequest(`"${item.name}" kaleminin denye değeri boş — atkı ipliği kg hesabı denye olmadan yapılamaz; kalem kartından girin.`);
    }
  }
  return lines;
}

function parseScalars(body: Record<string, unknown>, partial: boolean): Prisma.WeftSpecUncheckedUpdateInput {
  const out: Prisma.WeftSpecUncheckedUpdateInput = {};
  if (body.code !== undefined || !partial) {
    const code = parseTextField(body.code, "Atkı kartı kodu", 32);
    if (!code) throw AppError.badRequest("Atkı kartı kodu zorunludur.");
    out.code = code;
  }
  if (body.name !== undefined || !partial) {
    const name = parseTextField(body.name, "Atkı kartı adı", 100);
    if (!name) throw AppError.badRequest("Atkı kartı adı zorunludur.");
    out.name = name;
  }
  const picks = parseDecimalField(body.picksPerCm, { label: "Atkı sıklığı (atkı/cm)", min: 0, minExclusive: true, scale: 2 });
  if (picks !== undefined) out.picksPerCm = picks;
  const seq = parseTextField(body.sequenceNote, "Sıra notu", 300);
  if (seq !== undefined) out.sequenceNote = seq;
  const notes = parseTextField(body.notes, "Not", 500);
  if (notes !== undefined) out.notes = notes;
  return out;
}

function conflict(e: unknown): never {
  if (isUniqueViolation(e)) throw AppError.conflict("Bu kod ya da adla bir atkı kartı zaten var.", { code: "WEFT_SPEC_DUPLICATE" });
  throw e;
}

export async function listWeftSpecs(opts: { includeInactive?: boolean; search?: string }): Promise<WeftSpecRow[]> {
  const s = opts.search?.trim();
  return prisma.weftSpec.findMany({
    where: {
      AND: [
        opts.includeInactive ? {} : { isActive: true },
        s ? { OR: [{ code: { contains: s, mode: "insensitive" } }, { name: { contains: s, mode: "insensitive" } }] } : {},
      ],
    },
    select: WEFT_SPEC_SELECT,
    orderBy: [{ code: "asc" }],
  });
}

export async function getWeftSpec(id: string): Promise<WeftSpecRow> {
  const row = await prisma.weftSpec.findUnique({ where: { id }, select: WEFT_SPEC_SELECT });
  if (!row) throw AppError.notFound("Atkı kartı bulunamadı.");
  return row;
}

export async function createWeftSpec(body: Record<string, unknown>, userId?: string): Promise<WeftSpecRow> {
  rejectUnknown(body);
  const scalars = parseScalars(body, false) as Prisma.WeftSpecUncheckedCreateInput;
  const yarns = body.yarns === undefined ? [] : await parseYarns(body.yarns);
  let row: WeftSpecRow;
  try {
    row = await prisma.weftSpec.create({
      data: {
        ...scalars,
        createdById: userId ?? null,
        updatedById: userId ?? null,
        yarns: { create: yarns.map((y, i) => ({ yarnItemId: y.yarnItemId, picksInRepeat: y.picksInRepeat, sortOrder: i })) },
      },
      select: WEFT_SPEC_SELECT,
    });
  } catch (e) {
    conflict(e);
  }
  void AuditService.log({
    userId,
    action: "CREATE",
    tableName: "WEFT_SPEC",
    recordId: row.id,
    newData: { code: row.code, name: row.name, picksPerCm: row.picksPerCm?.toString() ?? null, yarns },
  });
  return row;
}

/** Güncelle — `yarns` gönderilirse küme REPLACE edilir (③b; eski/yeni küme audit'te). */
export async function updateWeftSpec(id: string, body: Record<string, unknown>, userId?: string): Promise<WeftSpecRow> {
  rejectUnknown(body);
  const before = await getWeftSpec(id);
  const scalars = parseScalars(body, true);
  const yarns = body.yarns === undefined ? undefined : await parseYarns(body.yarns);
  if (Object.keys(scalars).length === 0 && yarns === undefined) throw AppError.badRequest("Güncellenecek alan yok.");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.weftSpec.update({ where: { id }, data: { ...scalars, updatedById: userId ?? null } });
      if (yarns !== undefined) {
        // ③b saf yapılandırma pivotu: satırlar deftere yazmaz; parasal sonuç maliyet sürümünde donar.
        await tx.weftSpecYarn.deleteMany({ where: { weftSpecId: id } });
        if (yarns.length > 0) {
          await tx.weftSpecYarn.createMany({
            data: yarns.map((y, i) => ({ weftSpecId: id, yarnItemId: y.yarnItemId, picksInRepeat: y.picksInRepeat, sortOrder: i })),
          });
        }
      }
    });
  } catch (e) {
    conflict(e);
  }
  const after = await getWeftSpec(id);
  const view = (r: WeftSpecRow): Record<string, unknown> => ({
    code: r.code,
    name: r.name,
    picksPerCm: r.picksPerCm?.toString() ?? null,
    sequenceNote: r.sequenceNote,
    notes: r.notes,
    yarns: r.yarns.map((y) => ({ yarnItemId: y.yarnItemId, picksInRepeat: y.picksInRepeat })),
  });
  void AuditService.log({ userId, action: "UPDATE", tableName: "WEFT_SPEC", recordId: id, oldData: view(before), newData: view(after) });
  return after;
}

/** Pasife al — kart silinmez (kumaşlar ona işaret eder); atomik claim. */
export async function deactivateWeftSpec(id: string, userId?: string): Promise<{ id: string }> {
  await getWeftSpec(id);
  const claim = await prisma.weftSpec.updateMany({ where: { id, isActive: true }, data: { isActive: false, updatedById: userId ?? null } });
  if (claim.count === 0) throw AppError.conflict("Atkı kartı zaten pasif.");
  void AuditService.log({ userId, action: "UPDATE", tableName: "WEFT_SPEC", recordId: id, oldData: { isActive: true }, newData: { isActive: false } });
  return { id };
}
