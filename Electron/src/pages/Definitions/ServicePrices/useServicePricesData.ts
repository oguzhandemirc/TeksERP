// Ekranın iki sorgusu: hizmet listesi + seçili hizmetin tablosu (para birimi / müşteri görünümüne göre).
import { useQuery } from "@tanstack/react-query";
import { getServicePriceTable, listServices, type Currency } from "./service";
import { SERVICE_PRICES_KEY } from "./useServicePriceMutations";

export function useServicePricesData(
  open: boolean,
  itemId: string | null,
  currency: Currency,
  customerId: string | null,
) {
  const servicesQ = useQuery({
    queryKey: [...SERVICE_PRICES_KEY, "services"],
    queryFn: listServices,
    enabled: open,
  });
  const tableQ = useQuery({
    queryKey: [...SERVICE_PRICES_KEY, "table", itemId, currency, customerId],
    queryFn: () => getServicePriceTable({ itemId: itemId as string, currency, customerId }),
    enabled: open && itemId !== null,
    // Aynı hizmette görünüm değişirken eski tablo kalır (titreme yok); başka hizmete geçince iskelet görünür.
    placeholderData: (prev) => (prev?.item.id === itemId ? prev : undefined),
  });
  return { servicesQ, tableQ };
}
