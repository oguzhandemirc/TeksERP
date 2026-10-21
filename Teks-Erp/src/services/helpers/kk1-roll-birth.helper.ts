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
import { MachineDataSource, Prisma, StationKind, WeavingExecutionKind } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { createDoffTx } from "../machine-doff.service";
import { OPEN_MACHINE_RUN_WHERE, RUN_OPENABLE_ORDER_STATUSES } from "./machine-run-open.helper";
import { WARN_RUN_WITHOUT_ORDER } from "./machine-doff-open.helper";
import { assertProductionLineValid } from "./production-line.helper";
import { KK1_DOFF_NOTE_LABEL, KK1_DOFF_NOTE_ORDER } from "../../constants/dokuma-kk1";

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
  if (!run) {
    throw AppError.conflict(`${machine.code} tezgahında (${productionLineNo}. hat) açık koşum yok — top kaydedilmedi; önce panelden "İş ver".`, {
      code: "MACHINE_NO_OPEN_RUN",
      machineCode: machine.code,
      productionLineNo,
    });
  }
  return run;
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
