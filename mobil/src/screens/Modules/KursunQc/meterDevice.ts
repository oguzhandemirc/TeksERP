// =============================================================================
// H3 kurşun sayacı — okuma, başlangıç değeri, kalıcı yazım SONRASI sıfırlama (§6)
// =============================================================================
// Sıra değişmez: okuma → kuyruğa KALICI yazım → transport.write(resetCommand) →
// doğrulama okuması. Kalıcı yazım kanıtlanamazsa sayaç SIFIRLANMAZ (okuma kaybolmasın).
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildIoFromPeripheral, readMeter } from '../../../hooks/usePeripheralIO';
import { decodeCommand } from '../../../services/hal/btClassic.transport';
import type { DevicePeripheral } from '../../../services/peripheral.service';
import { counterFallbackText, counterStrategy, metersFromCounter, type MeterSource } from './meterCapture';

const BASELINE_KEY = 'TEKSERP_KURSUN_COUNTER_BASE_V1';
const UNRESET_KEY = 'TEKSERP_KURSUN_COUNTER_UNRESET_V1';

/** Biriken sayacın son değeri (cihaz başına) — kalıcı yerel depo; yalnız sayaç sayısı tutar. */
export const counterBaselineStore = {
  async get(peripheralId: string): Promise<number | null> {
    try {
      const raw = await AsyncStorage.getItem(BASELINE_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      return typeof map[peripheralId] === 'number' ? map[peripheralId] : null;
    } catch {
      return null;
    }
  },
  async set(peripheralId: string, value: number): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(BASELINE_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      map[peripheralId] = value;
      await AsyncStorage.setItem(BASELINE_KEY, JSON.stringify(map));
    } catch {
      // Yazılamadıysa sonraki top elle yola düşer (NO_BASELINE) — sessiz yanlış metre yok.
    }
  },
};

/**
 * Sıfırlanması beklenen sayaçlar (cihaz başına, kalıcı). İşaret, sıfırlama gerektiren okuma kuyruğa
 * girince konur, sıfırlama doğrulanınca kalkar; işaret varken birikmiş değer metre sayılmaz (elle yol).
 */
export const unresetCounterStore = {
  async has(peripheralId: string): Promise<boolean> {
    try {
      const raw = await AsyncStorage.getItem(UNRESET_KEY);
      return raw ? (JSON.parse(raw) as string[]).includes(peripheralId) : false;
    } catch {
      return true; // okunamayan işaret = sıfırlandığı kanıtlanamadı (fail-closed: elle yol)
    }
  },
  async mark(peripheralId: string, on: boolean): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(UNRESET_KEY);
      const ids = new Set(raw ? (JSON.parse(raw) as string[]) : []);
      if (on) ids.add(peripheralId);
      else ids.delete(peripheralId);
      await AsyncStorage.setItem(UNRESET_KEY, JSON.stringify([...ids]));
    } catch {
      // Yazılamadıysa: işaret yoksa bir sonraki okuma sapma kapısına kalır (toast zaten gösterildi).
    }
  },
};

export type CounterRead =
  | {
      kind: 'VALUE';
      meters: number;
      source: MeterSource;
      rawCounter: number | null;
      peripheralId: string | null;
      /** Bu okumadan sonra sıfırlama gerekir mi (yalnız RESETTING + komut, gerçek cihaz). */
      needsReset: boolean;
      /** DIFF: kayıt kuyruğa girince ilerletilecek başlangıç değeri (vazgeçte ilerlemez). */
      baseline?: number;
    }
  | {
      kind: 'MANUAL';
      hint: string;
      warn: boolean;
      /** Okunan ama metre sayılmayan ham sayaç değeri — elle girilen okumaya iz olarak taşınır. */
      rawCounter?: number | null;
      peripheralId?: string | null;
      /** Elle girilen okuma kuyruğa girince sayaç yine sıfırlanır (sıfırlanmamış sayaç kurtarması). */
      needsReset?: boolean;
    };

/** Simüle sayaç: topun kayıtlı metresi (cihaz yok; kaynak SIMULATED beyanıyla gider). */
function simulatedRead(p: DevicePeripheral, currentQty: number): CounterRead {
  const meters = Math.max(0.1, Math.round(currentQty * 10) / 10);
  return { kind: 'VALUE', meters, source: 'SIMULATED', rawCounter: null, peripheralId: p.id, needsReset: false };
}

/**
 * Sayacı okur ve metreyi çözer. Cihaz yok / okunamadı / fark anlamsız → elle yol (MANUAL).
 * DIFF stratejisinde başlangıç değeri bu okumayla İLERLETİLİR (sonraki top bunun üstünden ölçer).
 */
export async function readCounter(p: DevicePeripheral | null, currentQty: number): Promise<CounterRead> {
  if (!p) return { kind: 'MANUAL', hint: 'Sayaç bağlı değil — metreyi elle girin', warn: false };
  if (p.simulate) return simulatedRead(p, currentQty);
  const r = await readMeter(p);
  if (!r.ok) {
    const hint = r.reason === 'UNSUPPORTED' ? 'Sayaç bu derlemede okunamıyor' : `Sayaç okunamadı: ${r.message}`;
    return { kind: 'MANUAL', hint: `${hint} — metreyi elle girin`, warn: true };
  }
  if (counterStrategy(p) === 'RESET') {
    if (r.value <= 0) return { kind: 'MANUAL', hint: 'Sayaç 0 okudu — metreyi elle girin', warn: true };
    // Önceki sıfırlama kanıtlanamadıysa değer önceki topu da içerebilir → metre sayılmaz.
    if (await unresetCounterStore.has(p.id)) {
      const hint = 'Sayaç önceki toptan sonra sıfırlanamadı — bu topun metresini elle girin';
      return { kind: 'MANUAL', hint, warn: true, rawCounter: r.value, peripheralId: p.id, needsReset: true };
    }
    return { kind: 'VALUE', meters: r.value, source: 'MACHINE', rawCounter: r.value, peripheralId: p.id, needsReset: true };
  }
  const base = await counterBaselineStore.get(p.id);
  const out = metersFromCounter(r.value, base);
  if (out.kind !== 'OK') {
    // Başlangıçsız/geri giden sayaçta yeni değer başlangıç olur (tekrarda korunur); bu top elle girilir.
    if (out.kind !== 'REPEAT') await counterBaselineStore.set(p.id, r.value);
    return { kind: 'MANUAL', hint: counterFallbackText(out.kind), warn: true, rawCounter: r.value, peripheralId: p.id };
  }
  // OK: başlangıç ancak kayıt kuyruğa girince ilerler (vazgeç/4xx sonrası yeniden dokunuş aynı farkı görür).
  return { kind: 'VALUE', meters: out.meters, source: 'MACHINE', rawCounter: r.value, peripheralId: p.id, needsReset: false, baseline: r.value };
}

export type ResetOutcome = 'RESET' | 'NOT_DURABLE' | 'VERIFY_FAILED' | 'WRITE_FAILED';

/**
 * Sayacı sıfırlar — YALNIZ `ensureDurable()` true dönerse (kayıt diskte ya da sunucuda).
 * Ardından doğrulama okuması: 0 değilse VERIFY_FAILED (operatör uyarılır; "sıfırlanmadı" işareti
 * kalkmaz → sonraki okuma elle yola düşer).
 */
export async function resetCounterAfterDurable(p: DevicePeripheral, ensureDurable: () => Promise<boolean>): Promise<ResetOutcome> {
  if (!(await ensureDurable())) return 'NOT_DURABLE';
  const cmd = p.resetCommand?.trim();
  if (!cmd) return 'NOT_DURABLE';
  const io = buildIoFromPeripheral(p);
  if (!io.supported || !io.transport) return 'WRITE_FAILED';
  try {
    await io.transport.write(decodeCommand(cmd), 'ascii');
  } catch {
    return 'WRITE_FAILED';
  }
  // Sıfırlanmış sayaç pozitif değer vermez (codec 0'ı eler): yanıt var + değer yok = sıfır.
  const v = await readMeter(p);
  return !v.ok && v.reason === 'READ_FAILED' && v.noValue ? 'RESET' : 'VERIFY_FAILED';
}
