// Sistem hesabı mührü (G1) — mesaj biçimi, belge kuralları ve TS imza/doğrulaması. Native aynası
// `native/lisans-cekirdek/src/system_seal.rs` (bayt bayt aynı); paketli derlemede imza YALNIZ native'de atılır.
// TS yolu geliştirme/test çekirdeği ve kâhindir: anahtar dosyasını native gibi kendisi okur.
import fs from "node:fs";
import path from "node:path";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { b64uDecode, b64uEncode, installationKeyId, publicKeyX } from "./protocol";

export const SEAL_KEY_FILE = "kurulum-anahtari.json";
export const SEAL_MESSAGE_HEADER = "TEKSERP-SISTEM-HESABI-MUHRU/v1";
const SEAL_PREFIX = "sm1";
const MAX_KEY_BYTES = 8 * 1024;
const MAX_NAME_BYTES = 200;

/** Mühürlenen alanlar: hesap kimliği, giriş adı, kimlik bilgisi özeti (sha256 hex). */
export interface SystemSealDoc {
  readonly id: string;
  readonly ad: string;
  readonly kimlik: string;
}

/** `CEKIRDEK_YOK` native'de yoktur: adaptör üretir (çekirdek yüklenemedi / çağrı istisna attı / yanıt sözleşme dışı). */
export const SEAL_STATUSES = ["MUHURLENDI", "BELGE_BICIMSIZ", "ANAHTAR_YOK", "ANAHTAR_BOZUK", "CEKIRDEK_YOK"] as const;
export const SEAL_CHECK_STATUSES = [
  "GECERLI",
  "BOZUK",
  "BASKA_KURULUM",
  "BICIMSIZ",
  "BELGE_BICIMSIZ",
  "ANAHTAR_YOK",
  "ANAHTAR_BOZUK",
  "CEKIRDEK_YOK",
] as const;
export type SealCheckStatus = (typeof SEAL_CHECK_STATUSES)[number];

export type SealResult =
  | { readonly durum: "MUHURLENDI"; readonly muhur: string; readonly kid: string }
  | { readonly durum: Exclude<(typeof SEAL_STATUSES)[number], "MUHURLENDI"> };
export interface SealCheckResult {
  readonly durum: SealCheckStatus;
  readonly kid?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
// Rust `char::is_control` = Unicode Cc (C0, DEL, C1).
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export function isValidSealDoc(b: SystemSealDoc): boolean {
  return (
    UUID.test(b.id) &&
    b.ad.length > 0 &&
    Buffer.byteLength(b.ad, "utf8") <= MAX_NAME_BYTES &&
    !CONTROL_CHARS.test(b.ad) &&
    SHA256_HEX.test(b.kimlik)
  );
}

export function buildSealMessage(kid: string, b: SystemSealDoc): string {
  return `${SEAL_MESSAGE_HEADER}\nkid:${kid}\nid:${b.id}\nad:${b.ad}\nsistem:1\nkimlik:${b.kimlik}`;
}

type KeyRead =
  | { readonly ok: true; readonly privateKey: ReturnType<typeof createPrivateKey>; readonly kid: string }
  | { readonly ok: false; readonly durum: "ANAHTAR_YOK" | "ANAHTAR_BOZUK" };

function readInstallationKey(dir: string): KeyRead {
  const keyFile = path.join(dir, SEAL_KEY_FILE);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(keyFile);
  } catch (e) {
    return { ok: false, durum: (e as NodeJS.ErrnoException).code === "ENOENT" ? "ANAHTAR_YOK" : "ANAHTAR_BOZUK" };
  }
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_KEY_BYTES) return { ok: false, durum: "ANAHTAR_BOZUK" };
  try {
    const raw = JSON.parse(fs.readFileSync(keyFile, "utf8")) as { v?: unknown; ed25519?: { pkcs8?: unknown; x?: unknown } };
    if (raw.v !== 1 || typeof raw.ed25519?.pkcs8 !== "string" || typeof raw.ed25519.x !== "string") {
      return { ok: false, durum: "ANAHTAR_BOZUK" };
    }
    const der = b64uDecode(raw.ed25519.pkcs8);
    if (!der || der.length !== 48) return { ok: false, durum: "ANAHTAR_BOZUK" };
    const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") return { ok: false, durum: "ANAHTAR_BOZUK" };
    const x = publicKeyX(privateKey);
    if (x !== raw.ed25519.x) return { ok: false, durum: "ANAHTAR_BOZUK" };
    return { ok: true, privateKey, kid: installationKeyId(x) };
  } catch {
    return { ok: false, durum: "ANAHTAR_BOZUK" };
  }
}

export function formatSeal(kid: string, signature: Buffer): string {
  return `${SEAL_PREFIX}.${kid}.${b64uEncode(signature)}`;
}

/** `sm1.<kid>.<imza>` → parçalar; biçimsizse null. */
export function parseSeal(text: string): { kid: string; signature: Buffer } | null {
  const p = text.split(".");
  if (p.length !== 3 || p[0] !== SEAL_PREFIX || !p[1].startsWith("kur-")) return null;
  const kidRaw = b64uDecode(p[1].slice(4));
  const signature = b64uDecode(p[2]);
  if (!kidRaw || kidRaw.length !== 32 || !signature || signature.length !== 64) return null;
  return { kid: p[1], signature };
}

export function sealWithTs(dir: string, doc: SystemSealDoc): SealResult {
  if (!isValidSealDoc(doc)) return { durum: "BELGE_BICIMSIZ" };
  const a = readInstallationKey(dir);
  if (!a.ok) return { durum: a.durum };
  const signature = sign(null, Buffer.from(buildSealMessage(a.kid, doc), "utf8"), a.privateKey);
  return { durum: "MUHURLENDI", muhur: formatSeal(a.kid, signature), kid: a.kid };
}

export function verifySealWithTs(dir: string, doc: SystemSealDoc, seal: string): SealCheckResult {
  if (!isValidSealDoc(doc)) return { durum: "BELGE_BICIMSIZ" };
  const a = readInstallationKey(dir);
  if (!a.ok) return { durum: a.durum };
  const c = parseSeal(seal);
  if (!c) return { durum: "BICIMSIZ", kid: a.kid };
  if (c.kid !== a.kid) return { durum: "BASKA_KURULUM", kid: a.kid };
  const ok = verify(null, Buffer.from(buildSealMessage(a.kid, doc), "utf8"), createPublicKey(a.privateKey), c.signature);
  return { durum: ok ? "GECERLI" : "BOZUK", kid: a.kid };
}
