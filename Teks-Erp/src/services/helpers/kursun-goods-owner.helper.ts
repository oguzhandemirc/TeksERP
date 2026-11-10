// Kurşun tableti "Malın sahibi" (GK 2026-11-11): emanet topta sahibi carisi; değilse İE'nin carisi
// (CUSTOMER_GOODS_SERVICE) ya da bağlı siparişlerin TEK müşterisi. Birden çok müşteri/bilinmiyor → null (uydurma yok).

export interface KursunGoodsOwner {
  name: string;
  /** true: emanet (müşteri malı) top — `Roll.ownerCustomer`. */
  consigned: boolean;
}

export function kursunGoodsOwnerOf(a: {
  rollOwnerName: string | null | undefined;
  workOrderCustomerName: string | null | undefined;
  orderCustomerNames: ReadonlyArray<string | null | undefined>;
}): KursunGoodsOwner | null {
  if (a.rollOwnerName) return { name: a.rollOwnerName, consigned: true };
  if (a.workOrderCustomerName) return { name: a.workOrderCustomerName, consigned: false };
  const names = [...new Set(a.orderCustomerNames.filter((n): n is string => !!n))];
  return names.length === 1 ? { name: names[0], consigned: false } : null;
}
