// =============================================================================
// K4P-SERT — müşteri lab spesifikasyonu (müşteri × ürün? × test türü → sınır)
// =============================================================================
// Yapılandırmadır: lab sonucu yazımda sınırı SNAPSHOT'lar (`lab_test_results.specMin/Max`), burada
// değişiklik geçmiş testi etkilemez. Çözüm sırası TEK helper `resolveCustomerLabSpec`: müşteri+ürün →
// müşteri geneli → (yoksa) türün varsayılanı. Pasife alma `isActive`; silme yolu yok.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";

export interface CustomerLabSpecInput {
  customerId: string;
  itemId?: string | null;
  testTypeId: string;
  specMin?: number | null;
  specMax?: number | null;
  note?: string | null;
  isActive?: boolean;
}

const SELECT = {
  id: true, customerId: true, itemId: true, testTypeId: true, specMin: true, specMax: true, note: true, isActive: true, updatedAt: true,
  customer: { select: { id: true, code: true, name: true } },
  item: { select: { id: true, code: true, name: true } },
  testType: { select: { id: true, code: true, name: true, unit: true, resultKind: true, scaleMax: true } },
} satisfies Prisma.CustomerLabSpecSelect;

const DUPLICATE = (): AppError =>
  AppError.conflict("Bu müşteri, ürün ve test türü için etkin bir spesifikasyon zaten var; onu düzenleyin.", { code: "CUSTOMER_SPEC_DUPLICATE" });

function bounds(input: Pick<CustomerLabSpecInput, "specMin" | "specMax">) {
  const specMin = input.specMin ?? null;
  const specMax = input.specMax ?? null;
  if (specMin === null && specMax === null) throw AppError.badRequest("En az bir sınır (alt ya da üst) girilmeli.", { code: "CUSTOMER_SPEC_INVALID" });
  if (specMin !== null && specMax !== null && specMin > specMax) throw AppError.badRequest("Alt sınır üst sınırdan büyük olamaz.", { code: "CUSTOMER_SPEC_INVALID" });
  return { specMin, specMax };
}

async function assertRefs(input: CustomerLabSpecInput): Promise<void> {
  const c = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
  const t = await prisma.labTestType.findUnique({ where: { id: input.testTypeId }, select: { resultKind: true } });
  const i = input.itemId ? await prisma.item.findUnique({ where: { id: input.itemId }, select: { id: true } }) : { id: "" };
  if (!c) throw AppError.notFound("Müşteri bulunamadı.", { code: "CUSTOMER_NOT_FOUND" });
  if (!t) throw AppError.notFound("Lab test türü bulunamadı.", { code: "LAB_TEST_TYPE_NOT_FOUND" });
  if (!i) throw AppError.notFound("Ürün bulunamadı.", { code: "ITEM_NOT_FOUND" });
  if (t.resultKind === "PASS_FAIL") throw AppError.badRequest("Geçti/kaldı türünde sayısal sınır tanımlanmaz.", { code: "CUSTOMER_SPEC_INVALID" });
}

const isDup = (err: unknown): boolean => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export async function listCustomerLabSpecs(q: { customerId?: string; itemId?: string; testTypeId?: string; includeInactive?: boolean }) {
  return prisma.customerLabSpec.findMany({
    where: {
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.itemId ? { itemId: q.itemId } : {}),
      ...(q.testTypeId ? { testTypeId: q.testTypeId } : {}),
      ...(q.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ customer: { name: "asc" } }, { testType: { sortOrder: "asc" } }, { id: "asc" }],
    select: SELECT,
  });
}

export async function createCustomerLabSpec(input: CustomerLabSpecInput, userId: string) {
  await assertRefs(input);
  const b = bounds(input);
  try {
    const row = await prisma.customerLabSpec.create({
      data: { customerId: input.customerId, itemId: input.itemId ?? null, testTypeId: input.testTypeId, ...b, note: input.note?.trim() || null, createdById: userId, updatedById: userId },
      select: SELECT,
    });
    await AuditService.log({ userId, action: "CREATE", tableName: "CUSTOMER_LAB_SPEC", recordId: row.id, newData: { customerId: row.customerId, itemId: row.itemId, testTypeId: row.testTypeId, ...b } });
    return row;
  } catch (err) {
    if (isDup(err)) throw DUPLICATE();
    throw err;
  }
}

/** Sınır/not/etkinlik düzenlenir; müşteri-ürün-tür kimliği değişmez (başka kimlik yeni satırdır). */
export async function updateCustomerLabSpec(id: string, patch: Pick<CustomerLabSpecInput, "specMin" | "specMax" | "note" | "isActive">, userId: string) {
  const before = await prisma.customerLabSpec.findUnique({ where: { id }, select: SELECT });
  if (!before) throw AppError.notFound("Spesifikasyon bulunamadı.", { code: "CUSTOMER_SPEC_NOT_FOUND" });
  const b = bounds(patch);
  try {
    const row = await prisma.customerLabSpec.update({
      where: { id },
      data: { ...b, note: patch.note === undefined ? before.note : patch.note?.trim() || null, isActive: patch.isActive ?? before.isActive, updatedById: userId },
      select: SELECT,
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "CUSTOMER_LAB_SPEC", recordId: id,
      oldData: { specMin: before.specMin, specMax: before.specMax, isActive: before.isActive }, newData: { ...b, isActive: row.isActive },
    });
    return row;
  } catch (err) {
    if (isDup(err)) throw DUPLICATE();
    throw err;
  }
}

/** TEK çözüm: etkin müşteri+ürün satırı, yoksa müşteri geneli; ikisi de yoksa null (tür varsayılanı). */
export async function resolveCustomerLabSpec(
  db: Prisma.TransactionClient,
  customerId: string | null,
  itemId: string,
  testTypeId: string,
): Promise<{ id: string; specMin: number | null; specMax: number | null } | null> {
  if (!customerId) return null;
  const rows = await db.customerLabSpec.findMany({
    where: { customerId, testTypeId, isActive: true, OR: [{ itemId }, { itemId: null }] },
    select: { id: true, itemId: true, specMin: true, specMax: true },
  });
  const hit = rows.find((r) => r.itemId === itemId) ?? rows.find((r) => r.itemId === null);
  if (!hit) return null;
  return { id: hit.id, specMin: hit.specMin === null ? null : Number(hit.specMin), specMax: hit.specMax === null ? null : Number(hit.specMax) };
}
