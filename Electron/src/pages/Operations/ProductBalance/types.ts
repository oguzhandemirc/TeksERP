/** Kumaş Dengesi — backend production-balance.service çıktısı (Decimal → number). */

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
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  inFlight: number;
}

/**
 * En (width) alt-satırı. Ham / malzeme açığı BURADA YOK — (kumaş+renk) grubu
 * düzeyinde (ham kumaşın eni önemsiz). Depo en'e göre birebir → burada kalır.
 */
export interface BalanceSpecRow {
  key: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: number | null;
  /** Σ(istenen − sevk) açık siparişler (bu en). */
  talep: number;
  /** Sevksiz WAREHOUSE (bu en, hazır). */
  depo: number;
  /** Canlı WO hedef-spec in-flight (committed − finished, bu en). */
  uretimde: number;
  /** max(0, talep − depo − üretimde) → bu en için WO açılacak miktar. */
  uretilecek: number;
  lines: BalanceLine[];
  wos: BalanceWo[];
}

/**
 * (kumaş, renk) grubu. Ham havuzu + malzeme açığı bu düzeyde (en-agnostik, tek
 * sayım). Talep/Depo/Üretimde/Üretilecek başlıkta Σ; en kırılımı specs[].
 */
export interface BalanceGroup {
  key: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  talep: number;
  depo: number;
  uretimde: number;
  uretilecek: number;
  /** Sevksiz HAM havuzu (kumaş+renk, en-agnostik) — yarı mamul HARİÇ. */
  ham: number;
  /** Sevksiz YARI MAMUL havuzu (dışarıdan boyalı/işlenmiş geldi). Arzdır. */
  yariMamul: number;
  /** max(0, Σüretilecek − (ham + yariMamul)) → kumaş tedariki gereken kısım. */
  malzemeAcigi: number;
  specs: BalanceSpecRow[];
}

/**
 * "İş Emri Aç" dialog hedefi: belirli bir en alt-satırı (talep/depo/üretimde/
 * üretilecek + lines) + ait olduğu grubun ham havuzu (paylaşılan, en-agnostik).
 */
export interface WoTarget {
  key: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  width: number | null;
  talep: number;
  depo: number;
  uretimde: number;
  uretilecek: number;
  /** Grup ham havuzu (bu kumaş+renk için paylaşılan; en'e bölünmez). */
  ham: number;
  /** Grup yarı mamul havuzu — ham ile AYNI arz kovasındadır (bkz. kullanım). */
  yariMamul: number;
  lines: BalanceLine[];
}
