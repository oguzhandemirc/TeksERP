// Sevk hedefi VARSAYILANI — cari kartı varsayılan verir, KİLİT değil (panel ikizi:
// Electron SackContentEdit/destinationDefault.ts). Operatör bir kez dokunduysa
// seçimi ezilmez (geri dönülmez); sevkiyat kendi değerini saklar.
import type { ShipmentDestination } from '../../../services/packing.service';

export function resolveDestination(input: {
  current: ShipmentDestination;
  touched: boolean;
  customerDefault: ShipmentDestination | null | undefined;
}): ShipmentDestination {
  if (input.touched) return input.current;
  return input.customerDefault ?? 'DOMESTIC';
}
