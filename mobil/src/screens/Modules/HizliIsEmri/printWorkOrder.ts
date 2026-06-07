import { workOrderService } from '../../../services/workOrder.service';
import { travelerCardService } from '../../../services/travelerCard.service';
import { isRetiredRoll } from '../../../utils/labels';
import type { WorkOrderCardData } from './workOrderCardHtml';

// WO id → kart verisi (detay + bağlı toplar + aktif refakat kartı barkodu).
// useCardPrinter.printCard'a verilir (qrBase64 orada eklenir).
export async function buildWorkOrderCardData(
  workOrderId: string,
  companyName: string,
): Promise<Omit<WorkOrderCardData, 'qrBase64'>> {
  const [woRes, rollsRes] = await Promise.all([
    workOrderService.getById(workOrderId),
    workOrderService.getAttachedRolls(workOrderId),
  ]);
  const wo = woRes.data;
  if (!wo) throw new Error('İş emri bulunamadı');
  // Tüketilmiş/emekli topları çıktıdan da gizle.
  const rolls = (rollsRes.data ?? []).filter((r) => !isRetiredRoll(r.status));

  // Aktif refakat kartının scannable barkodu — batchNumber ile aratıp WO eşleşmesi.
  let cardNumber: string | null = null;
  let barcode: string | null = null;
  try {
    const cardsRes = await travelerCardService.list({
      search: wo.batchNumber,
      pageSize: 30,
      filters: { status: 'ACTIVE' },
    });
    const card = (cardsRes.data ?? []).find((c) => c.workOrderId === workOrderId);
    if (card) {
      cardNumber = card.cardNumber;
      barcode = card.barcode;
    }
  } catch {
    // kart çözümlenemezse QR'sız basılır (barkod metni de boş kalır)
  }

  return {
    companyName,
    batchNumber: wo.batchNumber,
    status: wo.status,
    type: wo.type ?? null,
    itemName: wo.targetItem?.name ?? rolls[0]?.item?.name ?? null,
    colorName: wo.targetColor?.name ?? null,
    width: wo.width ?? null,
    foldType: wo.foldType ?? null,
    targetQuantity: wo.targetQuantity ?? null,
    createdAt: wo.createdAt ?? null,
    cardNumber,
    barcode,
    route: (wo.steps ?? []).map((s) => ({
      sequence: s.stepSequence,
      stationName: s.station?.name ?? '—',
      stationType: s.station?.type,
      status: s.status,
    })),
    rolls: rolls.map((r) => ({
      barcode: r.barcode,
      itemName: r.item?.name ?? null,
      qty: Number(r.currentQty) || 0,
    })),
    orders: (wo.orderLinks ?? []).map((link) => ({
      orderNumber: link.orderLine?.order?.orderNumber ?? '—',
      customerName: link.orderLine?.order?.customer?.name ?? '—',
      itemName: link.orderLine?.item?.name ?? '—',
      qty: Number(link.orderLine?.quantity) || 0,
    })),
  };
}
