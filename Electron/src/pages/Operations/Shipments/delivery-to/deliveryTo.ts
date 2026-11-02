// =============================================================================
// TESLİM YERİ (K18) — saf yardımcılar: kart adresi tek satır, gövde parçası, görünüm
// =============================================================================
// Sevkiyatın carisi malın SAHİBİ kalır; teslim yeri yalnız belgeye basılan adrestir.
// Boşken gövdeye anahtar HİÇ girmez (sunucu null sayar = bugünkü davranış).
// =============================================================================

export interface DeliveryToState {
  customerId: string | null;
  address: string;
}

export const EMPTY_DELIVERY_TO: DeliveryToState = { customerId: null, address: "" };
export const DELIVERY_ADDRESS_MAX = 500;

/** Backend `formatCustomerAddress` aynası — boş parçalar atlanır. */
export function formatCustomerAddress(c: {
  address?: string | null;
  district?: string | null;
  city?: string | null;
  country?: string | null;
} | null | undefined): string | null {
  if (!c) return null;
  const parts = [c.address, c.district, c.city, c.country].map((x) => x?.trim()).filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Kurulum gövdesine eklenecek parça — cari yoksa boş nesne (eski gövde bayt bayt aynı). */
export function deliveryToBody(s: DeliveryToState): { deliveryCustomerId?: string; deliveryAddress?: string } {
  if (!s.customerId) return {};
  const address = s.address.trim();
  return { deliveryCustomerId: s.customerId, ...(address ? { deliveryAddress: address } : {}) };
}

/** İstemci tarafı ön denetim — sunucu da aynı kuralı 400 ile söyler. */
export function deliveryToError(s: DeliveryToState, ownerCustomerId: string | null | undefined): string | null {
  if (!s.customerId) return null;
  if (ownerCustomerId && s.customerId === ownerCustomerId) {
    return "Teslim yeri sevkiyatın kendi carisi olamaz — başka adrese teslim için başka bir cari seçin.";
  }
  if (s.address.trim().length > DELIVERY_ADDRESS_MAX) return `Teslim adresi en fazla ${DELIVERY_ADDRESS_MAX} karakter olabilir.`;
  return null;
}

/** Detay satırı: "Ad — adres" (kayıtlı adres, yoksa kart adresi); teslim yeri yoksa null. */
export function deliveryToLine(d: {
  deliveryCustomer?: { name: string; address: string | null } | null;
  deliveryAddress?: string | null;
}): string | null {
  if (!d.deliveryCustomer) return null;
  const address = d.deliveryAddress?.trim() || d.deliveryCustomer.address?.trim() || null;
  return address ? `${d.deliveryCustomer.name} — ${address}` : d.deliveryCustomer.name;
}
