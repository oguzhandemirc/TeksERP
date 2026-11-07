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
export type EmitResult = 'delivered' | 'duplicate' | 'empty' | 'no-target';

/** Aynı yayının iki kez teslimine karşı pencere — operatörün yeniden basması bundan uzundur. */
export const DOUBLE_DELIVERY_MS = 300;

interface Target {
  id: number;
  handler: { current: ScanHandler };
}

let stack: Target[] = [];
let seq = 0;
let last: { data: string; at: number } | null = null;
let unhandled: ScanHandler | null = null;
const stackListeners = new Set<(depth: number) => void>();

function notifyStack(): void {
  for (const l of stackListeners) l(stack.length);
}

/** Hedefi yığının ÜSTÜNE koyar; dönen işlev onu (yerinden bağımsız) çıkarır. */
export function pushScanTarget(handler: { current: ScanHandler }): () => void {
  const id = ++seq;
  stack.push({ id, handler });
  notifyStack();
  return () => {
    const before = stack.length;
    stack = stack.filter((t) => t.id !== id);
    if (stack.length !== before) notifyStack();
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
export function setUnhandledScanListener(fn: ScanHandler | null): void {
  unhandled = fn;
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
  const top = stack[stack.length - 1];
  if (!top) {
    unhandled?.(scan);
    return 'no-target';
  }
  top.handler.current(scan);
  return 'delivered';
}

/** Yalnız testler. */
export function __resetScanBusForTests(): void {
  stack = [];
  last = null;
  unhandled = null;
  stackListeners.clear();
}
