// =============================================================================
// K4P-LAB — lab testi yazım yolu (oluştur · sonuç yaz/sil · onay · iptal · taslak silme)
// =============================================================================
// Lab testi DURUM + onayda donan snapshot'tır (plan §3.4): DRAFT'ta sonuçlar düzenlenir,
// onaydan sonra hiçbir sonuç yazılmaz. Her sonuç yazımı önce ebeveyni
// `updateMany WHERE {id, status:'DRAFT'}` ile atomik olarak talep eder — satır kilidi onayla
// sıraya girer, kaybeden 409 `LAB_TEST_LOCKED` alır. Lab gramajı istasyon gramajından
// (kursun-operation tek yazarı) AYRI kavramdır; buradan topa/istasyona hiçbir şey yazılmaz.
// =============================================================================
import { Prisma, type LabVerdict } from "@prisma/client";
import prisma from "../lib/prisma";
import { factoryDayKeyUtcMidnight, factoryYmd } from "../constants/time";
import { AppError } from "../utils/app-error";
import { p2002TargetsCode, withBarcodeRetry } from "../utils/barcode-retry";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { assertLabValue, resolveLabVerdict, type LabResultSpec } from "./helpers/lab-verdict.helper";
import { nextSeriesNo } from "./number-series.service";
import { getLabTest, type LabTestDetail } from "./lab-test-query.service";

export interface CreateLabTestInput {
  clientToken?: string | null;
  rollId?: string | null;
  batchId?: string | null;
  sampleCode?: string | null;
  labName?: string | null;
  /** YYYY-MM-DD fabrika günü; verilmezse bugün. */
  testedOn?: string | null;
  note?: string | null;
}

export interface LabResultInput {
  testTypeId: string;
  value: number | null;
  verdict?: LabVerdict | null;
  /** Müşteri spesifikasyonu: verilmezse türün varsayılan sınırı; `null` açıkça sınırsız. */
  specMin?: number | null;
  specMax?: number | null;
  note?: string | null;
}

const LOCKED = (): AppError =>
  AppError.conflict("Lab testi onaylanmış ya da iptal edilmiş; sonuçlar artık değiştirilemez.", { code: "LAB_TEST_LOCKED" });
const NOT_FOUND = (): AppError => AppError.notFound("Lab testi bulunamadı.", { code: "LAB_TEST_NOT_FOUND" });

/** Günlük sıralı test numarası; okuma tx içinde — `withBarcodeRetry` her denemede baştan çağırır. */
async function nextLabTestNo(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  return nextSeriesNo("labTest", async (full) => {
    const rows = await tx.labTest.findMany({ where: { testNo: { gte: full, startsWith: full } }, select: { testNo: true, createdAt: true } });
    return rows.map((r) => ({ code: r.testNo, createdAt: r.createdAt }));
  }, date);
}

function parseTestedOn(raw: string | null | undefined): Date {
  if (!raw) return factoryDayKeyUtcMidnight();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.toISOString().slice(0, 10) !== raw) throw AppError.badRequest("Test tarihi geçersiz (YYYY-AA-GG).", { code: "LAB_TESTED_ON_INVALID" });
  if (raw > factoryYmd()) throw AppError.badRequest("Test tarihi bugünden ileri olamaz.", { code: "LAB_TESTED_ON_INVALID" });
  return d;
}

/** Top verildiyse parti ve kumaş TOPTAN snapshot'lanır; yalnız parti verildiyse kumaş iş emrinin hedefinden. */
async function resolveSubject(input: CreateLabTestInput): Promise<{ rollId: string | null; batchId: string | null; itemId: string }> {
  if (!input.rollId && !input.batchId) {
    throw AppError.badRequest("Lab testi bir topa ya da partiye bağlanmalı.", { code: "LAB_SUBJECT_REQUIRED" });
  }
  if (input.rollId) {
    const roll = await prisma.roll.findUnique({ where: { id: input.rollId }, select: { id: true, itemId: true, batchId: true } });
    if (!roll) throw AppError.notFound("Top bulunamadı.", { code: "ROLL_NOT_FOUND" });
    if (input.batchId && roll.batchId !== input.batchId) {
      throw AppError.badRequest("Seçilen top bu partiye ait değil.", { code: "LAB_SUBJECT_MISMATCH" });
    }
    return { rollId: roll.id, batchId: roll.batchId, itemId: roll.itemId };
  }
  const batch = await prisma.batch.findUnique({
    where: { id: input.batchId! },
    select: { id: true, workOrder: { select: { targetItemId: true } }, rolls: { distinct: ["itemId"], select: { itemId: true }, take: 2 } },
  });
  if (!batch) throw AppError.notFound("Parti bulunamadı.", { code: "BATCH_NOT_FOUND" });
  const itemId = batch.workOrder.targetItemId ?? (batch.rolls.length === 1 ? batch.rolls[0]!.itemId : null);
  if (!itemId) throw AppError.badRequest("Partinin kumaşı belirlenemedi; testi bir topa bağlayın.", { code: "LAB_ITEM_UNRESOLVED" });
  return { rollId: null, batchId: batch.id, itemId };
}

function replayFor(input: CreateLabTestInput) {
  return tokenReplay<{ id: string; rollId: string | null; batchId: string | null; status: string; testNo: string }, LabTestDetail>({
    find: (db, clientToken) => db.labTest.findUnique({ where: { clientToken }, select: { id: true, rollId: true, batchId: true, status: true, testNo: true } }),
    alive: (p) => {
      if (p.status === "VOIDED") throw AppError.conflict(`Lab testi ${p.testNo} iptal edilmiş; yeni test açın.`, { code: "LAB_TEST_VOIDED" });
    },
    identity: (p) => [
      { ad: "rollId", mevcut: p.rollId, gelen: input.rollId ?? null },
      { ad: "batchId", mevcut: input.batchId ? p.batchId : null, gelen: input.batchId ?? null },
    ],
    collision: "Bu işlem kimliği başka bir lab testine ait; formu yeniden gönderin.",
    respond: (p) => getLabTest(p.id),
  });
}

export async function createLabTest(input: CreateLabTestInput, userId: string): Promise<LabTestDetail> {
  return replayFor(input).run(input.clientToken, async () => {
    const subject = await resolveSubject(input);
    const testedOn = parseTestedOn(input.testedOn);
    const now = new Date();
    const row = await withBarcodeRetry(
      () => prisma.$transaction(async (tx) => {
        const testNo = await nextLabTestNo(tx, now);
        return tx.labTest.create({
          data: {
            testNo, ...subject, testedOn, clientToken: input.clientToken ?? null,
            sampleCode: input.sampleCode?.trim() || null, labName: input.labName?.trim() || null, note: input.note?.trim() || null,
            createdById: userId, updatedById: userId,
          },
          select: { id: true, testNo: true },
        });
      }),
      undefined,
      (err) => p2002TargetsCode(err, "testNo"),
      "Lab test numarası",
    );
    await AuditService.log({ userId, action: "CREATE", tableName: "LAB_TEST", recordId: row.id, newData: { testNo: row.testNo, rollId: subject.rollId, batchId: subject.batchId } });
    return getLabTest(row.id);
  });
}

/** Ebeveyni DRAFT koşuluyla talep eder (satır kilidi onayla sıraya girer); kaybeden 404/409. */
async function claimDraftTx(tx: Prisma.TransactionClient, labTestId: string, userId: string): Promise<void> {
  const claimed = await tx.labTest.updateMany({ where: { id: labTestId, status: "DRAFT" }, data: { updatedById: userId } });
  if (claimed.count === 1) return;
  const exists = await tx.labTest.findUnique({ where: { id: labTestId }, select: { id: true } });
  throw exists ? LOCKED() : NOT_FOUND();
}

async function resolveResultSpec(input: LabResultInput): Promise<LabResultSpec & { unit: string | null }> {
  const t = await prisma.labTestType.findUnique({ where: { id: input.testTypeId } });
  if (!t) throw AppError.notFound("Lab test türü bulunamadı.", { code: "LAB_TEST_TYPE_NOT_FOUND" });
  const pick = (v: number | null | undefined, d: Prisma.Decimal | null): number | null => (v === undefined ? (d === null ? null : Number(d)) : v);
  const passFail = t.resultKind === "PASS_FAIL";
  const spec = {
    resultKind: t.resultKind, scaleMax: t.scaleMax, unit: passFail ? null : t.unit,
    specMin: passFail ? null : pick(input.specMin, t.specMin), specMax: passFail ? null : pick(input.specMax, t.specMax),
  };
  if (spec.specMin !== null && spec.specMax !== null && spec.specMin > spec.specMax) {
    throw AppError.badRequest("Alt sınır üst sınırdan büyük olamaz.", { code: "LAB_SPEC_INVALID" });
  }
  return spec;
}

export async function upsertLabResult(labTestId: string, input: LabResultInput, userId: string): Promise<LabTestDetail> {
  const spec = await resolveResultSpec(input);
  assertLabValue(spec, input.value);
  const outcome = resolveLabVerdict(spec, input.value, input.verdict ?? null);
  const data = {
    resultKind: spec.resultKind, scaleMax: spec.scaleMax, unit: spec.unit, specMin: spec.specMin, specMax: spec.specMax,
    value: input.value, ...outcome, note: input.note?.trim() || null,
  };
  await prisma.$transaction(async (tx) => {
    await claimDraftTx(tx, labTestId, userId);
    await tx.labTestResult.upsert({
      where: { labTestId_testTypeId: { labTestId, testTypeId: input.testTypeId } },
      create: { labTestId, testTypeId: input.testTypeId, ...data },
      update: data,
    });
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: "LAB_TEST", recordId: labTestId, newData: { op: "RESULT_SAVE", testTypeId: input.testTypeId, verdict: outcome.verdict, verdictSource: outcome.verdictSource } });
  return getLabTest(labTestId);
}

export async function deleteLabResult(labTestId: string, testTypeId: string, userId: string): Promise<LabTestDetail> {
  const removed = await prisma.$transaction(async (tx) => {
    await claimDraftTx(tx, labTestId, userId);
    return (await tx.labTestResult.deleteMany({ where: { labTestId, testTypeId } })).count;
  });
  if (removed === 0) throw AppError.notFound("Bu türde sonuç yok.", { code: "LAB_RESULT_NOT_FOUND" });
  await AuditService.log({ userId, action: "UPDATE", tableName: "LAB_TEST", recordId: labTestId, newData: { op: "RESULT_DELETE", testTypeId } });
  return getLabTest(labTestId);
}

export async function approveLabTest(labTestId: string, userId: string): Promise<LabTestDetail> {
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.labTest.updateMany({
      where: { id: labTestId, status: "DRAFT" },
      data: { status: "APPROVED", approvedAt: now, approvedById: userId, updatedById: userId },
    });
    if (claimed.count === 0) {
      const exists = await tx.labTest.findUnique({ where: { id: labTestId }, select: { id: true } });
      throw exists ? LOCKED() : NOT_FOUND();
    }
    // Sayım talepten SONRA: aynı anda son sonucu silen yazar ya önce bitti (burada 0 görülür) ya bekliyor.
    if ((await tx.labTestResult.count({ where: { labTestId } })) === 0) {
      throw AppError.badRequest("Sonuçsuz lab testi onaylanamaz.", { code: "LAB_TEST_EMPTY" });
    }
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: "LAB_TEST", recordId: labTestId, oldData: { status: "DRAFT" }, newData: { status: "APPROVED" } });
  return getLabTest(labTestId);
}

export async function voidLabTest(labTestId: string, reason: string, userId: string): Promise<LabTestDetail> {
  const voidReason = reason.trim();
  if (voidReason.length < 3) throw AppError.badRequest("İptal gerekçesi en az 3 karakter olmalı.", { code: "LAB_VOID_REASON_REQUIRED" });
  const claimed = await prisma.labTest.updateMany({
    where: { id: labTestId, status: { in: ["DRAFT", "APPROVED"] } },
    data: { status: "VOIDED", voidedAt: new Date(), voidedById: userId, voidReason, updatedById: userId },
  });
  if (claimed.count === 0) {
    const exists = await prisma.labTest.findUnique({ where: { id: labTestId }, select: { id: true } });
    throw exists ? AppError.conflict("Lab testi zaten iptal edilmiş.", { code: "LAB_TEST_ALREADY_VOIDED" }) : NOT_FOUND();
  }
  await AuditService.log({ userId, action: "UPDATE", tableName: "LAB_TEST", recordId: labTestId, newData: { status: "VOIDED", reasonLength: voidReason.length } });
  return getLabTest(labTestId);
}

/**
 * Hard delete YALNIZ DRAFT'ta — defter.md sınıfı "deftere hiç yazmamış taslak": onaylanmamış test
 * hiçbir rapora/sayıya girmez. Onaylı ya da iptal edilmiş test silinmez (iptal damgası ters yoldur).
 */
export async function deleteDraftLabTest(labTestId: string, userId: string): Promise<{ id: string; testNo: string }> {
  const prior = await prisma.labTest.findUnique({ where: { id: labTestId }, select: { id: true, testNo: true, _count: { select: { results: true } } } });
  if (!prior) throw NOT_FOUND();
  const removed = await prisma.labTest.deleteMany({ where: { id: labTestId, status: "DRAFT" } });
  if (removed.count === 0) {
    throw AppError.conflict("Yalnız taslak lab testi silinebilir; onaylı testi iptal edin.", { code: "LAB_TEST_NOT_DRAFT" });
  }
  await AuditService.log({ userId, action: "DELETE", tableName: "LAB_TEST", recordId: labTestId, oldData: { testNo: prior.testNo, resultCount: prior._count.results } });
  return { id: prior.id, testNo: prior.testNo };
}
