// =============================================================================
// SEVK HEDEFİ VARSAYILANI — cari kartı VARSAYILAN verir, KİLİT değil
// =============================================================================
// Kural (2026-09-13): sevkiyat formu müşterinin `defaultDestination`ıyla BAŞLAR;
// operatör seçiciye bir kez dokunduysa seçimi ezilmez — müşteri sonra değişse
// bile (açık girdi örtük varsayılanı yener; "dokunma" geri dönülmezdir).
// Sevkiyat kendi `destination`ını saklar; bu yardımcı yalnız formun ilk değerini
// üretir, backend'de geri düşüş yoktur. Tablet ikizi: mobil `destinationDefault.ts`.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { customerService } from "@/pages/Customers/service";
import type { ShipmentDestination } from "./types";

export function resolveDestination(input: {
  current: ShipmentDestination;
  touched: boolean;
  customerDefault: ShipmentDestination | null | undefined;
}): ShipmentDestination {
  if (input.touched) return input.current;
  return input.customerDefault ?? "DOMESTIC";
}

/**
 * Seçili müşterinin kartını okur ve seçiciyi varsayılanla BAŞLATIR; operatör
 * dokunduysa (`touched`) hiçbir şey yazmaz. Diyalog kapalıyken sorgu koşmaz.
 */
export function useCustomerDefaultDestination(input: {
  open: boolean;
  customerId: string | undefined;
  touched: boolean;
  setDestination: (fn: (cur: ShipmentDestination) => ShipmentDestination) => void;
}): void {
  const { open, customerId, touched, setDestination } = input;
  const customerQ = useQuery({
    queryKey: ["customer-default-destination", customerId ?? null],
    queryFn: () => customerService.getById(customerId as string),
    enabled: open && Boolean(customerId),
    staleTime: 30_000,
  });
  const customerDefault = (customerQ.data?.data as { defaultDestination?: ShipmentDestination | null } | undefined)
    ?.defaultDestination;
  useEffect(() => {
    if (!open || !customerQ.data) return;
    setDestination((cur) => resolveDestination({ current: cur, touched, customerDefault }));
  }, [open, customerQ.data, customerDefault, touched, setDestination]);
}
