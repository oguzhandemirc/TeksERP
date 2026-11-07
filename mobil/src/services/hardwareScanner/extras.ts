// Intent extras yardımcıları — saf: etiketli değer kurucuları (giden) + byte[] / metin çözücü (gelen).
import type { IntentExtraValue, TaggedExtra, TaggedExtras } from './native';

/** Giden extras kurucuları — native `toBundle` etiketleri. */
export const X = {
  str: (v: string): TaggedExtra => ({ t: 'string', v }),
  int: (v: number): TaggedExtra => ({ t: 'int', v }),
  long: (v: number): TaggedExtra => ({ t: 'long', v }),
  bool: (v: boolean): TaggedExtra => ({ t: 'bool', v }),
  bundle: (v: TaggedExtras): TaggedExtra => ({ t: 'bundle', v }),
  bundleArray: (v: TaggedExtras[]): TaggedExtra => ({ t: 'bundleArray', v }),
  bundleList: (v: TaggedExtras[]): TaggedExtra => ({ t: 'bundleList', v }),
  stringArray: (v: string[]): TaggedExtra => ({ t: 'stringArray', v }),
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** Base64 → bayt dizisi (Hermes'te `atob`/`Buffer`a güvenmeden). Geçersiz karakter atlanır. */
export function base64ToBytes(b64: string): number[] {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of b64) {
    const v = B64_INDEX[ch];
    if (v === undefined) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

/** UTF-8 çöz; geçersiz dizide `null` (çağıran Latin-1'e düşer). */
export function decodeUtf8Strict(bytes: readonly number[]): string | null {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp: number;
    let n: number;
    if (b < 0x80) { cp = b; n = 0; }
    else if (b >= 0xc2 && b < 0xe0) { cp = b & 0x1f; n = 1; }
    else if (b >= 0xe0 && b < 0xf0) { cp = b & 0x0f; n = 2; }
    else if (b >= 0xf0 && b < 0xf5) { cp = b & 0x07; n = 3; }
    else return null;
    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    s += String.fromCodePoint(cp);
    i += n + 1;
  }
  return s;
}

/** Bayt → metin: önce UTF-8, olmazsa Latin-1 (okuyucu ham ISO-8859-1 verebilir). */
export function bytesToText(bytes: readonly number[]): string {
  return decodeUtf8Strict(bytes) ?? String.fromCharCode(...bytes);
}

function isBytes(v: IntentExtraValue | undefined): v is { $bytes: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { $bytes?: unknown }).$bytes === 'string';
}

/** byte[] extra'yı metne çevir; `length` verilirse ilk `length` bayt (okuyucu tamponu uzun olabilir). */
export function decodeBytesExtra(v: IntentExtraValue | undefined, length?: IntentExtraValue): string | null {
  if (!isBytes(v)) return null;
  let bytes = base64ToBytes(v.$bytes);
  if (typeof length === 'number' && Number.isFinite(length) && length >= 0 && length < bytes.length) {
    bytes = bytes.slice(0, Math.floor(length));
  }
  return bytesToText(bytes);
}

export function stringExtra(v: IntentExtraValue | undefined): string | null {
  return typeof v === 'string' ? v : null;
}

export function numberExtra(v: IntentExtraValue | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
