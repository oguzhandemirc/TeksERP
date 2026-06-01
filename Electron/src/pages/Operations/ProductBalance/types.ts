/** Ürün Dengesi — backend production-balance.service çıktısı (Decimal → number). */

export interface BalanceLine {
  lineId: string;
  orderId: string;
  orderNumber: string;
  deadline: string | null;
  orderDate: string;
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: number | null;
  quantity: number;
  shipped: number;
  /** istenen − sevk (brüt açık talep). */
  remaining: number;
  /** istenen − sevk − canlı WO rezervesi = yeni WO'ya serbest tahsis tavanı. */
  open: number;
  requiredProperties: { id: string; name: string }[];
}

export interface BalanceWo {
  id: string;
  batchNumber: string;
  status: "PLANNED" | "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "CANCELLED";
  inFlight: number;
}

export interface BalanceSpec {
  key: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: number | null;
  /** Σ(istenen − sevk) açık siparişler. */
  talep: number;
  /** Sevksiz WAREHOUSE (hazır). */
  depo: number;
  /** Canlı WO hedef-spec in-flight (committed − finished). */
  uretimde: number;
  /** Sevksiz STOCK (işlenecek hazır kumaş). */
  ham: number;
  /** max(0, talep − depo − üretimde) → WO açılacak miktar. */
  uretilecek: number;
  /** max(0, üretilecek − ham) → kumaş tedariki gereken kısım. */
  malzemeAcigi: number;
  lines: BalanceLine[];
  wos: BalanceWo[];
}
