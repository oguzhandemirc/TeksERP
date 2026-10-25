// =============================================================================
// K4P-LAB — lab test türü kataloğu (yapılandırma; liste · ekle · düzenle · hazır listeden ekle)
// =============================================================================
// Sonuç satırı birim/sınır/skala snapshot'ı taşıdığı için tür düzenlemesi geçmişi değiştirmez;
// silme yok, pasife alma var. "Hazır listeden ekle" önce önizler (hangi satır zaten var),
// sonra yalnız seçilen ve katalogda OLMAYAN kodları ekler — mevcut tür ezilmez.
// =============================================================================
import { Prisma, type LabResultKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { LAB_TEST_PRESETS } from "../constants/lab-test-presets";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";

export interface LabTestTypeInput {
  code: string;
  name: string;
  method?: string | null;
  resultKind: LabResultKind;
  scaleMax?: number | null;
  unit?: string | null;
  specMin?: number | null;
  specMax?: number | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** Biçim kuralları DB CHECK `lab_test_types_kind_ck` ile aynı; burada Türkçe mesajla önden. */
export function normalizeLabTestType(input: LabTestTypeInput) {
  const passFail = input.resultKind === "PASS_FAIL";
  const scale = input.resultKind === "SCALE";
  const scaleMax = scale ? (input.scaleMax ?? 5) : null;
  if (scaleMax !== null && (scaleMax < 2 || scaleMax > 10)) throw AppError.badRequest("Skala tavanı 2 ile 10 arasında olmalı.", { code: "LAB_TYPE_INVALID" });
  const specMin = passFail ? null : (input.specMin ?? null);
  const specMax = passFail ? null : (input.specMax ?? null);
  if (specMin !== null && specMax !== null && specMin > specMax) throw AppError.badRequest("Alt sınır üst sınırdan büyük olamaz.", { code: "LAB_TYPE_INVALID" });
  return {
    code: input.code.trim().toUpperCase(), name: input.name.trim(), method: input.method?.trim() || null, resultKind: input.resultKind,
    scaleMax, unit: passFail ? null : input.unit?.trim() || null, specMin, specMax, sortOrder: input.sortOrder ?? 0, isActive: input.isActive ?? true,
  };
}

export async function listLabTestTypes(opts: { activeOnly?: boolean } = {}) {
  return prisma.labTestType.findMany({
    where: opts.activeOnly ? { isActive: true } : {},
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
  });
}

function duplicateCode(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw AppError.conflict("Bu kodla bir lab test türü zaten var.", { code: "LAB_TYPE_CODE_TAKEN" });
  }
  throw err;
}

export async function createLabTestType(input: LabTestTypeInput, userId: string) {
  const data = normalizeLabTestType(input);
  const row = await prisma.labTestType.create({ data: { ...data, createdById: userId, updatedById: userId } }).catch(duplicateCode);
  await AuditService.log({ userId, action: "CREATE", tableName: "LAB_TEST_TYPE", recordId: row.id, newData: { code: row.code, resultKind: row.resultKind } });
  return row;
}

export async function updateLabTestType(id: string, input: LabTestTypeInput, userId: string) {
  const data = normalizeLabTestType(input);
  const prior = await prisma.labTestType.findUnique({ where: { id }, select: { code: true, isActive: true } });
  if (!prior) throw AppError.notFound("Lab test türü bulunamadı.", { code: "LAB_TEST_TYPE_NOT_FOUND" });
  const row = await prisma.labTestType.update({ where: { id }, data: { ...data, updatedById: userId } }).catch(duplicateCode);
  await AuditService.log({ userId, action: "UPDATE", tableName: "LAB_TEST_TYPE", recordId: id, oldData: prior, newData: { code: row.code, isActive: row.isActive } });
  return row;
}

/** Önizleme: her hazır satır + katalogda zaten var mı (kod eşleşmesi). */
export async function previewLabTestPresets() {
  const existing = new Set((await prisma.labTestType.findMany({ select: { code: true } })).map((r) => r.code));
  return LAB_TEST_PRESETS.map((p) => ({ ...p, exists: existing.has(p.code) }));
}

export async function addLabTestPresets(codes: readonly string[], userId: string) {
  const unknown = codes.filter((c) => !LAB_TEST_PRESETS.some((p) => p.code === c));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan hazır tür: ${unknown.join(", ")}`, { code: "LAB_PRESET_UNKNOWN" });
  const picked = LAB_TEST_PRESETS.filter((p) => codes.includes(p.code));
  const res = await prisma.labTestType.createMany({
    data: picked.map((p) => ({ ...p, createdById: userId, updatedById: userId })),
    skipDuplicates: true,
  });
  await AuditService.log({ userId, action: "CREATE", tableName: "LAB_TEST_TYPE", recordId: "-", newData: { op: "PRESET_ADD", requested: picked.length, created: res.count } });
  return { requested: picked.length, created: res.count };
}
