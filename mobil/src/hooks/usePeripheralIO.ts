import { useMemo } from 'react';
import { btClassicTransport, isBtSupported } from '../services/hal/btClassic.transport';
import { meterCodec } from '../services/hal/meter.codec';
import type { DeviceCodec, DeviceTransport } from '../services/hal/transport.types';

// =============================================================================
// HAL fabrikası — bir PeripheralDevice satırından (connectionType + kind + protokol
// alanları) bir transport + codec çifti kurar. Şimdilik BLUETOOTH_SPP + METER/SCALE
// destekli (TCP/BLE/USB/SERIAL ileride). PR5 bunu Tambur/KK1 okumalarına bağlar.
// =============================================================================

/** Backend PeripheralDevice satırının HAL için gereken alt kümesi. */
export interface PeripheralRowLike {
  connectionType: string; // 'BLUETOOTH_SPP' | 'NETWORK_TCP' | 'BLE' | 'USB' | 'SERIAL_COM'
  kind: string; // 'LABEL_PRINTER' | 'SCALE' | 'METER' | 'SIGNAL_SOURCE'
  address?: string | null;
  decimals?: number | null;
  scale?: number | null;
  identifyPattern?: string | null; // codec'e verilir — cihaza özel değer ayıklama regex'i
}

export interface PeripheralIO {
  /** Cihaza ulaşım — desteklenmeyen connectionType'da null. */
  transport: DeviceTransport | null;
  /** Veri çözücü — yazıcı/sinyal için null (codec gerekmez). */
  codec: DeviceCodec<number> | null;
  /** Bu derleme + cihaz türü gerçek I/O yapabilir mi (yoksa çağıran simüle eder). */
  supported: boolean;
}

export function buildIoFromPeripheral(p: PeripheralRowLike): PeripheralIO {
  let transport: DeviceTransport | null = null;
  if (p.address) {
    switch (p.connectionType) {
      case 'BLUETOOTH_SPP':
        transport = btClassicTransport(p.address);
        break;
      // NETWORK_TCP / BLE / USB / SERIAL_COM → ileride
      default:
        transport = null;
    }
  }
  const codec =
    p.kind === 'METER' || p.kind === 'SCALE'
      ? meterCodec({
          decimals: p.decimals ?? 1,
          scale: p.scale ?? 1,
          pattern: p.identifyPattern ?? undefined,
        })
      : null;
  const supported = transport != null && (p.connectionType !== 'BLUETOOTH_SPP' || isBtSupported());
  return { transport, codec, supported };
}

/** React sarmalayıcı — peripheral satırı değişince IO yeniden kurulur. */
export function usePeripheralIO(peripheral: PeripheralRowLike | null | undefined): PeripheralIO | null {
  return useMemo(() => (peripheral ? buildIoFromPeripheral(peripheral) : null), [peripheral]);
}
