// =============================================================================
// İŞ EMRİ "GELEN" — girdi kökü topların gelen belge satırlarından metre + kg + en + müşteri parti no + kaynak belgeler
// (belge tanıt 3 aşama, 2026-11-09; salt okunur)
// =============================================================================
// Değerler yalnız topa DOĞRUDAN bağlı satırdan okunur (`CustomerDeliveryNoteLine.rollId`): ARABA özet satırının kg'si/eni topa
// yazılmaz, bölünmüş çocuğun atasının değeri çocuğun değildir. Kg: bir kökün satırı yok ya da satırında kg yoksa toplam null —
// kısmi toplam gösterilmez (sessiz eksik olmaz). En: her kökte var ve hepsi aynıysa tek değer, değilse null (aynı ilke).
// Gelen kumaş adı / gelen renk (müşteri BEYANI, İE hedefi değil): en gibi — her kökte var ve hepsi aynıysa tek değer, değilse null.
// Müşteri parti no: satırlardaki tekil değerler, sıralı birleşik. Hiçbir kök belgeden doğmadıysa `null` (kart çizilmez).
// Geliş biçimi: her kökün satırı ARABA (özet) ise müşteri kumaşı TEK PARÇA geldi (fiziksel top yok), aksi top top.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { whereRollsOfWorkOrder } from "./workorder-rolls.helper";

type Db = Pick<Prisma.TransactionClient, "customerDeliveryNoteLine">;
type RollDb = Pick<Prisma.TransactionClient, "roll">;

/** Belge başlığı alanları (hepsi null olabilir); `sender` yalnız malın sahibinden FARKLIYSA dolu. */
export interface WoIncomingNote {
  id: string;
  noteNo: string;
  senderDocNo: string | null;
  senderDocDate: Date | null;
  sender: string | null;
  declaredTopCount: number | null;
  customerOrderNo: string | null;
  processText: string | null;
}

export interface WoIncoming {
  meters: Prisma.Decimal;
  kg: Prisma.Decimal | null;
  kgSource: "DOCUMENT" | null;
  /** Kökleri doğuran gelen belge(ler), belge no sırasıyla. */
  notes: WoIncomingNote[];
  widthCm: Prisma.Decimal | null;
  customerBatchNo: string | null;
  itemText: string | null;
  colorText: string | null;
  /** Girdi kökü sayısı ve kimlikleri (tablet tek parçayı "bağlı top" diye listelemesin diye). */
  rootCount: number;
  rootRollIds: string[];
  /** SINGLE_PIECE: her kökün satırı ARABA (özet satırı) — kumaş tek parça geldi; ROLLS: en az bir kök top satırından. */
  arrivalForm: "SINGLE_PIECE" | "ROLLS";
}

type IncomingLine = { rollId: string | null; lineKind?: "TOP" | "ARABA"; weightKg: Prisma.Decimal | null; widthCm: Prisma.Decimal | null; customerBatchNo: string | null; itemText?: string | null; colorText?: string | null; note: IncomingNoteRow };

type IncomingNoteRow = {
  id: string; noteNo: string;
  senderDocNo?: string | null; senderDocDate?: Date | null; senderText?: string | null; declaredTopCount?: number | null;
  customerOrderNo?: string | null; processText?: string | null;
  ownerCustomerId?: string | null; senderCustomerId?: string | null; senderCustomer?: { name: string } | null;
};

const clean = (v: string | null | undefined): string | null => v?.trim() || null;

function toNote(n: IncomingNoteRow): WoIncomingNote {
  const differs = !!n.senderCustomerId && n.senderCustomerId !== n.ownerCustomerId;
  const sender = n.senderCustomerId ? (differs ? clean(n.senderCustomer?.name) : null) : clean(n.senderText);
  return {
    id: n.id, noteNo: n.noteNo, senderDocNo: clean(n.senderDocNo), senderDocDate: n.senderDocDate ?? null, sender,
    declaredTopCount: n.declaredTopCount ?? null, customerOrderNo: clean(n.customerOrderNo), processText: clean(n.processText),
  };
}

/** Her kökte aynı (kırpılmış metin birebir) dolu metin → o; aksi null. */
function sameText(values: ReadonlyArray<string | null | undefined>): string | null {
  const t = values.map((v) => v?.trim() || null);
  return t.length > 0 && t[0] && t.every((v) => v === t[0]) ? t[0] : null;
}

/** Saf: kök kimlikleri + satırları → gelen bloğu (bekçi DB'siz ölçer). */
export function foldWoIncoming(meters: Prisma.Decimal, rootIds: readonly string[], lines: readonly IncomingLine[]): WoIncoming | null {
  if (rootIds.length === 0 || lines.length === 0) return null;
  const byRoll = new Map(lines.map((l) => [l.rollId!, l]));
  let kg: Prisma.Decimal | null = new Prisma.Decimal(0);
  let width: Prisma.Decimal | null | undefined;
  for (const id of rootIds) {
    const l = byRoll.get(id);
    kg = kg && l?.weightKg != null ? kg.plus(l.weightKg) : null;
    const w = l?.widthCm ?? null;
    width = width === undefined ? w : width && w && width.equals(w) ? width : null;
  }
  const notes = [...new Map(lines.map((l) => [l.note.id, l.note])).values()].map(toNote).sort((a, b) => a.noteNo.localeCompare(b.noteNo));
  const batches = [...new Set(lines.map((l) => l.customerBatchNo?.trim()).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  const rootLines = rootIds.map((id) => byRoll.get(id));
  return {
    meters, kg, kgSource: kg === null ? null : "DOCUMENT", notes, widthCm: width ?? null, customerBatchNo: batches.length ? batches.join(", ") : null,
    itemText: sameText(rootLines.map((l) => l?.itemText)), colorText: sameText(rootLines.map((l) => l?.colorText)),
    rootCount: rootIds.length, rootRollIds: [...rootIds],
    arrivalForm: rootLines.every((l) => l?.lineKind === "ARABA") ? "SINGLE_PIECE" : "ROLLS",
  };
}

export async function computeWoIncoming(input: { meters: Prisma.Decimal; rootIds: readonly string[] }, db: Db = prisma): Promise<WoIncoming | null> {
  if (input.rootIds.length === 0) return null;
  const lines = await db.customerDeliveryNoteLine.findMany({
    where: { rollId: { in: [...input.rootIds] } },
    select: { rollId: true, lineKind: true, weightKg: true, widthCm: true, customerBatchNo: true, itemText: true, colorText: true, note: { select: { id: true, noteNo: true, senderDocNo: true, senderDocDate: true, senderText: true, declaredTopCount: true, customerOrderNo: true, processText: true, ownerCustomerId: true, senderCustomerId: true, senderCustomer: { select: { name: true } } } } },
  });
  return foldWoIncoming(input.meters, input.rootIds, lines);
}

/**
 * Adımsız (rotasız) ya da girdisi henüz adıma işlenmemiş İE için girdi kökleri: İE'nin topları (`whereRollsOfWorkOrder`,
 * parti üyeliği dahil) − iptal/stok; kök = atası bu kümede olmayan. `computeWoInput` sayımına DOKUNMAZ — yalnız Gelen bloğu.
 */
export async function woMemberRootInput(workOrderId: string, db: RollDb = prisma): Promise<{ meters: Prisma.Decimal; rootIds: string[] } | null> {
  const rolls = await db.roll.findMany({
    where: { AND: [whereRollsOfWorkOrder(workOrderId), { status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] } }] },
    select: { id: true, parentRollId: true, initialQty: true },
  });
  const ids = new Set(rolls.map((r) => r.id));
  const roots = rolls.filter((r) => !r.parentRollId || !ids.has(r.parentRollId));
  if (roots.length === 0) return null;
  return { meters: roots.reduce((a, r) => a.plus(r.initialQty), new Prisma.Decimal(0)), rootIds: roots.map((r) => r.id) };
}
