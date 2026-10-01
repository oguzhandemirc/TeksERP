// =============================================================================
// TABLET APK KÜNYESİ DOĞRULAYICISI — `apk/surum.json` içindeki imzalı künye (`typ: tekserp-apk`)
// =============================================================================
// İmzasız künyenin `indirmeUrl`i koşulsuz izleniyor, sha256'sı hiç ölçülmüyordu: güncelleme sunucusuna yazabilen
// biri sahadaki tabletlere güvenilir güncelleme ekranından keyfi APK kurdurabilirdi. Artık:
//   ① künye gömülü çapadaki anahtarla imzalı, BU kanalın (kanal tabletin gömülü güncelleme adresinden) ve
//      surum.json'un eski tabletin okuduğu alanlarıyla birebir olmalı;
//   ② indirme adresi künyeden DEĞİL gömülü kanal kökünden + imzalı dosya adından türer (belirteç başka ana
//      makineye gitmez);
//   ③ inen dosyanın boyu + sha256'sı imzalı künyedekiyle aynı değilse kurulum ekranı AÇILMAZ, dosya silinir.
// Kurallar yayın tarafının aynası (`mobil/scripts/lib/apk-kunye.mjs` · JWS: panel/lisans protokolü); kripto saf
// JS (`lib/kripto`). Çapa (`lib/apk-imza-capasi.json`) JS paketindedir: OTA kod imzasıyla korunur.
// =============================================================================
import { ed25519Verify } from '../lib/kripto/ed25519';
import { Sha256, hex } from '../lib/kripto/sha2';

export const APK_RELEASE_TYP = 'tekserp-apk';
const ALLOWED_HEADER = ['alg', 'typ', 'kid'];
const KID = /^[a-z]+-[A-Za-z0-9_-]{1,64}$/;
const SIGNER_KID = /^(?:paket|panel)-[a-z0-9-]{1,40}$/;
const CHANNEL = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VERSION = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const JWS_MAX = 32 * 1024;

export interface AnchorKey {
  readonly kid: string;
  readonly x: string;
}

export interface ApkDoc {
  readonly kanal: string;
  readonly versionCode: number;
  readonly versionName: string;
  readonly paket: { readonly ad: string; readonly boyut: number; readonly sha256: string };
  readonly capa: readonly string[];
}

export type VerifyResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string };

const MESSAGES: Record<string, string> = {
  CAPA_BOS: 'Bu tablette kurulum dosyası imza anahtarı tanımlı değil; güncelleme doğrulanamadığı için kurulmadı.',
  CAPA_GECERSIZ: 'Bu tabletteki imza anahtarı listesi bozuk; kurulum dosyası doğrulanamadı.',
  KUNYE_YOK: 'Kurulum dosyası imzasız yayınlanmış; güvenlik nedeniyle kurulmadı.',
  KUNYE_BICIM: 'Kurulum dosyasının künyesi bozuk; güvenlik nedeniyle kurulmadı.',
  JWS: 'Kurulum dosyasının imzası doğrulanamadı; güvenlik nedeniyle kurulmadı.',
  BELGE: 'Kurulum dosyasının künyesi tanınmayan biçimde; kurulmadı.',
  KUNYE_KANAL: 'Kurulum dosyası başka bir müşterinin kanalına ait; kurulmadı.',
  KUNYE_DOSYA: 'Sürüm künyesi imzalı bilgiyle uyuşmuyor; kurulmadı.',
  DOSYA_OZETI: 'İndirilen kurulum dosyası imzalı künyeyle eşleşmiyor; kurulmadı ve silindi.',
  DOSYA_OKUNAMADI: 'İndirilen kurulum dosyası okunamadı; kurulmadı.',
};

const failure = <T>(code: string, detail = ''): VerifyResult<T> => ({
  ok: false,
  code,
  message: (MESSAGES[code] ?? MESSAGES[code.split('_')[0]] ?? 'Kurulum dosyası doğrulanamadı; kurulmadı.') + (detail ? ` (${detail})` : ''),
});

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Katı base64url (dolgu yok, kanonik kuyruk) → bayt; geçersizse null. */
export function b64uDecode(s: unknown): Uint8Array | null {
  if (typeof s !== 'string' || s.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let buffer = 0;
  let bit = 0;
  let j = 0;
  for (const c of s) {
    buffer = (buffer << 6) | B64URL.indexOf(c);
    bit += 6;
    if (bit >= 8) {
      bit -= 8;
      out[j++] = (buffer >> bit) & 0xff;
    }
  }
  if (bit > 0 && (buffer & ((1 << bit) - 1)) !== 0) return null;
  return out;
}

const ascii = (b: Uint8Array): string | null => {
  let s = '';
  for (const x of b) {
    if (x > 0x7e || (x < 0x20 && x !== 0x0a)) return null;
    s += String.fromCharCode(x);
  }
  return s;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function decodeJsonPart(p: string): unknown {
  const b = b64uDecode(p);
  const s = b ? ascii(b) : null;
  if (s === null) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** JWS (EdDSA, başlık allowlist) → yük; panel/lisans `verifyJws` kuralları ve sırası. */
export function verifyApkJws(token: unknown, keys: readonly AnchorKey[]): VerifyResult<{ kid: string; payload: Record<string, unknown> }> {
  if (!Array.isArray(keys) || keys.length === 0) return failure('CAPA_BOS');
  const keyMap = new Map<string, Uint8Array>();
  for (const k of keys) {
    const x = b64uDecode(k?.x);
    if (typeof k?.kid !== 'string' || !SIGNER_KID.test(k.kid) || k.kid.startsWith('paket-hazirlik') || !x || x.length !== 32 || keyMap.has(k.kid)) {
      return failure('CAPA_GECERSIZ');
    }
    keyMap.set(k.kid, x);
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > JWS_MAX) return failure('JWS_BICIM');
  const parts = token.split('.');
  if (parts.length !== 3) return failure('JWS_BICIM');
  const header = decodeJsonPart(parts[0]);
  if (!isObject(header)) return failure('JWS_BICIM');
  if (header.alg !== 'EdDSA') return failure('JWS_ALG');
  if (Object.keys(header).some((a) => !ALLOWED_HEADER.includes(a))) return failure('JWS_BASLIK');
  if (typeof header.typ !== 'string' || !/^tekserp-[a-z]+$/.test(header.typ)) return failure('JWS_TYP');
  if (typeof header.kid !== 'string' || !KID.test(header.kid)) return failure('JWS_KID');
  const payload = decodeJsonPart(parts[1]);
  if (!isObject(payload)) return failure('JWS_BICIM');
  const signature = b64uDecode(parts[2]);
  if (!signature || signature.length !== 64) return failure('JWS_BICIM');
  if (header.typ !== APK_RELEASE_TYP) return failure('JWS_TYP');
  const publicKey = keyMap.get(header.kid);
  if (!publicKey) return failure('JWS_KID');
  const input = new Uint8Array([...`${parts[0]}.${parts[1]}`].map((c) => c.charCodeAt(0)));
  return ed25519Verify(publicKey, input, signature) ? { ok: true, value: { kid: header.kid, payload } } : failure('JWS_IMZA');
}

/** Künye yükü — yayın tarafının `decodeApkDoc` aynası (bilinen alanlar katı, bilinmeyen yok sayılır). */
export function decodeApkDoc(p: Record<string, unknown>): VerifyResult<ApkDoc> {
  if (p.v !== 1) return failure('BELGE_SURUM');
  const a = isObject(p.paket) ? p.paket : null;
  const vc = p.versionCode;
  const vn = p.versionName;
  const valid =
    p.urun === 'tablet' &&
    p.platform === 'android-arm64' &&
    typeof p.kanal === 'string' && CHANNEL.test(p.kanal) &&
    typeof vc === 'number' && Number.isSafeInteger(vc) && vc >= 1 && vc <= 999999999 &&
    typeof vn === 'string' && VERSION.test(vn) &&
    typeof p.commit === 'string' && COMMIT.test(p.commit) &&
    typeof p.yayinZamani === 'string' && ISO.test(p.yayinZamani) &&
    Array.isArray(p.capa) && p.capa.length > 0 && p.capa.length <= 16 &&
    p.capa.every((k) => typeof k === 'string' && SIGNER_KID.test(k)) && new Set(p.capa).size === p.capa.length &&
    a !== null &&
    a.ad === `TeksERP-${String(vn)}-vc${String(vc)}.apk` &&
    typeof a.boyut === 'number' && Number.isSafeInteger(a.boyut) && a.boyut >= 1 &&
    typeof a.sha256 === 'string' && SHA256_HEX.test(a.sha256);
  if (!valid || !a) return failure('BELGE_SEMA');
  return {
    ok: true,
    value: {
      kanal: p.kanal as string,
      versionCode: vc as number,
      versionName: vn as string,
      paket: { ad: a.ad as string, boyut: a.boyut as number, sha256: a.sha256 as string },
      capa: p.capa as string[],
    },
  };
}

/** `https://…/<kanal>/mobil/` → kanal kodu (tabletin gömülü güncelleme adresinden; değiştirilemez). */
export function feedChannel(feedBase: string | null): string | null {
  const m = feedBase ? /^https:\/\/[^/]+\/([a-z0-9][a-z0-9-]{0,39})\/mobil\/$/.exec(feedBase) : null;
  return m ? m[1] : null;
}

/** surum.json → doğrulanmış künye (imza · kanal · eski tabletin okuduğu alanlarla bağ). */
export function verifyApkRelease(s: unknown, g: { keys: readonly AnchorKey[]; channel: string | null }): VerifyResult<ApkDoc> {
  if (!isObject(s)) return failure('KUNYE_BICIM');
  const block = s.tekserp;
  if (block === undefined || block === null) return failure('KUNYE_YOK');
  if (!isObject(block) || Object.keys(block).some((k) => k !== 'v' && k !== 'bildirim') || typeof block.bildirim !== 'string') return failure('KUNYE_BICIM');
  if (block.v !== 1) return failure('BELGE_SURUM');
  const j = verifyApkJws(block.bildirim, g.keys);
  if (!j.ok) return j;
  const d = decodeApkDoc(j.value.payload);
  if (!d.ok) return d;
  if (!g.channel || d.value.kanal !== g.channel) return failure('KUNYE_KANAL', `${d.value.kanal}`);
  const v = d.value;
  if (s.versionCode !== v.versionCode || s.versionName !== v.versionName || s.dosya !== v.paket.ad || s.sha256 !== v.paket.sha256 || s.boyut !== v.paket.boyut) {
    return failure('KUNYE_DOSYA');
  }
  return d;
}

/** İndirme adresi: gömülü kanal kökü + imzalı dosya adı (künyedeki `indirmeUrl` KULLANILMAZ). */
export function apkDownloadUrl(feedBase: string, doc: ApkDoc): string {
  return `${feedBase}apk/${doc.paket.ad}`;
}

/** Bir parça okuyucu: boş Uint8Array = dosya sonu. */
export type ChunkReader = () => Uint8Array;

/**
 * İndirilen dosyanın boyu + sha256'sı künyedekiyle aynı mı? Okuma parça parça (bellek), parçalar arası
 * olay döngüsüne nefes verilir (ekran donmasın); `onProgress` 0..1.
 */
export async function verifyApkFile(
  doc: ApkDoc,
  read: ChunkReader,
  onProgress?: (ratio: number) => void,
): Promise<VerifyResult<true>> {
  const h = new Sha256();
  let size = 0;
  try {
    for (;;) {
      const p = read();
      if (p.length === 0) break;
      h.update(p);
      size += p.length;
      if (size > doc.paket.boyut) return failure('DOSYA_OZETI', 'boyut');
      onProgress?.(size / doc.paket.boyut);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  } catch (e) {
    return failure('DOSYA_OKUNAMADI', e instanceof Error ? e.message : String(e));
  }
  if (size !== doc.paket.boyut) return failure('DOSYA_OZETI', 'boyut');
  return hex(h.digest()) === doc.paket.sha256 ? { ok: true, value: true } : failure('DOSYA_OZETI', 'sha256');
}
