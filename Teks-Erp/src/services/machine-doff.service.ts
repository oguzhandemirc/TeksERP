// =============================================================================
// TeksERP — TOP İNDİRME (DoffEvent) Servisi · kaydet / geri al
// =============================================================================
// Doff bir DEFTERDİR (append-only): tezgahtan kumaş indiği AN'ın kaydı. Top
// BURADA DOĞMAZ — top KK1'de `createInitialEntry(…, { forcedEntrySource: WEAVING,
// doffEventId })` ile doğar ve bağ orada, doff satırı kilitlenerek kurulur
// (`claimDoffForRollTx`). Sözleşme: DOKUMA-IS-EMRI-VE-TABLET-TASARIMI §3.8b.
//
//   • KAYDET — tek INSERT; stok defterine DOKUNMAZ, koşum bağı OPSİYONEL
//             (koşum yoksa 400 değil `warnings`: "iş emri metresine GİRMİYOR";
//             uyarı REPLAY'de de döner — çevrimdışı yeniden gönderimde tek cevap odur).
//             Advisory kilit yalnız KOD SIRASI için (8029, tx'in ilk ifadesi —
//             `nextDoffCodeTx`): günlük sıra oku-sonra-yaz'dır ve 25 paralelde
//             retry tükeniyordu. Başka kilit yok: partial unique yok ("tek açık
//             doff" seddi yok), satır tek yazarlı. Tek unique `clientToken`
//             idempotency içindir.
//   • GERİ AL — `revokedAt` damgası; yalnız hiç top doğurmamış indirmede açık
//             (`NOT EXISTS rolls.doffEventId`, statüye BAKILMAZ — iptal edilmiş
//             top da doff'u tarihsel olgu yapar). Top varsa 409 topu ADIYLA söyler
//             ve çare ÖNERMEZ: doff artık geri alınamaz, yanlış top kendi iptal
//             yolundan gider (topu iptal etmek yüklemi değiştirmez).
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
import { assertDoffReplayAlive } from "./helpers/token-replay.helper";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { resolveRunStamp } from "./helpers/machine-run-open.helper";
import { assertProductionLineValid } from "./helpers/production-line.helper";
import { deriveRunWarnings, nextDoffCodeTx, WARN_RUN_WITHOUT_ORDER } from "./helpers/machine-doff-open.helper";
import type { ApiResponse } from "../types/api.types";

export { DOFF_CODE_PREFIX } from "./helpers/machine-doff-open.helper";

const TABLE = "DOFF_EVENT";
/** 409 mesajındaki barkod listesi kırpılır, SAYI kırpılmaz (`warehouse-stock.helper` emsali). */
const MESSAGE_BARCODE_LIMIT = 20;
const REPLAY_MESSAGE = "İndirme zaten kayıtlı (yeniden gönderim)";

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
  // Masa KK1 tüm tezgahların indirmelerini görür — satır tezgahı ADIYLA söyler (E2).
  machine: { select: { code: true, name: true } },
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

/**
 * Replay cevabı — özgün sonuç + koşum uyarısı YENİDEN türetilir (kayıttaki
 * `machineRunId`den). Kimlik alanları: makine · hat · adet; `machineRunId`/
 * `counterAtDoff`/`doffedAt` kimlik DEĞİL (aynı form, düzeltilmiş sayaç
 * yeniden gönderilebilir).
 */
/** `idempotent: true` = bu çağrıda YENİ indirme doğmadı (`InitialEntryResult` emsali; istemci METNE bakmaz). */
export type OpenDoffResult = ApiResponse<DoffEventDto> & { idempotent?: true };

async function resolveReplay(existing: DoffEventDto, input: OpenDoffInput): Promise<OpenDoffResult> {
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
  const warnings = await deriveRunWarnings(existing.machineRunId);
  return { success: true, data: existing, message: REPLAY_MESSAGE, idempotent: true, ...(warnings.length ? { warnings } : {}) };
}

/** Makine aktif · hat aralıkta · koşum (verildiyse) aynı makinede ve canlı. */
async function resolveDoffContext(input: OpenDoffInput): Promise<{ machineCode: string; warnings: string[] }> {
  const machine = await prisma.machine.findFirst({
    where: { id: input.machineId, isActive: true },
    select: { id: true, code: true, productionLineCount: true },
  });
  if (!machine) throw AppError.badRequest("Makine bulunamadı veya pasif", { machineId: input.machineId });
  assertProductionLineValid(input.productionLineNo, machine.productionLineCount);
  // Atıf UYDURULMAZ: koşum verilmediyse açık koşum aranıp bağlanmaz; kayıp
  // adıyla söylenir (`deriveRunWarnings`, replay ile aynı kaynak).
  if (!input.machineRunId) return { machineCode: machine.code, warnings: await deriveRunWarnings(null) };
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
  return { machineCode: machine.code, warnings: run.weavingOrderId ? [] : [WARN_RUN_WITHOUT_ORDER] };
}

export async function openDoff(input: OpenDoffInput, userId?: string): Promise<OpenDoffResult> {
  // ① Replay — yaratmadan ÖNCE.
  if (input.clientToken) {
    const existing = await findByToken(input.clientToken);
    if (existing) return resolveReplay(existing, input);
  }
  // ② Bağlam (tx dışı okuma) · ③ damga.
  const ctx = await resolveDoffContext(input);
  const stamp = resolveRunStamp(input.doffedAt, "indirme zamanı");
  const warnings = [...ctx.warnings, ...(stamp.warning ? [stamp.warning] : [])];

  let created: DoffEventDto;
  try {
    // ④ Kod sunucuda, günlük sıra, 8029 kilidi tx'in İLK ifadesi (`nextDoffCodeTx`);
    // ⑤ tek INSERT. Retry yalnız `code_key` P2002 kemeri — token P2002'si retry'a
    // GİRMEZ, aşağıda replay'e döner.
    created = await withBarcodeRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const code = await nextDoffCodeTx(tx, stamp.value);
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
      "İndirme kodu",
    );
  } catch (e) {
    // ⑥ Aynı token iki paralel istekte: ikinci INSERT token unique'ine çarpar → replay.
    if (input.clientToken && isClientTokenP2002(e)) {
      const existing = await findByToken(input.clientToken);
      if (existing) return resolveReplay(existing, input);
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
 * `count=0` tanısı — tx içinde taze okuma. Top listesi TAM okunur (`pieceCount`
 * 1000'e kadar meşru); mesajdaki liste kırpılır, SAYI kırpılmaz.
 */
async function diagnoseRevokeRefusal(tx: Prisma.TransactionClient, doffEventId: string): Promise<AppError> {
  const fresh = await tx.doffEvent.findUnique({
    where: { id: doffEventId },
    select: { revokedAt: true, rolls: { select: { id: true, barcode: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!fresh) return AppError.notFound("İndirme kaydı bulunamadı", { doffEventId });
  if (fresh.revokedAt) {
    return AppError.conflict("Bu indirme zaten geri alınmış.", { code: "DOFF_ALREADY_REVOKED", doffEventId, revokedAt: fresh.revokedAt });
  }
  const barcodes = fresh.rolls.map((r) => r.barcode);
  const shown = barcodes.slice(0, MESSAGE_BARCODE_LIMIT);
  const tail = barcodes.length > shown.length ? ` … (+${barcodes.length - shown.length})` : "";
  return AppError.conflict(
    `Bu indirmeden ${barcodes.length} top doğmuş — indirme artık geri alınamaz; yanlış top kendi iptal yolundan gider ` +
      `(${shown.join(", ")}${tail}).`,
    { code: "DOFF_HAS_ROLLS", doffEventId, total: barcodes.length, barcodes, rollIds: fresh.rolls.map((r) => r.id) },
  );
}

/**
 * KK1'in `FOR UPDATE`i doff satırını tx zaman aşımından uzun tutarsa iptal
 * P2028 ile düşer. Bu "sunucu yoğun" (503) DEĞİL bir DURUM çatışmasıdır: satır
 * o an topa bağlanıyor — 409 "tekrar deneyin" (ölçüldü 2026-09-13, §3.8c W7;
 * karar 1e). Başka her hata olduğu gibi geçer.
 */
export function mapRevokeTimeout(e: unknown, doffEventId: string): unknown {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2028") return e;
  return AppError.conflict("Bu indirme şu anda KK1'de topa bağlanıyor — birkaç saniye sonra tekrar deneyin.", {
    code: "DOFF_LINK_IN_PROGRESS",
    doffEventId,
  });
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
    if (claim.count === 0) throw await diagnoseRevokeRefusal(tx, doffEventId);
    return tx.doffEvent.findUniqueOrThrow({ where: { id: doffEventId }, select: DOFF_SELECT });
  }).catch((e: unknown) => { throw mapRevokeTimeout(e, doffEventId); });
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
