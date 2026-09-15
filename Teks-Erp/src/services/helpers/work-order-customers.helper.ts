// =============================================================================
// İŞ EMRİ LİSTESİ — MÜŞTERİ ROLLUP'I (kullanıcı isteği 2026-09-15)
// =============================================================================
// İş emri ↔ müşteri bağı TEK yoldan: `orderLinks(aktif) → orderLine → order → customer`
// (top↔sipariş bağı yok; `WorkOrder.type` bağın aynasıdır). Bir iş emri N bağ ⇒ N müşteri
// olabilir; liste satırı DISTINCT müşterileri ad sırasıyla, ilk `WO_CUSTOMER_PREVIEW` tanesini
// + toplam sayıyı taşır (panel: 0 "—" · 1 ad · 2+ ad + "+N"). Saf fonksiyon: liste select'i
// müşteriyi AYNI sorguda getirir, burada yalnız bellekten süzülür (N+1 yok).
// =============================================================================
export const WO_CUSTOMER_PREVIEW = 5;

export interface WorkOrderCustomerRef {
  id: string;
  name: string;
}

export interface WorkOrderCustomerRollup {
  /** DISTINCT, ada göre sıralı (tr), en çok `WO_CUSTOMER_PREVIEW`. */
  customers: WorkOrderCustomerRef[];
  /** DISTINCT müşteri TOPLAMI (önizlemeden fazlası için). */
  customerCount: number;
}

type LinkLike = { orderLine?: { order?: { customer?: WorkOrderCustomerRef | null } | null } | null } | null | undefined;

export function rollupWorkOrderCustomers(links: readonly LinkLike[] | null | undefined): WorkOrderCustomerRollup {
  const byId = new Map<string, WorkOrderCustomerRef>();
  for (const l of links ?? []) {
    const c = l?.orderLine?.order?.customer;
    if (c && !byId.has(c.id)) byId.set(c.id, { id: c.id, name: c.name });
  }
  const sorted = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  return { customers: sorted.slice(0, WO_CUSTOMER_PREVIEW), customerCount: sorted.length };
}
