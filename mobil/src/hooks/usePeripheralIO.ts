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

/** Metre/sayaç okumasının istediği protokol alanları (for-session satırı). */
export interface MeterReadRow extends PeripheralRowLike {
  readMode?: 'POLL' | 'STREAM';
  pollCommand?: string | null;
  terminator?: string | null;
  timeoutMs?: number | null;
}

export type MeterReadResult =
  | { ok: true; value: number; raw: string; transport: DeviceTransport }
  | { ok: false; reason: 'UNSUPPORTED' }
  /** `noValue`: cihaz yanıt verdi ama pozitif değer yok (codec 0'ı da eler — sıfırlanmış sayaç böyle görünür). */
  | { ok: false; reason: 'READ_FAILED'; message: string; noValue?: boolean };

/**
 * ORTAK sayaç okuması (Tambur kesim metresi + Kurşun çıkış sayacı) — HAL kur, oku, çöz.
 * Codec yalnız pozitif değer çözer; çözülemeyen yanıt `noValue` ile ayrılır (taşıyıcı hatasından farklı).
 */
export async function readMeter(p: MeterReadRow): Promise<MeterReadResult> {
  const io = buildIoFromPeripheral(p);
  if (!io.supported || !io.transport || !io.codec) return { ok: false, reason: 'UNSUPPORTED' };
  try {
    const raw = await io.transport.read({
      readMode: p.readMode,
      pollCommand: p.pollCommand ?? undefined,
      terminator: p.terminator ?? undefined,
      timeoutMs: p.timeoutMs ?? undefined,
      framePattern: p.identifyPattern ?? undefined,
    });
    const v = io.codec.decode(raw);
    if (v != null && v > 0) return { ok: true, value: v, raw, transport: io.transport };
    return { ok: false, reason: 'READ_FAILED', message: 'Geçerli metre yanıtı gelmedi', noValue: true };
  } catch (e) {
    return { ok: false, reason: 'READ_FAILED', message: e instanceof Error ? e.message : 'Makine kapalı/menzil dışı veya komut yanlış olabilir' };
  }
}
