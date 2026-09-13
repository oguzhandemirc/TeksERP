// =============================================================================
// ÜRETİMDEN DEPOYA GİRİŞ — stok defteri kapısı (K'nın giriş ikilisi, hüküm §11)
// =============================================================================
// Raftan üretime ÇIKIŞIN tek yazıcısı `production-issue-ledger.helper`tır; bu dosya
// karşı yönün (üretim → raf) iki satırsız yolunu kapatır:
//   • açık kumaş çocuğu (`cutOpenFabric` per-cut · `finalizeOpenFabric` kalanı) —
//     ebeveyn IN_PRODUCTION = stok dışı, çocuk WAREHOUSE doğunca mal stok kümesine
//     İLK KEZ girer: bu bir dönüşüm değil GİRİŞTİR. "Kesim çocuğuna satır yazılmaz"
//     kuralı DEPO kesimine aittir (orada ebeveyn de stokta, toplam değişmez).
//   • istasyonda takılı topun kurtarılması (`rescueStuckRoll`).
//
// ⚠️ Bu fonksiyonlar `scripts/lib/stok-defteri-bag-olcumu.ts` KAPI LİSTESİNDEDİR
// (`YENI_KAPI_FONKSIYONLARI`): K tarayıcısı yolun gövdesinde bu adları arar. Servis
// içinde özel metoda çıkarılmış bir sarmalayıcı tarayıcıya GÖRÜNMEZ (ölçüldü
// 2026-09-14: `postRescueEntryTx` sınıf metoduyken K=1 okundu, satır yazılıyordu) —
// kapı fonksiyonu bu dosyada `function` bildirimi olarak yaşar.
// =============================================================================
import { Prisma, RollStatus, WarehouseEventType } from "@prisma/client";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { postStockMove, qtyYazilabilir } from "./warehouse-ledger.helper";

type Tx = Prisma.TransactionClient;

/**
 * Açık kumaş çocuğunun GİRİŞİ (`TAMBUR_CUT`) — per-cut kesim ve finalize kalanı aynı
 * desen. Satır YALNIZ çocukta; geri alma `reverseAllRollStockMoves` ile tersler.
 * KOŞULSUZ: metraj çağıranda doğrulandı, depo çözücüden geldi — deposuz/0 çocuk
 * kapının kendi seddinde DURUR, sessizce atlanmaz.
 */
export async function postOpenFabricChildEntryTx(
  tx: Tx,
  child: { id: string; initialQty: Prisma.Decimal; warehouseId: string | null; status: RollStatus },
  tamburStepId: string,
  userId: string | undefined,
): Promise<void> {
  await postStockMove(tx, {
    rollId: child.id,
    eventType: WarehouseEventType.PRODUCTION,
    qty: child.initialQty,
    to: { warehouseId: child.warehouseId, status: child.status },
    reasonCode: STOCK_MOVE_REASON.TAMBUR_CUT,
    workOrderStepId: tamburStepId,
    userId: userId ?? null,
  });
}

/**
 * Kurtarmanın GİRİŞİ (`RESCUE`). Depo/metraj claim'den SONRA taze okunur
 * (`roll-disposition` emsali). 0 metrajlı top için hareket YAZILMAZ — taşınacak
 * mal yok; deposuzluk bu sınıfta DEĞİL: damga onu kapattı, buraya düşen deposuz
 * top kapının seddinde durur.
 */
export async function postRescueEntryTx(
  tx: Tx,
  args: { rollId: string; stepId: string | null; userId?: string; reason: string },
): Promise<void> {
  const fresh = await tx.roll.findUniqueOrThrow({
    where: { id: args.rollId },
    select: { warehouseId: true, currentQty: true },
  });
  if (!qtyYazilabilir(fresh.currentQty)) return;
  await postStockMove(tx, {
    rollId: args.rollId,
    eventType: WarehouseEventType.PRODUCTION,
    qty: fresh.currentQty,
    to: { warehouseId: fresh.warehouseId, status: RollStatus.WAREHOUSE },
    reasonCode: STOCK_MOVE_REASON.RESCUE,
    workOrderStepId: args.stepId,
    userId: args.userId ?? null,
    notes: args.reason,
  });
}
