// Etkin adaptörün yaşam döngüsü: yerel alıcıyı kurar, gelen intent'i adaptöre çözdürür, okumayı boğaza verir.
// Ön/arka plan yayınlarını NATIVE gönderir (JS askıdayken de geri yükleme kaçmaz); adaptör durumu değişince
// (ör. Point Mobile önceki mod yakalandı) listeler ön plan yayını tekrarlanmadan güncellenir.
import type { AdapterContext, AdapterState, ScannerAdapter } from './adapters';
import type { DonanimOkuyucuNative } from './native';
import { emitScan, type ScanSource } from './scanBus';

interface Active {
  adapter: ScannerAdapter;
  ctx: AdapterContext;
  state: AdapterState;
  native: DonanimOkuyucuNative;
  sub: { remove: () => void };
}

let active: Active | null = null;

function push(a: Active, applyForeground: boolean): void {
  a.native.configure({
    actions: a.adapter.receiveActions(a.ctx),
    foreground: a.adapter.foreground(a.ctx, a.state),
    background: a.adapter.background(a.ctx, a.state),
    applyForeground,
  });
}

export function startHardwareAdapter(adapter: ScannerAdapter, native: DonanimOkuyucuNative, ctx: AdapterContext): void {
  if (active && active.adapter.id === adapter.id && active.ctx.packageName === ctx.packageName) return;
  stopHardwareAdapter();
  const a: Active = { adapter, ctx, state: {}, native, sub: { remove: () => {} } };
  a.sub = native.addListener('onIntent', (e) => {
    if (active !== a) return;
    let out;
    try {
      out = adapter.handleIntent(e, ctx, a.state);
    } catch {
      return;
    }
    if (!out) return;
    if (out.state) {
      a.state = out.state;
      push(a, false);
    }
    if (out.scan) emitScan({ data: out.scan.data, symbology: out.scan.symbology, source: adapter.id as ScanSource });
  });
  active = a;
  push(a, true);
}

/** Alıcıyı kaldırır; native önce arka plan yayınlarını gönderir (okuyucu önceki moduna döner). */
export function stopHardwareAdapter(): void {
  const a = active;
  if (!a) return;
  active = null;
  a.sub.remove();
  try {
    a.native.configure({ actions: [], foreground: [], background: [] });
  } catch {
    // yut — kapanışta native gitmiş olabilir
  }
}

export function activeAdapterId(): string | null {
  return active?.adapter.id ?? null;
}

/** Okuyucunun üretici ayar ekranını aç (okuyucu yanıt vermiyorsa elle çıkış). Açılamazsa false. */
export function openScannerSettings(adapter: ScannerAdapter | null, native: DonanimOkuyucuNative | null): boolean {
  const s = adapter?.settings;
  if (!s || !native) return false;
  try {
    return s.kind === 'activity' ? native.startActivity(s.action, s.package ?? null) : native.launchPackage(s.package);
  } catch {
    return false;
  }
}
