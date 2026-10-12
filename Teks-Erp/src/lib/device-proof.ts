// Cihaz kanıtı: `x-device-id` bir beyan, `x-device-proof` onun kanıtı. Sır = HMAC(kısa kimlik
// halkası, "cihaz:<deviceId>:<tuz>") — DB yalnız rastgele tuzu tutar, sır (ya da eşdeğeri) DB'de
// YOKTUR; halka LICENSE_DIR'de. Kanıt = HMAC(sır, "v1\n<ms>\n<YÖNTEM>\n<yol>"), ±5 dk.
import { createHmac, randomBytes } from "node:crypto";
import type { KeyRing, RingKey } from "./short-credential/keyring";
import { ringKeyByKid } from "./short-credential/keyring";
import { digestsEqual } from "./short-credential/digest";

export const DEVICE_PROOF_HEADER = "x-device-proof";
export const DEVICE_PROOF_SKEW_MS = 5 * 60 * 1000;
export const DEVICE_SECRET_BYTES = 32;

const SALT_RE = /^([0-9a-f]{16}):([0-9a-f]{64})$/;
const PROOF_RE = /^v1\.(\d{10,16})\.([0-9a-f]{64})$/;

function hmacHex(key: Buffer, input: string): string {
  return createHmac("sha256", key).update(input, "utf8").digest("hex");
}

/** Yeni tuz: "<kid>:<64 hex>" — kid, hangi halka anahtarıyla türetildiğini söyler (emanetten dönüş). */
export function newProofSalt(k: RingKey): string {
  return `${k.kid}:${randomBytes(DEVICE_SECRET_BYTES).toString("hex")}`;
}

/** Tuzdan sırrı türetir (64 hex). Halkada kid yoksa null — doğrulanamaz. */
export function deriveDeviceSecret(ring: KeyRing, deviceId: string, salt: string): string | null {
  const m = SALT_RE.exec(salt);
  if (!m) return null;
  const k = ringKeyByKid(ring, m[1]!);
  if (!k) return null;
  return hmacHex(k.key, `cihaz:${deviceId}:${m[2]}`);
}

export function proofMessage(ts: number, method: string, path: string): string {
  return `v1\n${ts}\n${method.toUpperCase()}\n${path}`;
}

/** İstemcinin üreteceği başlık değeri (bekçi ve istemci ikizi bu biçimi paylaşır). */
export function buildDeviceProof(secretHex: string, ts: number, method: string, path: string): string {
  return `v1.${ts}.${hmacHex(Buffer.from(secretHex, "hex"), proofMessage(ts, method, path))}`;
}

/** Sorgu ve parça atılmış yol — istemci de imzayı yalnız yol üzerinden kurar. */
export function proofPathOf(originalUrl: string): string {
  return originalUrl.split("?")[0]!.split("#")[0]!;
}

export type ProofVerdict = "OK" | "EKSIK" | "BICIM" | "SAAT" | "IMZA";

export function verifyDeviceProof(
  secretHex: string,
  header: string | undefined,
  target: { method: string; path: string },
  now: number = Date.now(),
): ProofVerdict {
  const { method, path } = target;
  if (!header) return "EKSIK";
  const m = PROOF_RE.exec(header.trim());
  if (!m) return "BICIM";
  const ts = Number(m[1]);
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > DEVICE_PROOF_SKEW_MS) return "SAAT";
  const expected = buildDeviceProof(secretHex, ts, method, path);
  return digestsEqual(expected, header.trim()) ? "OK" : "IMZA";
}
