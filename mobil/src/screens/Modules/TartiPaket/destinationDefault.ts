// Sevk yönü — tablet yönü SEÇMEZ, sunucudan OKUR (kilit kararı 2026-09-23; panel ikizi:
// Electron SackContentEdit/destinationDefault.ts). Zincir (şube → cari → boş) sunucuda;
// kilitliyse yön rozet olur, boşsa operatör bir kez seçer ve seçim karta yazılır.
import type { DestinationLock, ShipmentDestination } from '../../../services/packing.service';

export interface DestinationView {
  /** Gönderilecek yön; kilit okunmadıysa ya da ilk seçim yapılmadıysa null. */
  destination: ShipmentDestination | null;
  locked: boolean;
  /** Zincir boş ve operatör henüz seçmedi — sevk bekler. */
  needsPick: boolean;
}

export function resolveDestination(input: {
  lock: DestinationLock | null | undefined;
  picked: ShipmentDestination | null;
}): DestinationView {
  const { lock, picked } = input;
  if (!lock) return { destination: null, locked: false, needsPick: false };
  if (lock.destination) return { destination: lock.destination, locked: true, needsPick: false };
  return { destination: picked, locked: false, needsPick: picked == null };
}

export const destinationSourceLabels: Record<'BRANCH' | 'CUSTOMER', string> = {
  BRANCH: 'Şubeden',
  CUSTOMER: 'Cariden',
};
