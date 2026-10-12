// Cihaz kanıtı istemci durumu: sır (SecureStore) + sunucu saat farkı. Başlık YALNIZ
// `services/api.ts` istek katmanında eklenir (tek yer); bu modül değeri üretir.
import { storage } from '../utils/storage';
import { buildDeviceProof, DEVICE_SECRET_RE, proofPathOf } from '../lib/device-proof';

export const DEVICE_PROOF_HEADER = 'x-device-proof';
const SECRET_KEY = 'device_proof_secret';

let cached: Promise<string | null> | null = null;
let clockOffsetMs = 0;

export function getDeviceSecret(): Promise<string | null> {
  if (!cached) {
    cached = storage.getItem(SECRET_KEY).then(
      (v) => (v && DEVICE_SECRET_RE.test(v) ? v : null),
      () => {
        cached = null;
        return null;
      },
    );
  }
  return cached;
}

/** announce/status cevabındaki `deviceSecret` (yalnız verildiği cevapta gelir). */
export async function rememberDeviceSecret(body: unknown): Promise<void> {
  const s = (body as { data?: { deviceSecret?: unknown } } | null)?.data?.deviceSecret;
  if (typeof s !== 'string' || !DEVICE_SECRET_RE.test(s)) return;
  await storage.setItem(SECRET_KEY, s);
  cached = Promise.resolve(s);
}

/** Sunucu saatine hizalanma: HTTP `Date` başlığı (saniye çözünürlük ±5 dk pencerede yeter). */
export function noteServerDate(dateHeader: unknown, now: number = Date.now()): void {
  if (typeof dateHeader !== 'string') return;
  const server = Date.parse(dateHeader);
  if (Number.isFinite(server)) clockOffsetMs = server - now;
}

export async function deviceProofFor(method: string | undefined, uri: string, now: number = Date.now()): Promise<string | null> {
  const secret = await getDeviceSecret();
  if (!secret) return null;
  return buildDeviceProof(secret, Math.round(now + clockOffsetMs), (method ?? 'get').toUpperCase(), proofPathOf(uri));
}

/** 401 DEVICE_PROOF_INVALID → sır tazelenip istek BİR kez yeniden denenir. */
export function isProofRejection(status: number | undefined, body: unknown): boolean {
  const code = (body as { details?: { code?: unknown } } | null)?.details?.code;
  return status === 401 && code === 'DEVICE_PROOF_INVALID';
}

export function __resetDeviceProofForTests(): void {
  cached = null;
  clockOffsetMs = 0;
}
