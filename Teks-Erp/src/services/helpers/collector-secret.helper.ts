// =============================================================================
// TeksERP — MAKİNE KARTI SIRRI · tohum, türetme, istek imzası (tek kaynak)
// =============================================================================
// DB'de sır YOKTUR: yalnız `<kid>:<tohum hex>` durur; sır = HMAC(halka[kid], "collector:<id>:<tohum>").
// Halka PIN/kart özetleriyle aynı (`LICENSE_DIR`, emaneti şifreli yedekte) — DB tek başına sır vermez.
// İmza girdisi protokol belgesindeki biçimle BAYT-EŞİT: docs/design/MAKINE-KART-PROTOKOLU.md.
// =============================================================================
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ringKeyByKid, type KeyRing, type RingKey } from "../../lib/short-credential/keyring";

export const COLLECTOR_SEED_BYTES = 32;
const SEED_RE = /^([0-9a-f]{16}):([0-9a-f]{64})$/;

/** Yeni tohum — etkin halka anahtarının kimliğiyle. */
export function newCollectorSeed(active: RingKey): string {
  return `${active.kid}:${randomBytes(COLLECTOR_SEED_BYTES).toString("hex")}`;
}

/** Tohumdan sırrı türet (32 bayt). Halkada anahtarı olmayan tohum → null (başka makinenin DB'si). */
export function deriveCollectorSecret(ring: KeyRing, collectorId: string, seed: string | null): Buffer | null {
  const m = seed ? SEED_RE.exec(seed) : null;
  if (!m) return null;
  const key = ringKeyByKid(ring, m[1]!);
  if (!key) return null;
  return createHmac("sha256", key.key).update(`collector:${collectorId.toLowerCase()}:${m[2]!}`, "utf8").digest();
}

/** İmzalanan dize: yöntem · yol · zaman damgası · nonce · gövde özeti (satır sonuyla ayrılır). */
export interface CollectorSignedRequest {
  method: string;
  /** Sorgusuz yol, örn. `/api/machine-signals/stop`. */
  path: string;
  timestamp: string;
  nonce: string;
  body: Buffer;
}

export function collectorSigningInput(r: CollectorSignedRequest): string {
  const bodyHash = createHash("sha256").update(r.body).digest("hex");
  return `${r.method.toUpperCase()}\n${r.path}\n${r.timestamp}\n${r.nonce}\n${bodyHash}`;
}

export function signCollectorRequest(secret: Buffer, input: string): string {
  return createHmac("sha256", secret).update(input, "utf8").digest("hex");
}

/** Sabit zamanlı imza karşılaştırması — biçim dışı imza da aynı yoldan düşer. */
export function collectorSignatureMatches(secret: Buffer, input: string, presented: string): boolean {
  const expected = Buffer.from(signCollectorRequest(secret, input), "utf8");
  const got = Buffer.from(/^[0-9a-f]{64}$/.test(presented) ? presented : "", "utf8");
  if (got.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(expected, got);
}
