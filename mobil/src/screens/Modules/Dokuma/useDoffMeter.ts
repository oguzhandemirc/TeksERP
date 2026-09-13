// =============================================================================
// SAYAÇ OKUMA — tek dokunuş; cihaz yok → elle; simülasyon → SIMULATED beyanı
// =============================================================================
// `useSackWeigh` kalıbı (tartı). KK1'in beyansız metre yolu TEKRARLANMAZ (§3.7):
// uydurulmuş değer her zaman `SIMULATED` ile gider, kararı backend verir.
// =============================================================================
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useMachinePeripherals, primaryMeterFor } from '../../../hooks/useMachinePeripherals';
import { buildIoFromPeripheral } from '../../../hooks/usePeripheralIO';
import { isBonded, pairByMac } from '../../../services/hal/btClassic.transport';
import type { MachineDataSource } from '../../../types/models';

export type MeterReadOutcome = { value: number; source: MachineDataSource } | null;

export function useDoffMeter() {
  const meterPeripherals = useMachinePeripherals('METER');
  const readingRef = useRef(false);
  const [reading, setReading] = useState(false);

  const readMeter = useCallback(async (): Promise<MeterReadOutcome> => {
    if (readingRef.current) return null;
    const p = primaryMeterFor(meterPeripherals);
    if (!p) {
      Toast.show({ type: 'info', text1: 'Sayaç cihazı tanımlı değil', text2: 'Değeri elle girin ya da boş bırakın (okunmadı).', visibilityTime: 5000 });
      return null;
    }
    readingRef.current = true;
    setReading(true);
    try {
      if (p.simulate) {
        const v = Math.round(500 + Math.random() * 4500);
        Toast.show({ type: 'info', text1: 'SİMÜLASYON sayacı', text2: `${v} gerçek ölçüm DEĞİL — cihaz kaydında “simulate” açık.`, visibilityTime: 5000 });
        return { value: v, source: 'SIMULATED' };
      }
      const io = buildIoFromPeripheral(p);
      if (!io.supported || !io.transport || !io.codec) {
        Toast.show({ type: 'error', text1: 'Sayaç okunamıyor', text2: 'Bu derlemede/bağlantı türünde desteklenmiyor.', visibilityTime: 5000 });
        return null;
      }
      if (p.connectionType === 'BLUETOOTH_SPP' && p.address && !(await isBonded(p.address))) await pairByMac(p.address);
      const raw = await io.transport.read({
        readMode: p.readMode,
        pollCommand: p.pollCommand ?? undefined,
        terminator: p.terminator ?? undefined,
        timeoutMs: p.timeoutMs ?? undefined,
        framePattern: p.identifyPattern ?? undefined,
      });
      const v = io.codec.decode(raw);
      if (v == null || v < 0) throw new Error('Geçerli sayaç değeri gelmedi');
      return { value: Math.round(v), source: 'MACHINE' };
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Sayaç okunamadı', text2: e instanceof Error ? e.message : 'Cihaz açık ve menzilde mi?', visibilityTime: 5000 });
      return null;
    } finally {
      readingRef.current = false;
      setReading(false);
    }
  }, [meterPeripherals]);

  return { reading, readMeter };
}
