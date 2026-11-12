// Kantardan TEK okuma (2026-11-10) — çuval tartısı ve tambur "Tart" aynı yoldan okur. Toast basmaz; çağıran
// `notice`/`error`ı gösterir. Simüle cihazın değeri UYDURULUR → kaynak SIMULATED beyan edilir (backend bayrak
// kapalıyken 400 ile reddeder); gerçek cihazda kaynak SCALE.
import type { DevicePeripheral as Peripheral } from '../peripheral.service';
import { buildIoFromPeripheral } from '../../hooks/usePeripheralIO';
import { isBonded, pairByMac } from './btClassic.transport';

export type ScaleSource = 'SCALE' | 'SIMULATED';
export interface ScaleMessage {
  title: string;
  detail: string;
}
export type ScaleRead =
  | { ok: true; kg: number; source: ScaleSource; notice?: ScaleMessage }
  | { ok: false; error: ScaleMessage };

export interface ReadScaleDeps {
  random?: () => number;
  /** BT ilk eşleştirme başlamadan önce çağrılır (PIN uyarısı). */
  onPairing?: (msg: ScaleMessage) => void;
  build?: typeof buildIoFromPeripheral;
  bonded?: typeof isBonded;
  pair?: typeof pairByMac;
}

export const NO_SCALE: ScaleMessage = {
  title: 'Kantar tanımlı değil',
  detail: 'Admin → Cihaz Kaydı’ndan bu yere SCALE ekleyin (veya ⋮ → “Elle kg gir”).',
};

export async function readScaleOnce(p: Peripheral | null | undefined, deps: ReadScaleDeps = {}): Promise<ScaleRead> {
  if (!p) return { ok: false, error: NO_SCALE };
  if (p.simulate) {
    const v = Math.round((10 + (deps.random ?? Math.random)() * 90) * 10) / 10;
    return {
      ok: true,
      kg: v,
      source: 'SIMULATED',
      notice: { title: 'SİMÜLASYON tartısı', detail: `${v} kg gerçek ölçüm DEĞİL — cihaz kaydında “simulate” açık.` },
    };
  }
  const io = (deps.build ?? buildIoFromPeripheral)(p);
  if (!io.supported || !io.transport || !io.codec) {
    return { ok: false, error: { title: 'Kantar okunamıyor', detail: 'Bu derlemede/bağlantı türünde desteklenmiyor (native build / connectionType).' } };
  }
  if (p.connectionType === 'BLUETOOTH_SPP' && p.address) {
    try {
      if (!(await (deps.bonded ?? isBonded)(p.address))) {
        deps.onPairing?.({ title: 'Kantar ilk kez eşleştiriliyor', detail: 'PIN sorulursa girin (ör. 1234) — sonraki tartılarda otomatik bağlanır.' });
        await (deps.pair ?? pairByMac)(p.address);
      }
    } catch (e) {
      return { ok: false, error: { title: 'Kantar eşleştirilemedi', detail: e instanceof Error ? e.message : 'Kantar açık ve menzilde mi? PIN girildi mi?' } };
    }
  }
  try {
    const raw = await io.transport.read({
      readMode: p.readMode,
      pollCommand: p.pollCommand ?? undefined,
      terminator: p.terminator ?? undefined,
      timeoutMs: p.timeoutMs ?? undefined,
      framePattern: p.identifyPattern ?? undefined,
    });
    const v = io.codec.decode(raw);
    if (v != null && v > 0) return { ok: true, kg: v, source: 'SCALE' };
    throw new Error('Geçerli tartı gelmedi');
  } catch (e) {
    return { ok: false, error: { title: 'Kantar okunamadı', detail: e instanceof Error ? e.message : 'Kantar kapalı/menzil dışı veya komut yanlış olabilir' } };
  }
}
