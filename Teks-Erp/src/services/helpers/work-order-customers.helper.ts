// =============================================================================
// İŞ EMRİ LİSTESİ — MÜŞTERİ ROLLUP'I (kullanıcı isteği 2026-09-15)
// =============================================================================
// İş emri ↔ müşteri bağı TEK yoldan: `orderLinks(aktif) → orderLine → order → customer`
// (top↔sipariş bağı yok; `WorkOrder.type` bağın aynasıdır). Bir iş emri N bağ ⇒ N müşteri
// olabilir; liste satırı DISTINCT müşterileri BAĞLANMA SIRASIYLA (ilk bağlanan = birincil;
// ad sırası değil — iş emri kimin için açıldıysa o öne çıkar, sonradan eklenen sipariş öne
// geçmez), ilk `WO_CUSTOMER_PREVIEW` tanesini + toplam sayıyı taşır (panel: 0 "—" · 1 ad ·
// 2+ ad + "+N"). Saf fonksiyon: liste/detay select'i bağları `createdAt asc` getirir ve
// müşteriyi AYNI sorguda taşır; burada yalnız bellekten süzülür (N+1 yok). `createdAt` yoksa
// dizi sırası korunur (eşit damgada da dizi sırası — sıralama kararlı).
// =============================================================================
export const WO_CUSTOMER_PREVIEW = 5;

export interface WorkOrderCustomerRef {
  id: string;
  name: string;
}

export interface WorkOrderCustomerRollup {
  /** DISTINCT, bağlanma sırasıyla (ilk bağlanan önce = birincil), en çok `WO_CUSTOMER_PREVIEW`. */
  customers: WorkOrderCustomerRef[];
  /** DISTINCT müşteri TOPLAMI (önizlemeden fazlası için). */
  customerCount: number;
}

type LinkLike = { createdAt?: Date | string | null; orderLine?: { order?: { customer?: WorkOrderCustomerRef | null } | null } | null } | null | undefined;

/** Bağları bağlanma sırasına koyar (`createdAt` asc; damgasız/eşit damgada dizi sırası) — TEK sıralama kaynağı. */
export function sortLinksByLinkedAt<T extends LinkLike>(links: readonly T[] | null | undefined): T[] {
  const ts = (l: LinkLike): number => (l?.createdAt ? new Date(l.createdAt).getTime() : 0);
  return (links ?? []).map((l, i) => ({ l, i })).sort((a, b) => ts(a.l) - ts(b.l) || a.i - b.i).map((x) => x.l);
}

export function rollupWorkOrderCustomers(links: readonly LinkLike[] | null | undefined): WorkOrderCustomerRollup {
  const byId = new Map<string, WorkOrderCustomerRef>();
  for (const l of sortLinksByLinkedAt(links)) {
    const c = l?.orderLine?.order?.customer;
    if (c && !byId.has(c.id)) byId.set(c.id, { id: c.id, name: c.name });
  }
  const ordered = [...byId.values()];
  return { customers: ordered.slice(0, WO_CUSTOMER_PREVIEW), customerCount: ordered.length };
}
