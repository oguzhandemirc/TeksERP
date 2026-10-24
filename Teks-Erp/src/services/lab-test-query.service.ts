// =============================================================================
// K4P-LAB — lab testi okuma yolu (ayrıntı · liste + cursor + özet şeridi · iptal önizlemesi)
// =============================================================================
// Liste, cursor ve özet şeridi TEK where'den (`buildLabTestWhere`) doğar — şerit tabloyla
// çelişmez. Id süzgeçleri `readIdCondition`dan; `testedOn` fabrika günüdür (DATE kolon,
// karşılaştırma YYYY-MM-DD anahtarıyla — dilim dönüşümü yok).
// =============================================================================
import { Prisma, type LabTestStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../utils/cursor";
import { readFilterList, readIdCondition } from "../utils/query-parser";

const USER = { select: { id: true, fullName: true } } as const;

const DETAIL_SELECT = {
  id: true, testNo: true, rollId: true, batchId: true, itemId: true, sampleCode: true, labName: true, testedOn: true, note: true,
  status: true, approvedAt: true, voidedAt: true, voidReason: true, createdAt: true, updatedAt: true,
  roll: { select: { id: true, barcode: true } },
  batch: { select: { id: true, batchNumber: true } },
  item: { select: { id: true, code: true, name: true } },
  approvedBy: USER, voidedBy: USER, createdBy: USER,
  results: {
    orderBy: [{ testType: { sortOrder: "asc" } }, { createdAt: "asc" }],
    select: {
      id: true, testTypeId: true, resultKind: true, scaleMax: true, value: true, unit: true, specMin: true, specMax: true,
      verdict: true, verdictSource: true, note: true, updatedAt: true,
      testType: { select: { code: true, name: true, method: true } },
    },
  },
} satisfies Prisma.LabTestSelect;

export type LabTestDetail = Prisma.LabTestGetPayload<{ select: typeof DETAIL_SELECT }>;

export async function getLabTest(id: string): Promise<LabTestDetail> {
  const row = await prisma.labTest.findUnique({ where: { id }, select: DETAIL_SELECT });
  if (!row) throw AppError.notFound("Lab testi bulunamadı.", { code: "LAB_TEST_NOT_FOUND" });
  return row;
}

export interface LabTestListQuery {
  status?: string | string[];
  itemId?: string | string[];
  rollId?: string | string[];
  batchId?: string | string[];
  /** Top detay kartı: topun kendi testleri + partisinin parti düzeyi testleri. */
  forRollId?: string;
  from?: string;
  to?: string;
  q?: string;
  verdict?: "FAIL";
  cursor?: string;
  limit?: number;
}

const STATUSES: readonly LabTestStatus[] = ["DRAFT", "APPROVED", "VOIDED"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayKey(raw: string | undefined, label: string): Date | undefined {
  if (!raw) return undefined;
  if (!DAY.test(raw)) throw AppError.badRequest(`${label} tarihi geçersiz (YYYY-AA-GG).`, { code: "LAB_FILTER_INVALID" });
  return new Date(`${raw}T00:00:00.000Z`);
}

export async function buildLabTestWhere(q: LabTestListQuery): Promise<Prisma.LabTestWhereInput> {
  const and: Prisma.LabTestWhereInput[] = [];
  const statuses = readFilterList(q.status);
  const unknown = statuses.filter((s) => !STATUSES.includes(s as LabTestStatus));
  if (unknown.length > 0) throw AppError.badRequest("Tanınmayan durum süzgeci.", { code: "LAB_FILTER_INVALID" });
  if (statuses.length > 0) and.push({ status: { in: statuses as LabTestStatus[] } });
  const itemId = readIdCondition(q.itemId);
  if (itemId) and.push({ itemId });
  const rollId = readIdCondition(q.rollId);
  if (rollId) and.push({ rollId });
  const batchId = readIdCondition(q.batchId);
  if (batchId) and.push({ batchId });
  if (q.forRollId) {
    const roll = await prisma.roll.findUnique({ where: { id: q.forRollId }, select: { batchId: true } });
    and.push({ OR: [{ rollId: q.forRollId }, ...(roll?.batchId ? [{ rollId: null, batchId: roll.batchId }] : [])] });
  }
  const from = dayKey(q.from, "Başlangıç");
  const to = dayKey(q.to, "Bitiş");
  if (from || to) and.push({ testedOn: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
  const term = q.q?.trim();
  if (term) and.push({ OR: [{ testNo: { contains: term, mode: "insensitive" } }, { sampleCode: { contains: term, mode: "insensitive" } }] });
  if (q.verdict === "FAIL") and.push({ results: { some: { verdict: "FAIL" } } });
  return and.length > 0 ? { AND: and } : {};
}

const LIST_SELECT = {
  id: true, testNo: true, testedOn: true, status: true, sampleCode: true, labName: true, createdAt: true,
  roll: { select: { id: true, barcode: true } },
  batch: { select: { id: true, batchNumber: true } },
  item: { select: { id: true, code: true, name: true } },
  _count: { select: { results: true } },
} satisfies Prisma.LabTestSelect;

export async function listLabTests(q: LabTestListQuery) {
  const where = await buildLabTestWhere(q);
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const cursor = decodeCursor(q.cursor);
  if (q.cursor && !cursor) throw AppError.badRequest("Geçersiz sayfa imleci.", { code: "LAB_FILTER_INVALID" });
  const rows = await prisma.labTest.findMany({
    where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: LIST_SELECT,
  });
  const page = rows.slice(0, limit);
  const failIds = new Set(
    (await prisma.labTestResult.findMany({ where: { labTestId: { in: page.map((r) => r.id) }, verdict: "FAIL" }, select: { labTestId: true } }))
      .map((r) => r.labTestId),
  );
  return {
    items: page.map((r) => ({ ...r, resultCount: r._count.results, hasFail: failIds.has(r.id) })),
    nextCursor: rows.length > limit ? buildNextCursor(page[page.length - 1]) : null,
    summary: await summarizeLabTests(where),
  };
}

/** Özet şeridi — listeyle AYNI where; kaldı sayımı iptal edilenleri dışlar. */
export async function summarizeLabTests(where: Prisma.LabTestWhereInput) {
  const groups = await prisma.labTest.groupBy({ by: ["status"], where, _count: { _all: true } });
  const by = (s: LabTestStatus): number => groups.find((g) => g.status === s)?._count._all ?? 0;
  const failing = await prisma.labTest.count({ where: { AND: [where, { status: { not: "VOIDED" } }, { results: { some: { verdict: "FAIL" } } }] } });
  return { total: by("DRAFT") + by("APPROVED") + by("VOIDED"), draft: by("DRAFT"), approved: by("APPROVED"), voided: by("VOIDED"), failing };
}

/** İptal önizlemesi: etkilenen tek kayıt + sonuçları listelenir (yıkıcı işlem kuralı). */
export async function voidPreviewLabTest(id: string) {
  const test = await getLabTest(id);
  if (test.status === "VOIDED") throw AppError.conflict("Lab testi zaten iptal edilmiş.", { code: "LAB_TEST_ALREADY_VOIDED" });
  return { test, resultCount: test.results.length, wasApproved: test.status === "APPROVED" };
}
