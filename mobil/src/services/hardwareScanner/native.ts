// El terminali okuyucusu yerel katmanına TEK erişim noktası (mobil/modules/teks-erp-donanim-okuyucu).
// Modül yoksa (eski APK) ya da beklenen işlevi taşımıyorsa `null`: JS klavye kaması (wedge) / kameraya düşer.
import { requireOptionalNativeModule } from 'expo';

/** Etiketli extra değeri — native `toBundle` sözleşmesi (bkz. extras.ts `X`). */
export type TaggedExtra =
  | { t: 'string'; v: string }
  | { t: 'int' | 'long' | 'double'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'bundle'; v: TaggedExtras }
  | { t: 'bundleArray' | 'bundleList'; v: TaggedExtras[] }
  | { t: 'stringArray'; v: string[] };
export type TaggedExtras = Record<string, TaggedExtra>;

export interface BroadcastSpec {
  action: string;
  package?: string;
  extras?: TaggedExtras;
}

/** Gelen intent extras'ının JS biçimi: byte[] → `{ $bytes: base64 }`, Bundle → nesne. */
export type IntentExtraValue =
  | string
  | number
  | boolean
  | null
  | { $bytes: string }
  | IntentExtraValue[]
  | { [key: string]: IntentExtraValue };

export interface NativeIntentEvent {
  action: string;
  extras: Record<string, IntentExtraValue>;
}

export interface NativeCapabilities {
  manufacturer: string;
  brand: string;
  model: string;
  sdkInt: number;
  packages: Record<string, boolean>;
  sharedLibraries: string[];
}

export interface ReceiverConfig {
  actions: string[];
  foreground: BroadcastSpec[];
  background: BroadcastSpec[];
  /** false → yalnız listeleri güncelle, ön plan yayınlarını şimdi yeniden gönderme. */
  applyForeground?: boolean;
}

export interface DonanimOkuyucuNative {
  getCapabilities: (packages: string[]) => NativeCapabilities;
  configure: (config: ReceiverConfig) => void;
  sendBroadcast: (spec: BroadcastSpec) => boolean;
  startActivity: (action: string, pkg: string | null) => boolean;
  launchPackage: (pkg: string) => boolean;
  addListener: (event: 'onIntent', cb: (e: NativeIntentEvent) => void) => { remove: () => void };
}

const FUNCTIONS = ['getCapabilities', 'configure', 'sendBroadcast', 'startActivity', 'launchPackage', 'addListener'] as const;

let cached: DonanimOkuyucuNative | null | undefined;

export function donanimOkuyucuNative(): DonanimOkuyucuNative | null {
  if (cached !== undefined) return cached;
  let m: Partial<DonanimOkuyucuNative> | null = null;
  try {
    m = requireOptionalNativeModule<Partial<DonanimOkuyucuNative>>('TeksErpDonanimOkuyucu');
  } catch {
    m = null;
  }
  cached = m && FUNCTIONS.every((f) => typeof m?.[f] === 'function') ? (m as DonanimOkuyucuNative) : null;
  return cached;
}

/** Yalnız testler: önbelleği sıfırla. */
export function __resetNativeCacheForTests(): void {
  cached = undefined;
}
