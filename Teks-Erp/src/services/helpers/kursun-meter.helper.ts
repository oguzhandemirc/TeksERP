// =============================================================================
// KURŞUN METRE DEFTERİ (H1) — okuma yazımı, düzeltme ve geri alma TEK yerde
// =============================================================================
// `RollMeterReading` DEFTERDİR (silinirse faturalanan metre değişir): satır değiştirilmez,
// düzeltme = eski aktif satırın damgası + yeni satır; adım yeniden açılınca damgalanır.
// Stok etkisi RECORD'da YOK (karar belgesi §3-5); APPLY (H1b) `kursun-meter-stock.helper.ts`te. Politika alanları okuma anındaki ayarın
// KOPYASIDIR — ayar sonradan değişse de bu okumanın sapma işareti aynı kalır (§12-5).
//
// Tx sırası (§3-4, §12-1) çağıranındır: 8036 token kilidi (İLK ifade) → `touchWorkOrderTx`
// → `assertKursunTabletMayWrite` → burada aktif okuma `FOR UPDATE` → yazım.
// =============================================================================
import { assertWorkNotBilledTx } from "./service-billing-gate.helper";
import { MachineDataSource, MeterApprovalMode, MeterPhase, MeterStockMode, MeterVarianceBasis, Prisma, type RollMeterAck, type RollMeterReading } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import {
  readKursunMeterStockMode, readKursunMeterVarianceApproval,
  readKursunMeterVarianceBasis,
  readKursunMeterVarianceThresholdM,
  readKursunMeterVarianceThresholdPct,
  readKursunSimulatedMeterEnabled,
  resolveKursunMeterCapture,
  type KursunMeterCapture,
} from "../system-setting.service";
import { tokenReplay } from "./token-replay.helper";
import { insertMeterReadingTx, readingPolicyOf, stampMeterReadingsTx } from "./meter-reading.helper";
import { resolveMeterVariance, type MeterVarianceResult } from "../../lib/kursun-meter-variance";
import { loadDeclaredInTx, readingPendingAckSql } from "./kursun-meter-variance-sql.helper";
import { applyExitMeterToStockTx, reverseExitMeterStockTx, type ExitMeterApplyResult } from "./kursun-meter-stock.helper";
import { digestQuickPin, digestsEqual } from "../../lib/short-credential/digest";
import { getShortCredentialKeyRing } from "../../lib/short-credential/keyring";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { AuthService } from "../auth.service";

type Tx = Prisma.TransactionClient;

/** İstemcinin gönderdiği okuma (tablet `meterOut` ya da düzeltme ucu gövdesi). */
export interface MeterReadingInput {
  meters: number;
  source: MachineDataSource;
  peripheralId?: string | null;
  rawCounter?: number | null;
  cardSampleId?: string | null;
  /** Brode adet sayısı (yalnız OUT okumasında saklanır). */
  pieceCount?: number | null;
  clientToken: string;
  /** H2 OPERATOR_REASON imzası — sebep kodu ya da metni. PIN BURADA TAŞINMAZ (kuyruğa girmez, §12-4). */
  ack?: MeterAckReason | null;
}

export interface MeterAckReason {
  reasonCode?: string | null;
  reasonText?: string | null;
}

/** Sapma onay izni (katalog: `permission-catalog.ts`). Ofis ucu ve süpervizör PIN'i bunu ister. */
export const METER_APPROVE_PERMISSION = "kursun:meter-approve";

/** Okuma anındaki sapma politikası — satıra kopyalanır. H2 ayarları gelene dek bugünkü davranış: eşik yok, onay yok. */
export interface MeterPolicyCopy {
  thresholdM: number | null;
  thresholdPct: number | null;
  basis: MeterVarianceBasis;
  approvalMode: MeterApprovalMode;
}

/** Politika çözücüsü — H2 eşik/taban/onay ayarları; TEK kaynak. Sonuç okuma satırına kopyalanır (§12-5). */
export async function resolveKursunMeterPolicy(db: Pick<typeof prisma, "systemSetting">): Promise<MeterPolicyCopy> {
  return {
    thresholdM: await readKursunMeterVarianceThresholdM(db),
    thresholdPct: await readKursunMeterVarianceThresholdPct(db),
    basis: MeterVarianceBasis[await readKursunMeterVarianceBasis(db)],
    approvalMode: MeterApprovalMode[await readKursunMeterVarianceApproval(db)],
  };
}

/** Evre bu kipte yazılabilir mi? OFF'ta hiçbir okuma yazılmaz; IN yalnız IN_OUT'ta. */
export function phaseAllowed(capture: KursunMeterCapture, phase: MeterPhase): boolean {
  if (capture === "OFF") return false;
  return phase === MeterPhase.OUT || capture === "IN_OUT";
}

/**
 * Tx DIŞI ön kapı (fail-closed): kip kapalıysa 400 `METER_CAPTURE_DISABLED`; SIMULATED ayarı kapalıyken
 * 400 `SIMULATED_METER_DISABLED`. Tx içinde aynı soru yeniden sorulmaz — ayar penceresi kabul edilir
 * (ayar yazımı nadirdir ve satır kopyası okuma anını zaten taşır).
 */
/** Metre kolonu Decimal(12,3): yazım ve replay kimliği AYNI 3-ondalık değeri görür
 *  (kayan nokta artığı — ör. sayaç farkı 98.49999999999989 — meşru replay'i 409'a düşürmesin). */
export function canonicalMeters(v: number): string {
  return new Prisma.Decimal(v).toDecimalPlaces(3).toFixed(3);
}

export async function assertMeterInputAllowed(phase: MeterPhase, input: MeterReadingInput): Promise<void> {
  const capture = await resolveKursunMeterCapture();
  if (!phaseAllowed(capture, phase)) {
    throw AppError.badRequest(
      capture === "OFF"
        ? "Kurşun metre ölçümü kapalı — ayarlardan açılmadan metre okuması kaydedilmez"
        : "Giriş metresi yalnız 'Giriş ve çıkışta ölç' ayarında kaydedilir",
      { code: "METER_CAPTURE_DISABLED", capture, phase },
    );
  }
  if (input.source === MachineDataSource.SIMULATED && !(await readKursunSimulatedMeterEnabled())) {
    throw AppError.badRequest("Simüle sayaç okuması kabul edilmiyor — gerçek sayaçtan okuyun ya da metreyi elle girin", {
      code: "SIMULATED_METER_DISABLED",
    });
  }
  if (input.peripheralId) {
    const p = await prisma.peripheralDevice.findFirst({ where: { id: input.peripheralId, deletedAt: null }, select: { id: true } });
    if (!p) throw AppError.badRequest("Sayaç cihazı bulunamadı", { code: "METER_PERIPHERAL_NOT_FOUND" });
  }
}

/** Token replay boğazı (K kipi): 8036 kilidi + taze okuma; geri alınmış okumanın token'ı 409 (4. durum). */
export function meterReadingReplay(expect: { rollId: string; stepId: string; phase: MeterPhase; meters: number; pieceCount?: number | null }) {
  return tokenReplay<RollMeterReading, RollMeterReading>({
    find: (db, clientToken) => db.rollMeterReading.findUnique({ where: { clientToken } }),
    alive: (prior) => {
      if (prior.revokedAt) {
        throw AppError.conflict("Bu metre okuması sonradan düzeltildi ya da geri alındı — yeni okuma yapın", { code: "METER_READING_REVOKED", readingId: prior.id });
      }
    },
    identity: (prior) => [
      { ad: "rollId", mevcut: prior.rollId, gelen: expect.rollId },
      { ad: "workOrderStepId", mevcut: prior.workOrderStepId, gelen: expect.stepId },
      { ad: "phase", mevcut: prior.phase, gelen: expect.phase },
      { ad: "meters", mevcut: new Prisma.Decimal(prior.meters).toFixed(3), gelen: canonicalMeters(expect.meters) },
      // Adet yalnız OUT okumasına yazılır; aynı token farklı adetle gelirse çarpışmadır (sessiz eski adet değil).
      ...(expect.pieceCount === undefined ? [] : [{ ad: "pieceCount", mevcut: prior.pieceCount ?? null, gelen: expect.phase === MeterPhase.OUT ? expect.pieceCount : null }]),
    ],
    collision: "Bu okuma kimliği başka bir top/adım/metre için kullanılmış — yeni okuma yapın",
    respond: (prior) => prior,
  });
}

export interface WriteMeterReadingArgs {
  rollId: string;
  stepId: string;
  phase: MeterPhase;
  input: MeterReadingInput;
  userId: string | null;
  machineId: string | null;
  /** Düzeltme sebebi — eski aktif satırın `revokeReason`ı. */
  reason: string;
}

export interface WriteMeterReadingResult {
  reading: RollMeterReading;
  /** Damgalanan önceki aktif okuma (düzeltme), yoksa null. */
  revokedId: string | null;
  /** OUT okumasının sapma kararı (kopyadan); IN için null. */
  variance: MeterVarianceResult | null;
  /** Aynı tx'te yazılan OPERATOR_REASON imzası · H1b APPLY stok sonucu (RECORD / imza bekliyor ⇒ null). */
  ack: RollMeterAck | null; stock?: ExitMeterApplyResult | null;
}

/**
 * Aktif okumayı `FOR UPDATE` kilitler; varsa damgalar (bağlı aktif onayla birlikte), yeni satırı yazar.
 * Token replay'i ÇAĞIRAN önce sorar (`meterReadingReplay(...).inTx`); burada token yeni sayılır.
 */
export async function writeMeterReadingTx(tx: Tx, args: WriteMeterReadingArgs): Promise<WriteMeterReadingResult> {
  const active = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM roll_meter_readings
    WHERE "rollId" = ${args.rollId}::uuid AND "workOrderStepId" = ${args.stepId}::uuid
      AND phase = ${args.phase}::"MeterPhase" AND "revokedAt" IS NULL
    FOR UPDATE`;
  // H7 §5 kilit sırası: okuma kilidinden SONRA bağ kontrolü — faturalı işin metresi değişmez (409, fatura no ile).
  await assertWorkNotBilledTx(tx, { rollIds: [args.rollId], workOrderStepId: args.stepId });
  let revokedId: string | null = null;
  if (active.length > 0) {
    revokedId = active[0].id;
    await revokeReadingsTx(tx, { ids: [revokedId], userId: args.userId, reason: args.reason });
  }
  const policy = await resolveKursunMeterPolicy(tx);
  // Ortak yazım boğazı (D4-B1b): satır yaratma yalnız meter-reading.helper'da.
  const reading = await insertMeterReadingTx(tx, { data: {
    rollId: args.rollId,
    workOrderStepId: args.stepId,
    phase: args.phase,
    meters: new Prisma.Decimal(canonicalMeters(args.input.meters)),
    rawCounter: args.input.rawCounter == null ? null : new Prisma.Decimal(args.input.rawCounter),
    pieceCount: args.phase === MeterPhase.OUT ? args.input.pieceCount ?? null : null,
    source: args.input.source,
    machineId: args.machineId,
    peripheralId: args.input.peripheralId ?? null,
    cardSampleId: args.input.cardSampleId ?? null,
    thresholdM: policy.thresholdM == null ? null : new Prisma.Decimal(policy.thresholdM),
    thresholdPct: policy.thresholdPct == null ? null : new Prisma.Decimal(policy.thresholdPct),
    basis: policy.basis,
    approvalMode: policy.approvalMode,
    // H1b: stok kipi de okuma anında kopyalanır (tablet adım özetindeki `policy` sözleşmesine girmez).
    stockMode: MeterStockMode[await readKursunMeterStockMode(tx)],
    clientToken: args.input.clientToken,
    createdById: args.userId,
  } });
  if (args.phase !== MeterPhase.OUT) return { reading, revokedId, variance: null, ack: null, stock: null };

  // H2 §3-6: sapma kopyadan; OPERATOR_REASON'da sebep yoksa fail-closed 409 (tablet kuyruğa koymadan sorar).
  const variance = await evaluateReadingVarianceTx(tx, reading);
  let ack: RollMeterAck | null = null;
  if (variance.needsAck && reading.approvalMode === MeterApprovalMode.OPERATOR_REASON) {
    const reason = normalizeAckReason(args.input.ack);
    if (!reason) {
      throw AppError.conflict("Metre farkı eşiği aştı — sebep seçmeden kaydedilemez", {
        code: "KURSUN_METER_MISMATCH",
        diffMeters: variance.diffMeters,
        allowedMeters: variance.allowedMeters,
        baseMeters: variance.baseMeters,
      });
    }
    ack = await tx.rollMeterAck.create({
      data: { readingId: reading.id, mode: MeterApprovalMode.OPERATOR_REASON, ...reason, approvedById: args.userId },
    });
  }
  // H1b: okuma ETKİNSE (imza gerekmiyor ya da aynı tx'te imzalandı) APPLY kipinde stoğa uygulanır;
  // PIN/OFFICE imzası bekleyen okuma stoğa dokunmaz — uygulama imza anında (`ackMeterReadingTx`).
  return { reading, revokedId, variance, ack, stock: !variance.needsAck || ack ? await applyExitMeterToStockTx(tx, reading, args.userId) : null };
}

/** Sebep kodu/metni kırpılır; ikisi de boşsa null. */
export function normalizeAckReason(r: MeterAckReason | null | undefined): { reasonCode: string | null; reasonText: string | null } | null {
  const reasonCode = r?.reasonCode?.trim() || null;
  const reasonText = r?.reasonText?.trim() || null;
  if (!reasonCode && !reasonText) return null;
  return { reasonCode: reasonCode ? reasonCode.slice(0, 64) : null, reasonText: reasonText ? reasonText.slice(0, 300) : null };
}

/**
 * Okumanın sapma girdileri — SQL ikizinin (`declaredInSql`/`measuredInSql`) TS karşılığı: bildirilen giriş =
 * gelen belge satırı metresi, yoksa doğuş metresi (`loadDeclaredInTx`); ölçülen giriş = aynı adımın aktif IN okuması.
 */
export async function evaluateReadingVarianceTx(
  db: Tx | typeof prisma,
  reading: Pick<RollMeterReading, "rollId" | "workOrderStepId" | "meters" | "thresholdM" | "thresholdPct" | "basis" | "approvalMode">,
): Promise<MeterVarianceResult> {
  const declaredIn = await loadDeclaredInTx(db, reading.rollId);
  const measured = await db.rollMeterReading.findFirst({
    where: { rollId: reading.rollId, workOrderStepId: reading.workOrderStepId, phase: MeterPhase.IN, revokedAt: null },
    select: { meters: true },
  });
  const num = (d: Prisma.Decimal | null | undefined): number | null => (d == null ? null : Number(d));
  return resolveMeterVariance(
    { declaredIn: num(declaredIn), measuredIn: num(measured?.meters), out: Number(reading.meters) },
    { thresholdM: num(reading.thresholdM), thresholdPct: num(reading.thresholdPct), ...readingPolicyOf(reading) },
  );
}

/** İmza bekleyen aktif OUT okumaları (SQL ikizi) — `finishStep` kapısı ve ofis listesi aynı yüklemi kullanır. */
export async function pendingMeterAcksTx(
  db: Tx | typeof prisma,
  scope: { stepId?: string; rollIds?: string[]; limit?: number },
): Promise<Array<{ readingId: string; rollId: string; stepId: string; meters: Prisma.Decimal; approvalMode: MeterApprovalMode; createdAt: Date }>> {
  if (scope.rollIds && scope.rollIds.length === 0) return [];
  const conds: Prisma.Sql[] = [readingPendingAckSql("r")];
  if (scope.stepId) conds.push(Prisma.sql`r."workOrderStepId" = ${scope.stepId}::uuid`);
  if (scope.rollIds) conds.push(Prisma.sql`r."rollId" = ANY(${scope.rollIds}::uuid[])`);
  return db.$queryRaw`
    SELECT r.id AS "readingId", r."rollId", r."workOrderStepId" AS "stepId", r.meters, r."approvalMode", r."createdAt"
    FROM roll_meter_readings r
    WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY r."createdAt" ASC, r.id ASC
    LIMIT ${scope.limit ?? 500}`;
}

/**
 * Süpervizör PIN'ini kullanıcıya çözer (yalnız HMAC özetiyle; düz PIN hiçbir yere yazılmaz).
 * Bulunamazsa / iznin yoksa 403 — iki durumun mesajı ayrı ama PIN'i yankılamaz.
 */
export async function resolveSupervisorByPin(pin: string): Promise<{ id: string }> {
  const normalized = (pin ?? "").trim();
  const invalid = () => AppError.forbidden("Süpervizör PIN'i tanınmadı", { code: "METER_PIN_INVALID" });
  if (!/^\d{6}$/.test(normalized)) throw invalid();
  const ring = getShortCredentialKeyRing();
  const candidates = ring.ok ? ring.ring.keys.map((k) => digestQuickPin(k, normalized)) : [];
  if (candidates.length === 0) throw invalid();
  const hit = await prisma.user.findFirst({
    where: { quickPinDigest: { in: candidates }, quickPin: null, isActive: true, deletedAt: null },
    select: { id: true, quickPinDigest: true },
  });
  if (!hit || !candidates.some((c) => digestsEqual(c, hit.quickPinDigest ?? ""))) throw invalid();
  const perms = await AuthService.getEffectivePermissions(hit.id);
  if (!matchesPermission(perms, "kursun:meter-approve")) {
    throw AppError.forbidden("Bu PIN'in sahibinin metre sapması onaylama yetkisi yok", { code: "METER_PIN_NOT_PERMITTED" });
  }
  return { id: hit.id };
}

/**
 * SUPERVISOR_PIN / OFFICE imzası. Okuma satırı `FOR UPDATE` (adım yeniden açılışının damgasıyla serileşir);
 * kip, aktiflik ve sapma yeniden doğrulanır; ikinci imza kısmi unique'te 409'a döner.
 */
export async function ackMeterReadingTx(
  tx: Tx,
  args: { readingId: string; mode: "SUPERVISOR_PIN" | "OFFICE"; approvedById: string; reason: MeterAckReason | null },
): Promise<RollMeterAck> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM roll_meter_readings WHERE id = ${args.readingId}::uuid FOR UPDATE`;
  if (locked.length === 0) throw AppError.notFound("Metre okuması bulunamadı");
  const reading = await tx.rollMeterReading.findUniqueOrThrow({ where: { id: args.readingId } });
  if (reading.revokedAt) {
    throw AppError.conflict("Bu metre okuması düzeltildi ya da geri alındı — güncel okumayı onaylayın", { code: "METER_READING_REVOKED" });
  }
  if (reading.phase !== MeterPhase.OUT || reading.approvalMode !== args.mode) {
    throw AppError.conflict("Bu okuma bu yolla onaylanmaz", { code: "METER_ACK_MODE_MISMATCH", approvalMode: reading.approvalMode });
  }
  const variance = await evaluateReadingVarianceTx(tx, reading);
  if (!variance.needsAck) throw AppError.conflict("Bu okumada onay bekleyen sapma yok", { code: "METER_NOT_DEVIATED" });
  const reason = normalizeAckReason(args.reason);
  try {
    return await tx.rollMeterAck.create({
      data: { readingId: reading.id, mode: args.mode, reasonCode: reason?.reasonCode ?? null, reasonText: reason?.reasonText ?? null, approvedById: args.approvedById },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw AppError.conflict("Bu sapma zaten onaylanmış", { code: "METER_ALREADY_ACKED" });
    }
    throw e;
  }
}

/** Onay ayak izi (tx DIŞI). PIN, fiyat, metin yükte YOK — yalnız kip, onaylayan, sebep kodu. */
export async function auditMeterAck(userId: string | undefined, ack: RollMeterAck): Promise<void> {
  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: "ROLL_METER_ACK",
    recordId: ack.id,
    newData: { readingId: ack.readingId, mode: ack.mode, approvedById: ack.approvedById, reasonCode: ack.reasonCode, hasReasonText: ack.reasonText != null },
  });
}

/** Okumaları ve bağlı aktif onayları AYNI tx'te damgalar (silmez). Dönen: damgalanan okuma sayısı. */
async function revokeReadingsTx(tx: Tx, args: { ids: string[]; userId: string | null; reason: string }): Promise<number> {
  if (args.ids.length === 0) return 0;
  const stamp = { revokedAt: new Date(), revokedById: args.userId, revokeReason: args.reason.slice(0, 300) };
  const revoked = await stampMeterReadingsTx(tx, { id: { in: args.ids } }, stamp);
  await tx.rollMeterAck.updateMany({ where: { readingId: { in: args.ids }, revokedAt: null }, data: stamp });
  // H1b: APPLY etkisi okumayla birlikte terslenir (bağlı sapma satırı damgalanır, metraj geri döner).
  await reverseExitMeterStockTx(tx, args.ids, args.userId);
  return revoked;
}

/** Adım yeniden açılınca o turun toplarının bu adımdaki aktif okumalarını damgalar (§3-7). */
export async function revokeStepMeterReadingsTx(
  tx: Tx,
  args: { rollIds: string[]; stepId: string; userId: string | null; reason: string },
): Promise<number> {
  if (args.rollIds.length === 0) return 0;
  // H7: faturalı işin adımı yeniden açılamaz (okuma damgası faturanın metresini dayanaksız bırakırdı).
  await assertWorkNotBilledTx(tx, { rollIds: args.rollIds, workOrderStepId: args.stepId });
  const rows = await tx.rollMeterReading.findMany({
    where: { rollId: { in: args.rollIds }, workOrderStepId: args.stepId, revokedAt: null },
    select: { id: true },
  });
  return revokeReadingsTx(tx, { ids: rows.map((r) => r.id), userId: args.userId, reason: args.reason });
}

/** Ayak izi (tx DIŞI, best-effort). Yükte fiyat yok; metre ve kaynak var. */
export async function auditMeterReadingWrite(
  userId: string | undefined,
  result: WriteMeterReadingResult,
  via: "COMPLETE_QC2" | "CORRECTION",
): Promise<void> {
  const r = result.reading;
  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: "ROLL_METER_READING",
    recordId: r.id,
    newData: {
      rollId: r.rollId,
      stepId: r.workOrderStepId,
      phase: r.phase,
      meters: Number(r.meters),
      source: r.source,
      peripheralId: r.peripheralId,
      via,
      replacesReadingId: result.revokedId,
    },
  });
}
