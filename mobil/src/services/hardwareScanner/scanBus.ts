// Donanım okumalarının TEK boğazı: her kaynak (Point Mobile / Zebra / Honeywell / klavye kaması) buraya
// `emitScan` ile gelir → normalize → çift teslim eleme → en üstteki hedef (LIFO yığın) alır.
// Kasıtlı tekrar okuma ELENMEZ: ekranın mükerrer geri bildirimi ("ZATEN OKUTULDU") çalışmalı (plan §1.5).
import { normalizeScanCode } from '../../utils/scanCode';

export type ScanSource = 'pointmobile' | 'zebra' | 'honeywell' | 'wedge';

export interface HardwareScan {
  /** `normalizeScanCode` uygulanmış kod — ekranlar bunu kullanır. */
  data: string;
  /** Okuyucunun verdiği ham metin (kontrol karakterleri dahil). */
  raw: string;
  symbology: string | null;
  source: ScanSource;
  at: number;
}

export type ScanHandler = (scan: HardwareScan) => void;
export type EmitResult = 'delivered' | 'duplicate' | 'empty' | 'no-target' | 'covered';
/** `covered`: tek hedef kapalı pencerenin arka plan dinleyicisiydi ve üstünde açık bir pencere var. */
export type UnhandledReason = 'no-target' | 'covered';

/** Aynı yayının iki kez teslimine karşı pencere — operatörün yeniden basması bundan uzundur. */
export const DOUBLE_DELIVERY_MS = 300;

// "En üstteki açık pencere" kuralı: ARKA PLAN hedefi (kapalı tarayıcının ekran dinleyicisi), kendisini
// KAPSAMAYAN bir pencere (AppModal) açıkken okuma almaz — sıra değil kapsama bakılır, böylece hedefin ne
// zaman bağlandığı sonucu değiştirmez. Görünür hedef (açık tarayıcı/sheet'in kendi hedefi) etkilenmez.
interface Target {
  id: number;
  handler: { current: ScanHandler };
  background: { current: boolean };
  /** Hedefi kapsayan pencerelerin kimlikleri (dıştan içe). */
  within: readonly number[];
}

let stack: Target[] = [];
const overlays = new Set<number>();
let seq = 0;
let last: { data: string; at: number } | null = null;
let unhandled: ((scan: HardwareScan, reason: UnhandledReason) => void) | null = null;
const stackListeners = new Set<(depth: number) => void>();

function notifyStack(): void {
  for (const l of stackListeners) l(stack.length);
}

/** Hedefi yığının ÜSTÜNE koyar; dönen işlev onu (yerinden bağımsız) çıkarır. */
export function pushScanTarget(
  handler: { current: ScanHandler },
  background: { current: boolean } = { current: false },
  within: readonly number[] = [],
): () => void {
  const id = ++seq;
  stack.push({ id, handler, background, within });
  notifyStack();
  return () => {
    const before = stack.length;
    stack = stack.filter((t) => t.id !== id);
    if (stack.length !== before) notifyStack();
  };
}

/** Pencere kimliği (AppModal örneği başına bir kez). */
export function newScanOverlayId(): number {
  return ++seq;
}

/** Açık pencere işareti — kapsamadığı arka plan hedeflerini örter (AppModal görünürken). */
export function openScanOverlay(id: number): () => void {
  overlays.add(id);
  return () => {
    overlays.delete(id);
  };
}

export function scanTargetDepth(): number {
  return stack.length;
}

export function subscribeScanTargets(listener: (depth: number) => void): () => void {
  stackListeners.add(listener);
  return () => stackListeners.delete(listener);
}

/** Hedefsiz okuma bildirimi (host uyarı verir). */
export function setUnhandledScanListener(fn: ((scan: HardwareScan, reason: UnhandledReason) => void) | null): void {
  unhandled = fn;
}

function isCovered(t: Target): boolean {
  if (!t.background.current) return false;
  for (const o of overlays) if (!t.within.includes(o)) return true;
  return false;
}

/** Üstten aşağı ilk okuma alabilen hedef; yoksa nedeni. */
function resolveTarget(): { handler: ScanHandler } | { reason: UnhandledReason } {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (!isCovered(stack[i])) return { handler: stack[i].handler.current };
  }
  return { reason: stack.length > 0 ? 'covered' : 'no-target' };
}

export function emitScan(
  input: { data: string; symbology?: string | null; source: ScanSource },
  now: number = Date.now(),
): EmitResult {
  // Sondaki CR/LF/TAB okuyucu son ekidir; GS1 ayırıcısı (GS, 0x1D) gibi iç kontrol karakterleri korunur.
  const raw = input.data.replace(/^[\r\n\t ]+|[\r\n\t ]+$/g, '');
  const data = normalizeScanCode(raw);
  if (!data) return 'empty';
  if (last && last.data === data && now - last.at <= DOUBLE_DELIVERY_MS) return 'duplicate';
  last = { data, at: now };
  const scan: HardwareScan = { data, raw, symbology: input.symbology ?? null, source: input.source, at: now };
  const target = resolveTarget();
  if ('reason' in target) {
    unhandled?.(scan, target.reason);
    return target.reason;
  }
  target.handler(scan);
  return 'delivered';
}

/** Yalnız testler. */
export function __resetScanBusForTests(): void {
  stack = [];
  overlays.clear();
  last = null;
  unhandled = null;
  stackListeners.clear();
}
