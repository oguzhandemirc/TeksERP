// =============================================================================
// KK1 TOP DOĞUŞU (S1, `dokuma.rollBirth` KK1_LABEL_OR_ORDER · KK1_LABEL_ONLY)
// =============================================================================
// Top KK1'de doğar, DoffEvent'i SUNUCU üretir — mevcut `claimDoffForRollTx` +
// `autoConsumeForRollTx` zinciri AYNEN çalışır, ikinci giriş motoru yazılmaz
// (dokuma.md :25; plan DOKUMA-MANUEL-PLAN § S1, D2/D9/D11/D16/D17).
//
//   B yolu `machineCode` (tezgah etiketi): makine aktif ∧ istasyonu WEAVING; o
//   hatta AÇIK koşum ŞART (D16 fail-closed: koşumsuz doff iş metresine girmez →
//   409 MACHINE_NO_OPEN_RUN, top DOĞMAZ; iş panelden "İş ver"). Doff tx içinde
//   `createDoffTx` ile doğar (sayaç NULL, kaynak OPERATOR — insan beyanı, D9).
//   A yolu `weavingOrderId`: iş açık (PLANNED/IN_PROGRESS) ∧ IN_HOUSE; açık
//   koşum 0 → 409; 1 → tezgah çözüldü, doff doğar; >1 → tezgah BİLİNMİYOR:
//   DoffEvent uydurulmaz, `Roll.weavingOrderId` yazılır, levent tüketimi YOK +
//   uyarı (D11; CHECK `rolls_weaving_order_xor_ck`).
//   Kumaş uyuşmazlığı RED DEĞİL, `warnings` (D17: ön-dolgu öneridir).
//
// Bu dosya `doffEvent.create` İÇERMEZ — defter yazıcısı `machine-doff.service.ts`te
// kalır (beyan değişmez). Tx AÇMAZ, alır; 8021 kilidinden SONRA çağrılır.
// =============================================================================
import { MachineDataSource, Prisma, StationKind, WarpBeamStatus, WeavingExecutionKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { createDoffTx } from "../machine-doff.service";
import { readDevereEnabled, resolveDokumaRollBirth, type DokumaRollBirth } from "../system-setting.service";
import { OPEN_MACHINE_RUN_WHERE, RUN_OPENABLE_ORDER_STATUSES, readDbNow } from "./machine-run-open.helper";
import { WARN_RUN_WITHOUT_ORDER } from "./machine-doff-open.helper";
import { assertProductionLineValid } from "./production-line.helper";
import { readRemainingM } from "./warp-beam-ledger.helper";
import { KK1_BEAM_CHANGE_WINDOW_MS, KK1_DOFF_NOTE_LABEL, KK1_DOFF_NOTE_ORDER } from "../../constants/dokuma-kk1";

type Tx = Prisma.TransactionClient;

/** KK1 gövdesinden gelen doğuş beyanı — controller zod'u `machineCode` XOR `weavingOrderId` garanti eder. */
export interface Kk1BirthInput {
  machineCode?: string | null;
  weavingOrderId?: string | null;
  /** Levent beyanı (yalnız `machineCode` ile) — `autoConsumeForRollTx`e override. */
  warpBeamId?: string | null;
  /** Çok hatlı tezgahta hat; varsayılan 1. */
  productionLineNo?: number | null;
}

export interface Kk1BirthResolution {
  /** Sunucunun bu tx'te doğurduğu indirme; A-yolu çok tezgahta NULL. */
  doffEventId: string | null;
  doffCode: string | null;
  machineId: string | null;
  /** Yalnız doff'suz A-yolunda `Roll.weavingOrderId`ye yazılır; doff varsa koşum zincirinden okunur. */
  weavingOrderId: string | null;
  warnings: string[];
}

interface OpenRunRow {
  id: string;
  machineId: string;
  productionLineNo: number;
  itemId: string | null;
  weavingOrderId: string | null;
  machine: { code: string };
  weavingOrder: { itemId: string | null; weavingOrderNumber: string } | null;
}

const OPEN_RUN_SELECT = {
  id: true,
  machineId: true,
  productionLineNo: true,
  itemId: true,
  weavingOrderId: true,
  machine: { select: { code: true } },
  weavingOrder: { select: { itemId: true, weavingOrderNumber: true } },
} satisfies Prisma.MachineRunSelect;

/** D17: koşumun deseni işin kumaşını ezer; uyuşmazlık uyarıdır, red değil. */
function itemMismatchWarning(run: OpenRunRow, rollItemId: string): string | null {
  const expected = run.itemId ?? run.weavingOrder?.itemId ?? null;
  if (!expected || expected === rollItemId) return null;
  return `${run.machine.code}: topun kumaşı koşumun/işin kumaşından farklı — kayıt yapıldı, kontrol edin.`;
}

async function birthFromRun(tx: Tx, run: OpenRunRow, note: string, ctx: { userId: string | null; itemId: string }): Promise<Kk1BirthResolution> {
  const doff = await createDoffTx(tx, {
    machineId: run.machineId,
    productionLineNo: run.productionLineNo,
    machineRunId: run.id,
    pieceCount: 1,
    counterAtDoff: null,
    counterSource: MachineDataSource.OPERATOR,
    notes: note,
    createdById: ctx.userId,
  });
  const warnings: string[] = [];
  if (!run.weavingOrderId) warnings.push(WARN_RUN_WITHOUT_ORDER);
  const mismatch = itemMismatchWarning(run, ctx.itemId);
  if (mismatch) warnings.push(mismatch);
  return { doffEventId: doff.id, doffCode: doff.code, machineId: run.machineId, weavingOrderId: run.weavingOrderId, warnings };
}

/** Tezgahı koda göre çözer: yok/pasif 404 `MACHINE_NOT_FOUND`, istasyonu WEAVING değil 400 `MACHINE_NOT_LOOM`. */
export async function resolveLoomByCodeTx(
  db: Pick<Tx, "machine">,
  machineCode: string,
): Promise<{ id: string; code: string; name: string; productionLineCount: number }> {
  const machine = await db.machine.findFirst({
    where: { code: machineCode, isActive: true },
    select: { id: true, code: true, name: true, productionLineCount: true, station: { select: { kind: true } } },
  });
  if (!machine) throw AppError.notFound("Tezgah bulunamadı veya pasif", { code: "MACHINE_NOT_FOUND", machineCode });
  if (machine.station.kind !== StationKind.WEAVING) {
    throw AppError.badRequest(`${machine.code} bir tezgah değil (istasyon türü ${machine.station.kind}) — top yalnız tezgahtan iner.`, {
      code: "MACHINE_NOT_LOOM",
      machineCode: machine.code,
      stationKind: machine.station.kind,
    });
  }
  return { id: machine.id, code: machine.code, name: machine.name, productionLineCount: machine.productionLineCount };
}

/** Hattaki açık koşum; yoksa 409 `MACHINE_NO_OPEN_RUN` (D16 — top DOĞMAZ). */
export async function requireOpenRunTx(db: Pick<Tx, "machineRun">, machine: { id: string; code: string }, productionLineNo: number): Promise<OpenRunRow> {
  const run = await db.machineRun.findFirst({
    where: { machineId: machine.id, productionLineNo, ...OPEN_MACHINE_RUN_WHERE },
    select: OPEN_RUN_SELECT,
  });
  if (!run) throw noOpenRunError(machine, productionLineNo);
  return run;
}

/** Tek kaynak: hem doğuş (`requireOpenRunTx`) hem ön-dolgu (`readKk1Context`) aynı 409'u atar — ekran doğuşta alacağı cevabı önceden görür. */
export function noOpenRunError(machine: { code: string }, productionLineNo: number): AppError {
  return AppError.conflict(`${machine.code} tezgahında (${productionLineNo}. hat) açık koşum yok — top kaydedilmedi; önce panelden "İş ver".`, {
    code: "MACHINE_NO_OPEN_RUN",
    machineCode: machine.code,
    productionLineNo,
  });
}

/**
 * KK1 doğuşunun tezgah/iş çözümü — tx içinde, 8021 kilidinden SONRA, `claimDoffForRollTx`'ten ÖNCE.
 * Döner: doğan doff (varsa) + yazılacak `weavingOrderId` (yalnız doff'suz) + uyarılar.
 */
export async function resolveKk1BirthTx(tx: Tx, input: Kk1BirthInput, ctx: { userId?: string | null; itemId: string }): Promise<Kk1BirthResolution> {
  const userId = ctx.userId ?? null;
  const lineNo = input.productionLineNo ?? 1;

  if (input.machineCode) {
    const machine = await resolveLoomByCodeTx(tx, input.machineCode);
    assertProductionLineValid(lineNo, machine.productionLineCount);
    const run = await requireOpenRunTx(tx, machine, lineNo);
    return birthFromRun(tx, run, KK1_DOFF_NOTE_LABEL, { userId, itemId: ctx.itemId });
  }

  if (input.weavingOrderId) {
    const order = await tx.weavingOrder.findUnique({
      where: { id: input.weavingOrderId },
      select: { id: true, weavingOrderNumber: true, status: true, executionKind: true, itemId: true },
    });
    if (!order) throw AppError.notFound("Dokuma iş emri bulunamadı", { code: "WEAVING_ORDER_NOT_FOUND", weavingOrderId: input.weavingOrderId });
    if (order.executionKind === WeavingExecutionKind.SUBCONTRACTED) {
      throw AppError.badRequest(`Dokuma iş emri ${order.weavingOrderNumber} fasona verilmiş — fason dokumanın topu makbuzla girer.`, {
        code: "WEAVING_ORDER_SUBCONTRACTED",
        weavingOrderId: order.id,
      });
    }
    if (!RUN_OPENABLE_ORDER_STATUSES.includes(order.status)) {
      throw AppError.conflict(`Dokuma iş emri ${order.weavingOrderNumber} ${order.status === "CANCELLED" ? "iptal edilmiş" : "kapatılmış"} — top bu işe bağlanamaz.`, {
        code: "WEAVING_ORDER_NOT_OPEN",
        weavingOrderId: order.id,
        status: order.status,
      });
    }
    const runs = await tx.machineRun.findMany({
      where: { weavingOrderId: order.id, ...OPEN_MACHINE_RUN_WHERE },
      select: OPEN_RUN_SELECT,
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    });
    if (runs.length === 0) {
      throw AppError.conflict(`Dokuma iş emri ${order.weavingOrderNumber} hiçbir tezgahta koşmuyor — top kaydedilmedi; önce panelden "İş ver".`, {
        code: "WEAVING_ORDER_NO_OPEN_RUN",
        weavingOrderId: order.id,
      });
    }
    if (runs.length === 1) return birthFromRun(tx, runs[0]!, KK1_DOFF_NOTE_ORDER, { userId, itemId: ctx.itemId });
    // D11: tezgah bilinmiyor → doff UYDURULMAZ, iş bağı kolona, levent tüketimi YOK.
    const warnings = [
      `Dokuma iş emri ${order.weavingOrderNumber} ${runs.length} tezgahta koşuyor (${runs.map((r) => r.machine.code).join(", ")}); tezgah bilinmediği için indirme ve levent tüketimi yazılmadı — top işe bağlandı.`,
    ];
    if (order.itemId && order.itemId !== ctx.itemId) warnings.push(`${order.weavingOrderNumber}: topun kumaşı işin kumaşından farklı — kayıt yapıldı, kontrol edin.`);
    return { doffEventId: null, doffCode: null, machineId: null, weavingOrderId: order.id, warnings };
  }

  throw AppError.badRequest("KK1 doğuşu için tezgah etiketi (machineCode) ya da iş emri (weavingOrderId) gerekli.", { code: "ROLL_BIRTH_INPUT_MISSING" });
}

// =============================================================================
// KK1 ÖN-DOLGU — `GET /api/machine-doffs/kk1-context?machineCode=` (D17: öneridir, red değil)
// =============================================================================
/** Ön-dolgu yanıtı; tel tipi mobil `kk1` ekranının aynasıdır (S2). */
export interface Kk1Context {
  machine: { id: string; code: string; name: string; productionLineCount: number };
  run: {
    id: string;
    productionLineNo: number;
    startedAt: Date;
    weavingOrder: { id: string; weavingOrderNumber: string } | null;
    item: { id: string; code: string; name: string } | null;
    color: { id: string; name: string } | null;
    warpSpec: { id: string; code: string; name: string; takeUpPct: Prisma.Decimal | null } | null;
  };
  beams: {
    mounted: { id: string; beamNo: string; position: number | null; remainingM: Prisma.Decimal }[];
    /** Son `KK1_BEAM_CHANGE_WINDOW_HOURS` içindeki en yeni takma/sökme; yoksa null (operatör levent beyanı sorulmaz). */
    recentChange: { at: Date; dismounted: { id: string; beamNo: string } | null; mounted: { id: string; beamNo: string } | null } | null;
  };
  rollBirth: DokumaRollBirth;
}

const WARP_SPEC_SELECT = { id: true, code: true, name: true, takeUpPct: true } satisfies Prisma.WarpSpecSelect;

/**
 * KK1 ön-dolgu: tezgah → açık koşum (iş/kumaş/renk/çözgü kartı) → takılı leventler + son 12 sa levent değişimi.
 * Hatalar `resolveLoomByCodeTx`/`requireOpenRunTx` ile aynı (404 MACHINE_NOT_FOUND · 400 MACHINE_NOT_LOOM ·
 * 409 MACHINE_NO_OPEN_RUN) — KK1 ekranı doğuşta alacağı cevabı etiketi okuttuğu anda görür.
 * Havuz client ile, tx AÇMAZ (salt okuma). Koşumun deseni işin kumaşını ezer (D17).
 */
export async function readKk1Context(machineCode: string, productionLineNo?: number | null): Promise<Kk1Context> {
  const lineNo = productionLineNo ?? 1;
  const machine = await resolveLoomByCodeTx(prisma, machineCode);
  assertProductionLineValid(lineNo, machine.productionLineCount);
  const run = await prisma.machineRun.findFirst({
    where: { machineId: machine.id, productionLineNo: lineNo, ...OPEN_MACHINE_RUN_WHERE },
    select: {
      id: true,
      productionLineNo: true,
      startedAt: true,
      weavingOrder: {
        select: {
          id: true,
          weavingOrderNumber: true,
          item: { select: { id: true, code: true, name: true, warpSpec: { select: WARP_SPEC_SELECT } } },
          color: { select: { id: true, name: true } },
          warpSpec: { select: WARP_SPEC_SELECT },
        },
      },
      item: { select: { id: true, code: true, name: true, warpSpec: { select: WARP_SPEC_SELECT } } },
      color: { select: { id: true, name: true } },
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  if (!run) throw noOpenRunError(machine, lineNo);
  const item = run.item ?? run.weavingOrder?.item ?? null;
  const warpSpec = run.weavingOrder?.warpSpec ?? item?.warpSpec ?? null;

  let mounted: Kk1Context["beams"]["mounted"] = [];
  let recentChange: Kk1Context["beams"]["recentChange"] = null;
  if (await readDevereEnabled()) {
    const beams = await prisma.warpBeam.findMany({
      where: { currentMachineId: machine.id, status: WarpBeamStatus.MOUNTED },
      select: { id: true, beamNo: true, currentPosition: true },
      orderBy: [{ currentPosition: "asc" }, { beamNo: "asc" }, { id: "asc" }],
    });
    mounted = [];
    for (const b of beams) mounted.push({ id: b.id, beamNo: b.beamNo, position: b.currentPosition, remainingM: await readRemainingM(prisma, b.id) });
    // Pencere `autoConsumeForRollTx` override şartıyla AYNI sabit: ekranın sorduğu levent sunucunun kabul edeceği leventtir.
    const since = new Date((await readDbNow(prisma)).getTime() - KK1_BEAM_CHANGE_WINDOW_MS);
    const events = await prisma.warpBeamEvent.findMany({
      where: { machineId: machine.id, kind: { in: ["MOUNTED", "DISMOUNTED"] }, createdAt: { gte: since } },
      select: { kind: true, createdAt: true, beam: { select: { id: true, beamNo: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (events.length > 0) {
      const latest = events[0]!;
      const pick = (kind: string) => events.find((e) => e.kind === kind)?.beam ?? null;
      recentChange = { at: latest.createdAt, dismounted: pick("DISMOUNTED"), mounted: pick("MOUNTED") };
    }
  }

  return {
    machine,
    run: {
      id: run.id,
      productionLineNo: run.productionLineNo,
      startedAt: run.startedAt,
      weavingOrder: run.weavingOrder ? { id: run.weavingOrder.id, weavingOrderNumber: run.weavingOrder.weavingOrderNumber } : null,
      item: item ? { id: item.id, code: item.code, name: item.name } : null,
      color: run.color ?? run.weavingOrder?.color ?? null,
      warpSpec,
    },
    beams: { mounted, recentChange },
    rollBirth: await resolveDokumaRollBirth(),
  };
}
