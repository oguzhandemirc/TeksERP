// =============================================================================
// STOK DEFTERİ — ÜRETİME ALMA ÇIKIŞI (PRODUCTION_ISSUE) tek yazıcısı
// =============================================================================
// Raftaki (stok kümesindeki) bir top üretime alınınca mal raftan İNER: defter
// `PRODUCTION` olayı + `PRODUCTION_ISSUE` sebep koduyla bir ÇIKIŞ satırı alır.
// Bu satırı yazan DÖRT yol vardı (üretime alma · manuel taşıma · elle top ·
// redye ayırma) ve üçü yazmıyordu — raf topu üretime satırsız giriyor, mutabakat
// "rafta" sayıyordu (ölçüldü 2026-09-13/14, hüküm dosyası §5). Yüklem tek yerde
// yaşar: stok kümesinde ∧ deposu var ∧ metraj yazılabilir.
//
// ⚠️ Anlık görüntü CLAIM ÖNCESİ olmalı: claim sonrası statü IN_PRODUCTION'dır ve
// "nereden çıktı"yı söylemez. Çağıran tx içinde taze okuduğu satırları verir.
// =============================================================================
import { Prisma, WarehouseEventType, type RollStatus } from "@prisma/client";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { postStockMove, qtyYazilabilir } from "./warehouse-ledger.helper";
import { reverseStockMove } from "./warehouse-ledger-reverse.helper";
import { WAREHOUSE_STOCK_STATUSES } from "./warehouse-stock.helper";

type Tx = Prisma.TransactionClient;

/** Claim ÖNCESİ okunmuş top — yön ve metraj buradan gelir. */
export interface ProductionIssueCandidate {
  id: string;
  status: RollStatus;
  warehouseId: string | null;
  currentQty: Prisma.Decimal | number | string;
}

/** Stok kümesinden üretime çıkan top için satır yazılır mı — TEK yüklem. */
export function needsProductionIssue(r: ProductionIssueCandidate): boolean {
  return r.warehouseId !== null && WAREHOUSE_STOCK_STATUSES.includes(r.status) && qtyYazilabilir(r.currentQty);
}

/**
 * Verilen topların stok kümesinden çıkanları için `PRODUCTION_ISSUE` satırı
 * yazar; zaten üretimde olan (stok dışı → stok dışı) top satır almaz.
 * Yazılan satır sayısını döner.
 */
export async function postProductionIssuesTx(
  tx: Tx,
  rolls: readonly ProductionIssueCandidate[],
  args: { workOrderStepId: string; userId?: string | null },
): Promise<number> {
  let written = 0;
  for (const r of rolls) {
    if (!needsProductionIssue(r)) continue;
    await postStockMove(tx, {
      rollId: r.id,
      eventType: WarehouseEventType.PRODUCTION,
      qty: r.currentQty,
      from: { warehouseId: r.warehouseId as string, status: r.status },
      reasonCode: STOCK_MOVE_REASON.PRODUCTION_ISSUE,
      workOrderStepId: args.workOrderStepId,
      userId: args.userId ?? null,
    });
    written++;
  }
  return written;
}

/** İş emri iptalinde dönüş satırlarının notu — zaman çizelgesi aynı eylemi bu notla gruplar. */
export function cancelReturnNote(workOrderNumber: string): string {
  return `İş emri iptali ${workOrderNumber}`;
}

/**
 * Topun geri alınmamış üretime alma satırı: önce verilen adımlara damgalı, yoksa damgasız
 * (geçiş dönemi). Top Çıkar ve iş emri iptali AYNI satırı bulur; tersi bu satıra bağlanır.
 */
export async function findOpenProductionIssueTx(tx: Tx, rollId: string, stepIds: readonly string[]) {
  const base = { rollId, reasonCode: STOCK_MOVE_REASON.PRODUCTION_ISSUE, reversesMovementId: null, reversedBy: { none: {} } };
  const select = { id: true, fromStatus: true, fromWarehouseId: true, qty: true, workOrderStepId: true } as const;
  return (
    (await tx.warehouseMovement.findFirst({ where: { ...base, workOrderStepId: { in: [...stepIds] } }, orderBy: { createdAt: "desc" }, select })) ??
    (await tx.warehouseMovement.findFirst({ where: { ...base, workOrderStepId: null }, orderBy: { createdAt: "desc" }, select }))
  );
}

/**
 * İş emri DEVRİ / bölmesi: topla birlikte taşınan açık üretime alma satırı YENİ iş emrinin adımına bağlanır.
 * İleri satır DEĞİŞMEZ (defter): eski adıma damgalı satırın bağlı tersi (`PRODUCTION_ISSUE_TRANSFER`) + yeni adıma
 * damgalı yeni `PRODUCTION_ISSUE`, aynı tx'te, net 0. Aksi hâlde yeni iş emrindeki Top Çıkar ve iptal
 * açık satırı bulamaz, tersi yazılmaz ve defter topu "üretimde" sayar (ölçüldü 2026-09-26).
 * Damgasız (geçiş dönemi) satır adımdan bağımsız bulunur, dokunulmaz. Bağlanan satır sayısını döner.
 */
export async function rebindProductionIssuesTx(
  tx: Tx,
  rollIds: readonly string[],
  oldToNew: ReadonlyMap<string, string>,
  ctx: { note: string; userId?: string | null },
): Promise<number> {
  if (rollIds.length === 0 || oldToNew.size === 0) return 0;
  const open = await tx.warehouseMovement.findMany({
    where: {
      rollId: { in: [...rollIds] },
      reasonCode: STOCK_MOVE_REASON.PRODUCTION_ISSUE,
      reversesMovementId: null,
      reversedBy: { none: {} },
      workOrderStepId: { in: [...oldToNew.keys()] },
    },
    orderBy: [{ rollId: "asc" }, { createdAt: "asc" }],
    select: { id: true, rollId: true, qty: true, fromWarehouseId: true, fromStatus: true, workOrderStepId: true },
  });
  for (const m of open) {
    await reverseStockMove(tx, m.id, { reasonCode: STOCK_MOVE_REASON.PRODUCTION_ISSUE_TRANSFER, userId: ctx.userId ?? null, notes: ctx.note });
    await postStockMove(tx, {
      rollId: m.rollId,
      eventType: WarehouseEventType.PRODUCTION,
      qty: m.qty,
      from: m.fromStatus ? { warehouseId: m.fromWarehouseId, status: m.fromStatus } : undefined,
      reasonCode: STOCK_MOVE_REASON.PRODUCTION_ISSUE,
      workOrderStepId: oldToNew.get(m.workOrderStepId as string) ?? null,
      userId: ctx.userId ?? null,
      notes: ctx.note,
    });
  }
  return open.length;
}

/** Devir çiftinin görünümü — ters satır (eski iş emri) + eşi olan yeni üretime giriş (yeni iş emri). */
export interface IssueTransfer {
  reversalId: string;
  barcode: string | null;
  qty: number;
  userId: string | null;
  notes: string | null;
  outAt: Date;
  outStepId: string | null;
  fromWorkOrderNumber: string | null;
  inAt: Date | null;
  inStepId: string | null;
  toWorkOrderNumber: string | null;
}

type LedgerReader = Pick<Prisma.TransactionClient, "warehouseMovement">;

/**
 * Adım kümesine ÇIKAN ya da GİREN taraftan değen devir çiftleri (İE zaman çizelgesi). Eş: aynı topun
 * tersten sonra yazılan ilk eşlenmemiş `PRODUCTION_ISSUE`i — `rebindProductionIssuesTx` ikisini aynı
 * tx'te art arda yazar; eşit ms'de kimlik sırası rastgele olduğu için "sonra" `>=` ile okunur ve
 * tersin kendi ileri satırı dışlanır. Yalnız GÖRÜNÜM: karar ya da sayı üretmez.
 */
export async function listIssueTransfers(db: LedgerReader, stepIds: readonly string[]): Promise<IssueTransfer[]> {
  if (stepIds.length === 0) return [];
  const reasons = [STOCK_MOVE_REASON.PRODUCTION_ISSUE, STOCK_MOVE_REASON.PRODUCTION_ISSUE_TRANSFER];
  const touching = await db.warehouseMovement.findMany({
    where: { reasonCode: { in: reasons }, workOrderStepId: { in: [...stepIds] } },
    distinct: ["rollId"],
    select: { rollId: true },
  });
  if (touching.length === 0) return [];
  const rows = await db.warehouseMovement.findMany({
    where: { rollId: { in: touching.map((t) => t.rollId) }, reasonCode: { in: reasons } },
    orderBy: [{ rollId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, rollId: true, reasonCode: true, qty: true, createdAt: true, userId: true, notes: true,
      reversesMovementId: true, workOrderStepId: true,
      workOrderStep: { select: { workOrder: { select: { workOrderNumber: true } } } },
      roll: { select: { barcode: true } },
    },
  });
  const inSteps = new Set(stepIds);
  const paired = new Set<string>();
  const out: IssueTransfer[] = [];
  for (const rev of rows) {
    if (rev.reasonCode !== STOCK_MOVE_REASON.PRODUCTION_ISSUE_TRANSFER) continue;
    const mate = rows.find(
      (f) =>
        f.rollId === rev.rollId && f.reasonCode === STOCK_MOVE_REASON.PRODUCTION_ISSUE && f.id !== rev.reversesMovementId &&
        !paired.has(f.id) && f.createdAt >= rev.createdAt,
    );
    if (mate) paired.add(mate.id);
    const touchesOut = rev.workOrderStepId !== null && inSteps.has(rev.workOrderStepId);
    const touchesIn = mate?.workOrderStepId != null && inSteps.has(mate.workOrderStepId);
    if (!touchesOut && !touchesIn) continue;
    out.push({
      reversalId: rev.id, barcode: rev.roll?.barcode ?? null, qty: Number(rev.qty), userId: rev.userId, notes: rev.notes,
      outAt: rev.createdAt, outStepId: rev.workOrderStepId, fromWorkOrderNumber: rev.workOrderStep?.workOrder.workOrderNumber ?? null,
      inAt: mate?.createdAt ?? null, inStepId: mate?.workOrderStepId ?? null,
      toWorkOrderNumber: mate?.workOrderStep?.workOrder.workOrderNumber ?? null,
    });
  }
  return out;
}
