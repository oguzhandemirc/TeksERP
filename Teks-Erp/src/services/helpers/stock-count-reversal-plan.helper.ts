// =============================================================================
// SAYIM STORNO PLANI — "ne olacak" kararı (yazmayan katman)
// =============================================================================
// Önizleme ile stornonun KENDİSİ aynı planı kurar: ayrışırsa önizleme bir şey
// gösterir, işlem başkasını yapar. Bu dosya yalnız OKUR ve sınıflandırır:
//   • belge düzeyi engeller (statü · önceki storno · LIFO)
//   • top başına dal: RESTORE (rafına döner) · LEDGER_ONLY (elle geri alınmış,
//     yalnız defter karşılığı) · ALREADY_REVERSED (ters satır zaten yazılmış)
//   • iplik kalemi başına net ters ADJUST ve storno sonrası bakiye
//
// Servis (claim + yazım + audit) `stock-count-reversal.service.ts`tedir; ayrım
// lint tavanı için DEĞİL, "karar" ile "yazım"ı ayrı okunur tutmak için yapıldı
// (d5'in karne bölünmesiyle aynı emsal).
// =============================================================================
import { Prisma, RollStatus, StockCountLineKind, StockCountStatus, WarehouseEventType, YarnMovementKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { readIplikEnabled } from "../system-setting.service";
import { yarnMovementSign } from "../yarn.service";
import { resolveRestoreTargetStatus } from "./roll-cancel-restore.helper";
import { VARIANCE_SOURCES } from "../../constants/variance-reasons";
import { ROLL_STATUS_TR } from "../../constants/status-labels";
import { stockCountCancelReason } from "../stock-count.service";

export type Db = Prisma.TransactionClient | typeof prisma;

/** Topun stornoda göreceği işlem — önizleme bunu satır satır basar. */
export type ReversalRollAction = "RESTORE" | "LEDGER_ONLY" | "ALREADY_REVERSED";

export interface ReversalRollPlan {
  rollId: string;
  barcode: string | null;
  qty: Prisma.Decimal;
  varianceId: string | null;
  /** `RESTORE`da dönülecek raf; diğer dallarda null (statüye dokunulmaz). */
  targetStatus: RollStatus | null;
  goodsReceiptId: string | null;
  /** Terslenecek İLERİ satır (bu sayımın CANCEL'ı); yoksa null — eski kayıt, bağsız yazılır. */
  cancelMovementId: string | null;
  /** İleri satır `fromStatus` taşıyor mu — taşımıyorsa yön aynalanamaz, uç elle kurulur. */
  cancelHasStatus: boolean;
  /**
   * Ters satırın GİRİŞ ucundaki statü — KANITTAN türetilir (ileri satırın
   * `fromStatus`ı), topun bugünkü statüsünden DEĞİL. `null` ⇒ kanıt yok ⇒ satır
   * yazılmaz, çağıran 409 verir.
   */
  ledgerToStatus: RollStatus | null;
  /** Ters satırın GİRİŞ ucundaki depo — aynı kanıttan (`fromWarehouseId`). */
  ledgerToWarehouseId: string | null;
  action: ReversalRollAction;
  /** Dalın gerekçesi (LEDGER_ONLY/ALREADY_REVERSED) — önizlemede görünür. */
  note: string | null;
  blocker: string | null;
}

export interface ReversalYarnPlan {
  itemId: string;
  itemName: string;
  /** Sayımın bakiyeye net etkisi (işaretli); storno bunun tersini yazar. */
  countNetKg: Prisma.Decimal;
  reversalKind: YarnMovementKind;
  balanceKg: Prisma.Decimal;
  balanceAfterKg: Prisma.Decimal;
}

export interface ReversalPlan {
  countId: string;
  countNo: string;
  warehouseId: string;
  blockers: string[];
  rolls: ReversalRollPlan[];
  yarn: ReversalYarnPlan[];
}

export interface CountHead {
  id: string;
  countNo: string;
  warehouseId: string;
  status: StockCountStatus;
  completedAt: Date | null;
  reversedAt: Date | null;
}

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

/** Belge düzeyi engeller — statü, önceki storno ve LIFO. Önizleme ve storno aynı listeyi görür. */
export async function documentBlockers(db: Db, count: CountHead, opts: { afterClaim: boolean }): Promise<string[]> {
  const out: string[] = [];
  if (count.status !== StockCountStatus.COMPLETED) out.push("Yalnız tamamlanmış sayım stornolanır.");
  if (count.reversedAt && !opts.afterClaim) out.push("Bu sayım zaten stornolanmış.");
  if (count.completedAt) {
    const later = await db.stockCount.findFirst({
      where: {
        warehouseId: count.warehouseId,
        status: StockCountStatus.COMPLETED,
        reversedAt: null,
        completedAt: { gt: count.completedAt },
        id: { not: count.id },
      },
      orderBy: { completedAt: "desc" },
      select: { countNo: true },
    });
    if (later) out.push(`Bu depoda daha sonra tamamlanmış ${later.countNo} var — önce o stornolanmalı.`);
  }
  return out;
}

/** Sayımın düşürdüğü toplar ve her birinin geri dönüş planı. */
async function planRolls(db: Db, count: CountHead): Promise<ReversalRollPlan[]> {
  const lines = await db.stockCountLine.findMany({
    where: { stockCountId: count.id, kind: StockCountLineKind.ROLL, found: false, outOfScopeReason: null, rollId: { not: null } },
    select: { rollId: true },
    orderBy: { createdAt: "asc" },
  });
  const rollIds = lines.map((l) => l.rollId as string);
  if (rollIds.length === 0) return [];

  const rolls = await db.roll.findMany({
    where: { id: { in: rollIds } },
    select: { id: true, barcode: true, status: true, cancelReason: true, preCancelStatus: true, warehouseId: true, goodsReceiptId: true },
  });
  const variances = await db.rollVariance.findMany({
    where: {
      rollId: { in: rollIds },
      source: VARIANCE_SOURCES.STOCK_COUNT,
      reversedAt: null,
      OR: [{ sourceRefId: count.id }, { sourceRefId: null, reasonText: stockCountCancelReason(count.countNo) }],
    },
    select: { id: true, rollId: true, qty: true },
  });
  // TESPİT TEK ALANDAN: "bu geri alma deftere yazıldı mı" sorusunun cevabı, bu
  // sayımın İLERİ (CANCEL) satırının terslenmiş olup olmadığıdır (`reversesMovementId`
  // zinciri — tasarım D2a/D2b). Tip sayma / belge bağıyla eşleme YAKLAŞIKTI ve
  // kardeş sayımın ters satırını sedde takıyordu (denetim 2026-09-12).
  const cancelRows = await db.warehouseMovement.findMany({
    // ⚠️ `reversesMovementId: null` — üçlü (sayım · tip · top) TEKİLLİK GARANTİSİ
    // DEĞİLDİR; terslenmiş satırı yakalarsak ikinci turda onu tekrar terslemeye
    // çalışır ve P2002 yanıltıcı hataya dönerdi (6e'nin uyarısı).
    where: {
      rollId: { in: rollIds },
      stockCountId: count.id,
      eventType: WarehouseEventType.CANCEL,
      reversesMovementId: null,
    },
    // ⚠️ `fromWarehouseId` de okunur: ters satırın GİRİŞ UCU bu satırın kanıtıdır.
    // Sayımın deposunu kullanmak yaklaşıktır — top geri alındıktan sonra transfer
    // olmuşsa sayımın deposu artık topun yeri değildir.
    select: {
      id: true, rollId: true, fromStatus: true, fromWarehouseId: true,
      reversedBy: { select: { id: true }, take: 1 },
    },
    // Sıra TANIMLI olmalı: aşağıdaki Map'te "son kazanır" ve sırasız okuma aynı
    // girdide farklı satır seçebilirdi (top başına birden çok ileri satır olabilir).
    orderBy: { createdAt: "asc" },
  });
  // ⚠️ TOP BAŞINA BİRDEN ÇOK ileri satır olabilir (eski veri · elle eklenmiş satır).
  // Seçim kuralı: TERSLENMEMİŞ olanı al; hiçbiri terslenmemişse dal ALREADY_REVERSED.
  // `reversesMovementId: null` yüklemi "bu satır ters kayıt DEĞİL" der, "terslenmemiş"
  // DEMEZ — ikisini karıştırmak terslenmiş satırı yeniden terslemeye çalışmaktır
  // (ölçüldü: §6m senaryosu bu hatayı kırmızı verdi).
  const cancelByRoll = new Map<string, typeof cancelRows>();
  for (const w of cancelRows) cancelByRoll.set(w.rollId, [...(cancelByRoll.get(w.rollId) ?? []), w]);
  const byRoll = new Map(rolls.map((r) => [r.id, r]));
  const expectedReason = stockCountCancelReason(count.countNo);

  return rollIds.map((rollId) => {
    const roll = byRoll.get(rollId);
    const own = variances.filter((v) => v.rollId === rollId);
    let blocker: string | null = null;
    if (!roll) blocker = "Top kaydı bulunamadı";
    else if (own.length !== 1) blocker = own.length === 0 ? "Sayımın sapma kaydı bulunamadı" : "Birden çok sapma kaydı var";

    const cancelledByThisCount =
      roll?.status === RollStatus.CANCELLED && roll.cancelReason === expectedReason;
    if (!blocker && cancelledByThisCount && roll && roll.warehouseId !== count.warehouseId) {
      blocker = "Deposu değişmiş";
    }
    let action: ReversalRollAction = cancelledByThisCount ? "RESTORE" : "LEDGER_ONLY";
    let note: string | null = cancelledByThisCount
      ? null
      : `Sayımdan sonra elle geri alınmış ya da başka işlem görmüş (şu an: ${roll ? ROLL_STATUS_TR[roll.status] : "—"}) — yalnız defter karşılığı yazılır`;
    const fwdRows = cancelByRoll.get(rollId) ?? [];
    const cancel = fwdRows.find((w) => w.reversedBy.length === 0);
    if (!cancel && fwdRows.length > 0) {
      action = "ALREADY_REVERSED";
      note = "İleri defter satırı zaten terslenmiş — yalnız sapma damgası atılır";
    }
    const target =
      action === "RESTORE" && roll && !blocker ? resolveRestoreTargetStatus(roll.preCancelStatus) : null;
    return {
      rollId,
      barcode: roll?.barcode ?? null,
      qty: own[0] ? D(own[0].qty) : D(0),
      varianceId: own[0]?.id ?? null,
      targetStatus: target,
      goodsReceiptId: roll?.goodsReceiptId ?? null,
      cancelMovementId: cancel?.id ?? null,
      cancelHasStatus: cancel?.fromStatus != null,
      // ⚠️ UÇ KANITTAN TÜRETİLİR, topun BUGÜNKÜ statüsünden DEĞİL (2026-09-13).
      //
      // Eski zincir `target ?? roll?.status` idi ve `LEDGER_ONLY` dalında `target`
      // boş olduğu için topun O ANKİ statüsünü yazıyordu. Top geri alındıktan sonra
      // yoluna devam etmişse (üretime alındı · fasona çıktı · sevk edildi · fire)
      // satır "top stok kümesine IN_PRODUCTION statüsünde girdi" diyordu — HİÇ
      // OLMAMIŞ bir olay. Kanıt sayımın KENDİ ileri `CANCEL` satırındadır: sayım
      // topu düşürürken gözlediği rafı hem `preCancelStatus`a hem o satırın
      // `fromStatus`/`fromWarehouseId` ucuna yazar, elle geri alma da TAM o rafa
      // döner. `preCancelStatus` kanıt DEĞİL: geri alma onu aynı update'te
      // `null`'lar, yani storno anında boştur.
      //
      // ⚠️ `roll?.status` FALLBACK'İ BİLEREK KALDIRILDI: kanıt yoksa satır
      // yazılmamalı ve servis bunu zaten `!r.ledgerToStatus` ile 409'a çeviriyor.
      // Yani düzeltme bir dal EKLEMEK değil, yanlış bir fallback'i ÇIKARMAK.
      ledgerToStatus: target ?? cancel?.fromStatus ?? null,
      /** Ters satırın giriş ucundaki depo — ileri satırın kanıtı. */
      ledgerToWarehouseId: cancel?.fromWarehouseId ?? null,
      action,
      note,
      blocker,
    };
  });
}

/** Sayımın iplik defterine net etkisi — goods-receipt stornosunun net deseni. */
async function planYarn(db: Db, count: CountHead): Promise<ReversalYarnPlan[]> {
  const rows = await db.yarnMovement.findMany({
    where: { stockCountId: count.id },
    select: { itemId: true, kind: true, qtyKg: true, item: { select: { name: true } } },
  });
  const nets = new Map<string, { itemName: string; net: Prisma.Decimal }>();
  for (const r of rows) {
    const cur = nets.get(r.itemId) ?? { itemName: r.item.name, net: D(0) };
    cur.net = cur.net.plus(D(r.qtyKg).mul(yarnMovementSign(r.kind)));
    nets.set(r.itemId, cur);
  }
  const out: ReversalYarnPlan[] = [];
  for (const [itemId, n] of nets) {
    if (n.net.isZero()) continue;
    const stock = await db.yarnStock.findUnique({
      where: { itemId_warehouseId: { itemId, warehouseId: count.warehouseId } },
      select: { balanceKg: true },
    });
    const balance = D(stock?.balanceKg ?? 0);
    out.push({
      itemId,
      itemName: n.itemName,
      countNetKg: n.net,
      reversalKind: n.net.gt(0) ? YarnMovementKind.ADJUST_OUT : YarnMovementKind.ADJUST_IN,
      balanceKg: balance,
      balanceAfterKg: balance.minus(n.net),
    });
  }
  return out;
}

export async function buildPlan(db: Db, count: CountHead, opts: { afterClaim: boolean }): Promise<ReversalPlan> {
  const blockers = await documentBlockers(db, count, opts);
  const rolls = await planRolls(db, count);
  const yarn = await planYarn(db, count);
  if (yarn.length > 0 && !(await readIplikEnabled(db))) {
    blockers.push("İplik modülü kapalı — sayımın iplik düzeltmesi geri alınamaz.");
  }
  return { countId: count.id, countNo: count.countNo, warehouseId: count.warehouseId, blockers, rolls, yarn };
}

export const COUNT_HEAD_SELECT = {
  id: true,
  countNo: true,
  warehouseId: true,
  status: true,
  completedAt: true,
  reversedAt: true,
} satisfies Prisma.StockCountSelect;

