// =============================================================================
// SEVK TOP LİSTESİ (D4-J6, kullanıcı kararı S10) — müşteriye verilecek top–barkod listesi
// =============================================================================
// Satırlar ve metre çeki listesinin KENDİSİDİR: `resolveShipmentDispatchContent` (donmuş
// snapshot ya da canlı toplayıcı) — muhasebe fişiyle aynı kaynak. Burada top/çuval sorgusu
// YOKTUR; ikinci toplayıcı iki rakam demektir (`test_sevk_top_listesi` AST ile ölçer).
// Müşteri top no / işlem metni yalnız GELEN BELGE açıklamasıdır (etiketteki H9 çözücüsü);
// sayıya dokunmaz, rollId'si olmayan eski snapshot satırında boş kalır.
// =============================================================================
import type { ApiResponse } from "../types/api.types";
import { resolveShipmentDispatchContent } from "./shipping.service";
import { resolveDeliveryNoteLinesForRolls } from "./helpers/roll-delivery-note-line.helper";

export interface ShipmentRollListRow {
  barcode: string | null;
  /** Müşterinin gelen belgesindeki top no (kök topun satırından). */
  customerRollNo: string | null;
  /** Topa bağlı müşteri barkodu (çeki snapshot'ındaki `customerCode`). */
  customerCode: string | null;
  desen: string;
  varyant: string;
  /** Gelen belge işlem metni (satır, yoksa belge başlığı). */
  processText: string | null;
  /** BRÜT metre — çeki satırının metresi. */
  meters: number;
}

export interface ShipmentRollList {
  shipmentNo: string;
  customerName: string;
  date: string | null;
  frozen: boolean;
  rows: ShipmentRollListRow[];
  totals: { rollCount: number; totalMeters: number };
}

type CekiWithRoll = { rollId?: string | null };

export async function getShipmentRollList(shipmentId: string): Promise<ApiResponse<ShipmentRollList>> {
  const { content, doc } = await resolveShipmentDispatchContent(shipmentId);
  const ceki = content.cekiRows ?? [];
  const rollIds = ceki.map((c) => (c as CekiWithRoll).rollId).filter((id): id is string => Boolean(id));
  const lines = rollIds.length > 0 ? await resolveDeliveryNoteLinesForRolls(rollIds) : new Map();
  const rows: ShipmentRollListRow[] = ceki.map((c) => {
    const rollId = (c as CekiWithRoll).rollId;
    const dnl = rollId ? lines.get(rollId) : undefined;
    return {
      barcode: c.barcode,
      customerRollNo: dnl?.senderRollNo ?? null,
      customerCode: c.customerCode ?? null,
      desen: c.desen,
      varyant: c.varyant,
      processText: dnl?.processText ?? null,
      meters: c.meters,
    };
  });
  return {
    success: true,
    data: {
      shipmentNo: content.header.shipmentNo,
      customerName: content.header.customerName,
      date: content.header.date,
      frozen: Boolean(doc),
      rows,
      // Toplam çekinin toplamıdır (belgeyle aynı rakam); satırlardan yeniden toplanmaz.
      totals: { rollCount: content.totals.totalRolls, totalMeters: content.totals.totalMeters },
    },
  };
}
