// =============================================================================
// SEVK YÖNÜ — sevk ekranı yönü SEÇMEZ, sunucudan OKUR (kilit kararı 2026-09-23)
// =============================================================================
// Zincir (şube → cari → boş) sunucuda `resolveShipmentDestination`da yaşar; bu
// dosya onu KOPYALAMAZ, `GET /api/shipping/destination-lock` cevabını yorumlar.
// Kilitliyse yön rozet olur; zincir boşsa operatör bir kez seçer ve seçim karta
// yazılır. Tablet ikizi: mobil `destinationDefault.ts`.
import { useQuery } from "@tanstack/react-query";
import { sackHubService } from "./service";
import type { ShipmentDestination } from "./types";

export type DestinationSource = "BRANCH" | "CUSTOMER";

export interface DestinationLock {
  destination: ShipmentDestination | null;
  source: DestinationSource | null;
  exportCode: string | null;
  /** Doluysa Hızlı Sevk bu adreste yapılamaz — metin sunucunun 400'üyle aynı. */
  quickShipBlockedReason: string | null;
}

export const destinationSourceLabels: Record<DestinationSource, string> = {
  BRANCH: "Şubeden",
  CUSTOMER: "Cariden",
};

export interface DestinationView {
  /** Gönderilecek yön; kilit okunmadıysa ya da ilk seçim yapılmadıysa null. */
  destination: ShipmentDestination | null;
  locked: boolean;
  /**
   * Operatör yönü ilk-seçim bileşeninde AÇIKÇA seçti — gövdeye `destinationChosen: true`
   * YALNIZ o zaman girer (sunucu karta yalnız açık niyetle yazar). Kilitliyken asla.
   */
  chosen: boolean;
  /** Zincir boş ve operatör henüz seçmedi — sevk düğmesi bekler. */
  needsPick: boolean;
}

/** Kilit + operatörün ilk seçimi → ekranın yönü. Kilitliyken seçim YOK sayılır. */
export function resolveDestination(input: {
  lock: DestinationLock | null | undefined;
  picked: ShipmentDestination | null;
}): DestinationView {
  const { lock, picked } = input;
  if (!lock) return { destination: null, locked: false, chosen: false, needsPick: false };
  if (lock.destination) return { destination: lock.destination, locked: true, chosen: false, needsPick: false };
  return { destination: picked, locked: false, chosen: picked != null, needsPick: picked == null };
}

/** Sevk adresinin (cari + şube) yön kilidi; müşteri yokken sorgu koşmaz. */
export function useDestinationLock(customerId: string | null | undefined, branchId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["destination-lock", customerId ?? null, branchId ?? null],
    queryFn: () => sackHubService.getDestinationLock(customerId as string, branchId ?? null),
    enabled: enabled && Boolean(customerId),
    staleTime: 10_000,
  });
}
