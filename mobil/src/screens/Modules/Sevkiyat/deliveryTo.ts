// Teslim yeri (K18) — sevkiyatın carisi malın sahibi kalır; bu yalnız "başka adrese teslim" satırıdır.
// Panel `Shipments/delivery-to/deliveryTo.ts#deliveryToLine` aynası: kayıtlı adres > kart adresi > yalnız ad.
export function deliveryToLine(d: {
  deliveryCustomer?: { name: string; address: string | null } | null;
  deliveryAddress?: string | null;
}): string | null {
  if (!d.deliveryCustomer) return null;
  const address = d.deliveryAddress?.trim() || d.deliveryCustomer.address?.trim() || null;
  return address ? `${d.deliveryCustomer.name} — ${address}` : d.deliveryCustomer.name;
}
