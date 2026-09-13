// =============================================================================
// TeksERP — TOP İNDİRME (DoffEvent) Servisi · kaydet / geri al
// =============================================================================
// Doff bir DEFTERDİR (append-only): tezgahtan kumaş indiği AN'ın kaydı. Top
// BURADA DOĞMAZ — top KK1'de `createInitialEntry(…, { forcedEntrySource: WEAVING,
// doffEventId })` ile doğar ve bağ orada, doff satırı kilitlenerek kurulur
// (`claimDoffForRollTx`). Sözleşme: DOKUMA-IS-EMRI-VE-TABLET-TASARIMI §3.8b.
//
//   • KAYDET — tek INSERT; stok defterine DOKUNMAZ, koşum bağı OPSİYONEL
//             (koşum yoksa 400 değil `warnings`: "iş emri metresine GİRMİYOR").
//             ⛔ Advisory kilit YOK — gerekçe adıyla: partial unique yok ("tek
//             açık doff" seddi yok), doğal anahtar yok (kod sunucuda üretilir,
//             `withBarcodeRetry` çarpışmayı çözer), tek yazar (TOCTOU yüzeyi
//             yok). Tek unique `clientToken` idempotency içindir.
//   • GERİ AL — `revokedAt` damgası; yalnız hiç top doğurmamış indirmede açık
//             (`NOT EXISTS rolls.doffEventId`, statüye BAKILMAZ — iptal edilmiş
//             top da doff'u tarihsel olgu yapar). Top varsa 409 topu ADIYLA söyler.
//
// ⚠️ İKİ TARİH: `doffedAt` istemcinin BEYANIDIR (makul aralık dışındaysa sunucu
// saatine düşer, `warnings` söyler); `createdAt` kronolojidir.
// =============================================================================
import { MachineDataSource, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { isClientTokenP2002, p2002Mentions } from "../utils/p2002";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { assertDoffReplayAlive } from "./helpers/token-replay.helper";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { resolveRunStamp } from "./helpers/machine-run-open.helper";
import { assertProductionLineValid } from "./helpers/production-line.helper";
import type { ApiResponse } from "../types/api.types";

const TABLE = "DOFF_EVENT";
/** Fiziksel etiket kodu: `DF` + GGAAYY + NNNN (≤ 32). */
export const DOFF_CODE_PREFIX = "DF";

export const DOFF_SELECT = {
  id: true,
  machineId: true,
  productionLineNo: true,
  machineRunId: true,
  doffedAt: true,
  pieceCount: true,
  counterAtDoff: true,
  counterSource: true,
  code: true,
  notes: true,
  clientToken: true,
  revokedAt: true,
  revokedById: true,
  revokeReason: true,
  createdAt: true,
  createdById: true,
} satisfies Prisma.DoffEventSelect;

export type DoffEventDto = Prisma.DoffEventGetPayload<{ select: typeof DOFF_SELECT }>;

export interface OpenDoffInput {
  machineId: string;
  productionLineNo: number;
  machineRunId?: string | null;
  doffedAt?: Date | null;
  pieceCount: number;
  counterAtDoff?: number | null;
  counterSource: MachineDataSource;
  notes?: string | null;
  clientToken?: string | null;
}

async function findByToken(clientToken: string): Promise<DoffEventDto | null> {
  return prisma.doffEvent.findUnique({ where: { clientToken }, select: DOFF_SELECT });
}

function resolveReplay(existing: DoffEventDto, input: OpenDoffInput): DoffEventDto {
  assertDoffReplayAlive(existing);
  assertReplayPayloadMatches(
    [
      { ad: "machineId", mevcut: existing.machineId, gelen: input.machineId },
      { ad: "productionLineNo", mevcut: existing.productionLineNo, gelen: input.productionLineNo },
      { ad: "pieceCount", mevcut: existing.pieceCount, gelen: input.pieceCount },
    ],
    "Bu form daha önce başka bir indirme için kaydedilmiş — yeni indirme için formu yeniden açın.",
    { doffEventId: existing.id },
  );
  return existing;
}

/** Makine aktif · hat aralıkta · koşum (verildiyse) aynı makinede ve canlı. */
async function resolveDoffContext(input: OpenDoffInput): Promise<{ machineCode: string; warnings: string[] }> {
  const machine = await prisma.machine.findFirst({
    where: { id: input.machineId, isActive: true },
    select: { id: true, code: true, productionLineCount: true },
  });
  if (!machine) throw AppError.badRequest("Makine bulunamadı veya pasif", { machineId: input.machineId });
  assertProductionLineValid(input.productionLineNo, machine.productionLineCount);
  const warnings: string[] = [];
  if (input.machineRunId) {
    const run = await prisma.machineRun.findUnique({
      where: { id: input.machineRunId },
      select: { id: true, machineId: true, revokedAt: true, weavingOrderId: true },
    });
    if (!run) throw AppError.notFound("Koşum bulunamadı", { machineRunId: input.machineRunId });
    if (run.machineId !== machine.id) {
      throw AppError.conflict("Koşum başka bir makineye ait — indirme ona bağlanamaz.", {
        code: "DOFF_RUN_MISMATCH",
        machineRunId: run.id,
        runMachineId: run.machineId,
        machineId: machine.id,
      });
    }
    if (run.revokedAt) {
      throw AppError.conflict("Koşum geri alınmış — indirme ona bağlanamaz.", {
        code: "RUN_REVOKED",
        machineRunId: run.id,
        revokedAt: run.revokedAt,
      });
    }
    if (!run.weavingOrderId) {
      warnings.push("Koşum bir dokuma işine bağlı değil — bu indirme iş emri metresine GİRMİYOR.");
    }
  } else {
    // Atıf UYDURULMAZ: açık koşum aranıp bağlanmaz. Kayıp adıyla söylenir.
    warnings.push("Koşum açılmadığı için bu indirme iş emri metresine GİRMİYOR.");
  }
  return { machineCode: machine.code, warnings };
}

export async function openDoff(input: OpenDoffInput, userId?: string): Promise<ApiResponse<DoffEventDto>> {
  // ① Replay — yaratmadan ÖNCE.
  if (input.clientToken) {
    const existing = await findByToken(input.clientToken);
    if (existing) {
      return { success: true, data: resolveReplay(existing, input), message: "İndirme zaten kayıtlı (yeniden gönderim)" };
    }
  }
  // ② Bağlam (tx dışı okuma) · ③ damga.
  const ctx = await resolveDoffContext(input);
  const stamp = resolveRunStamp(input.doffedAt, "indirme zamanı");
  const warnings = [...ctx.warnings, ...(stamp.warning ? [stamp.warning] : [])];

  let created: DoffEventDto;
  try {
    // ④ Kod sunucuda, günlük sıra; ⑤ tek INSERT. Yalnız KOD çarpışması yeniden
    // denenir — token P2002'si retry'a GİRMEZ, aşağıda replay'e döner.
    created = await withBarcodeRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const prefix = dailyCodePrefix(DOFF_CODE_PREFIX, stamp.value);
          const codes = await tx.doffEvent.findMany({
            where: { code: { gte: prefix, startsWith: prefix } },
            select: { code: true },
          });
          const code = buildDailyCode(DOFF_CODE_PREFIX, nextDailySeq(codes.map((c) => c.code), prefix), stamp.value);
          return tx.doffEvent.create({
            data: {
              machineId: input.machineId,
              productionLineNo: input.productionLineNo,
              machineRunId: input.machineRunId ?? null,
              doffedAt: stamp.value,
              pieceCount: input.pieceCount,
              counterAtDoff: input.counterAtDoff != null ? new Prisma.Decimal(input.counterAtDoff) : null,
              counterSource: input.counterSource,
              code,
              notes: input.notes ?? null,
              clientToken: input.clientToken ?? null,
              createdById: userId ?? null,
            },
            select: DOFF_SELECT,
          });
        }),
      undefined,
      (err) => p2002Mentions(err, /doff_events_code_key/),
    );
  } catch (e) {
    // ⑥ Aynı token iki paralel istekte: ikinci INSERT token unique'ine çarpar → replay.
    if (input.clientToken && isClientTokenP2002(e)) {
      const existing = await findByToken(input.clientToken);
      if (existing) {
        return { success: true, data: resolveReplay(existing, input), message: "İndirme zaten kayıtlı (yeniden gönderim)" };
      }
    }
    throw e;
  }
  // ⑦ Audit tx DIŞINDA, best-effort.
  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: TABLE,
    recordId: created.id,
    newData: {
      event: "MACHINE_DOFF",
      machineId: created.machineId,
      machineCode: ctx.machineCode,
      machineRunId: created.machineRunId,
      pieceCount: created.pieceCount,
      counterSource: created.counterSource,
      code: created.code,
    },
  }).catch(() => undefined);
  return { success: true, data: created, message: `İndirme kaydedildi (${created.code})`, ...(warnings.length ? { warnings } : {}) };
}

/**
 * GERİ ALMA — damga. Açık yüklem: `revokedAt IS NULL AND NOT EXISTS rolls`.
 * Roll'a HİÇBİR ŞEY olmaz — top varsa doff geri alınamaz, top kendi ters
 * yolundan gider. `count=0` tanısı tx içinde taze okumayla.
 *
 * ⚠️ ÖNCE SATIR KİLİDİ, SONRA claim — sıra LOAD-BEARING (ölçüldü 2026-09-13,
 * `test_machine_doff_source §5b`): tek başına `updateMany … NOT EXISTS rolls`
 * KK1'in FOR UPDATE'inde bloklanır ama uyanınca yüklemi KENDİ eski snapshot'ıyla
 * yeniden değerlendirir (PG EvalPlanQual yalnız hedef satırın taze sürümünü
 * getirir; alt sorgu tx-B'nin commit ettiği topu GÖRMEZ) ⇒ iptal edilmiş doff'a
 * bağlı top doğuyordu. Kilit ayrı bir ifadede alınınca sonraki `updateMany`
 * taze snapshot alır ve topu görür.
 */
export async function revokeDoff(doffEventId: string, reason: string, userId?: string): Promise<ApiResponse<DoffEventDto>> {
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM doff_events WHERE id = ${doffEventId}::uuid FOR UPDATE`;
    const claim = await tx.doffEvent.updateMany({
      where: { id: doffEventId, revokedAt: null, rolls: { none: {} } },
      data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: reason },
    });
    if (claim.count === 0) {
      const fresh = await tx.doffEvent.findUnique({
        where: { id: doffEventId },
        select: { revokedAt: true, rolls: { select: { id: true, barcode: true }, take: 20 } },
      });
      if (!fresh) throw AppError.notFound("İndirme kaydı bulunamadı", { doffEventId });
      if (fresh.revokedAt) {
        throw AppError.conflict("Bu indirme zaten geri alınmış.", { code: "DOFF_ALREADY_REVOKED", doffEventId, revokedAt: fresh.revokedAt });
      }
      throw AppError.conflict(
        `Bu indirmeden doğmuş ${fresh.rolls.length} top var — önce topu iptal edin, indirme sonra geri alınır.`,
        {
          code: "DOFF_HAS_ROLLS",
          doffEventId,
          barcodes: fresh.rolls.map((r) => r.barcode),
          rollIds: fresh.rolls.map((r) => r.id),
        },
      );
    }
    return tx.doffEvent.findUniqueOrThrow({ where: { id: doffEventId }, select: DOFF_SELECT });
  });
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: TABLE,
    recordId: revoked.id,
    changes: [
      { field: "revokedAt", old: null, new: revoked.revokedAt },
      { field: "revokeReason", old: null, new: revoked.revokeReason },
    ],
    newData: { event: "MACHINE_DOFF_REVOKE" },
  }).catch(() => undefined);
  return { success: true, data: revoked, message: "İndirme geri alındı" };
}
