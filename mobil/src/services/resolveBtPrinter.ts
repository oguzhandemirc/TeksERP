import { peripheralService, type DevicePeripheral } from './peripheral.service';
import { useSessionStore } from '../store/sessionStore';
import { isBtPrinterSupported } from './btPrinter.service';

/**
 * Oturumun YERİNE bağlı BT etiket yazıcısı (operatör seçimi değil). Fail-closed:
 * oturum yoksa, SPP kaydı yoksa ya da çözüm düşerse null → çağıran HTML yoluna geçer.
 */
export async function resolveBtPrinter(): Promise<DevicePeripheral | null> {
  if (!isBtPrinterSupported() || useSessionStore.getState().active == null) return null;
  try {
    const printers = await peripheralService.getForSession('LABEL_PRINTER');
    return printers.find((p) => p.connectionType === 'BLUETOOTH_SPP' && !!p.address && !p.simulate) ?? null;
  } catch {
    return null;
  }
}
