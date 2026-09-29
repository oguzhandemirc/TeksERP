// Modül anahtarı sarması (Faz 2d) — satıcı SARAR, fabrika (native çekirdek) AÇAR. Biçim `.tkenc`
// alıcı sarmasının kalıbıdır: geçici X25519 → ortak sır → HKDF-SHA256 (tuz = geçici açık ‖ alıcı
// açık, bilgi = önek ␟ modül) → AES-256-GCM (sıfır nonce; anahtar her sarmada tektir). Modül adı
// HKDF bilgisine girer: bir modülün sarması başkasının yerine geçemez.
import crypto, { type KeyObject } from "node:crypto";
import { z } from "zod";
import { ModuleKeyIdSchema, ModuleKeySchema, type ModuleKeyWrap } from "./belgeler";
import { b64uDecode, b64uEncode } from "./ortak";

export const MODULE_KEY_HKDF_PREFIX = "tekserp/modul-anahtari/v1";
/** Anahtar kimliği öneki: kid anahtarın özetidir — açılan anahtarın doğru anahtar olduğu ölçülür. */
export const MODULE_KEY_KID_PREFIX = "tekserp/modul-anahtari/kid/v1";
export const MODULE_KEY_BYTES = 32;

/** `mk-` + base64url(sha256(önek ␟ anahtar)) ilk 22 karakter (132 bit). Anahtarı açığa vurmaz. */
export function moduleKeyId(key: Buffer): string {
  if (key.length !== MODULE_KEY_BYTES) throw new Error("moduleKeyId: anahtar 32 bayt olmalı");
  const digest = crypto.createHash("sha256").update(`${MODULE_KEY_KID_PREFIX}\u001f`, "utf8").update(key).digest();
  return `mk-${b64uEncode(digest).slice(0, 22)}`;
}

export function x25519PublicFromRaw(raw: Buffer): KeyObject {
  return crypto.createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64uEncode(raw) }, format: "jwk" });
}

export function x25519RawPublic(key: KeyObject): Buffer {
  const jwk = key.export({ format: "jwk" });
  const raw = typeof jwk.x === "string" ? b64uDecode(jwk.x) : null;
  if (!raw || raw.length !== 32) throw new Error("x25519: açık anahtar dışa aktarılamadı");
  return raw;
}

/** HKDF: tuz = geçici açık ‖ alıcı açık, bilgi = önek ␟ modül (bir modülün sarması başkasına geçmez). */
export function moduleWrapKey(shared: Buffer, epk: Buffer, recipientPublic: Buffer, modul: string): Buffer {
  const info = Buffer.from(`${MODULE_KEY_HKDF_PREFIX}\u001f${modul}`, "utf8");
  return Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.concat([epk, recipientPublic]), info, 32));
}

/** Satıcı tarafı: 32 baytlık modül anahtarını kurulumun X25519 açık anahtarına sarar. */
export function wrapModuleKey(g: { readonly moduleKey: Buffer; readonly recipientPublicX: string; readonly modul: string }): ModuleKeyWrap {
  const recipient = b64uDecode(g.recipientPublicX);
  if (g.moduleKey.length !== MODULE_KEY_BYTES || !recipient || recipient.length !== 32 || !ModuleKeySchema.safeParse(g.modul).success) {
    throw new Error("wrapModuleKey: anahtar 32 bayt, alıcı 32 bayt ve modül adı geçerli olmalı");
  }
  const eph = crypto.generateKeyPairSync("x25519");
  const epk = x25519RawPublic(eph.publicKey);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: x25519PublicFromRaw(recipient) });
  if (shared.every((b) => b === 0)) throw new Error("wrapModuleKey: alıcı anahtarı düşük mertebeli");
  const c = crypto.createCipheriv("aes-256-gcm", moduleWrapKey(shared, epk, recipient, g.modul), Buffer.alloc(12));
  const sarili = Buffer.concat([c.update(g.moduleKey), c.final(), c.getAuthTag()]);
  return { v: 1, modul: g.modul, epk: b64uEncode(epk), sarili: b64uEncode(sarili) };
}

/**
 * Hazırlık makinesindeki modül anahtarı DOSYASI (0600, repo dışı): satıcı CLI'ı `uret` ile yazar, kasaya
 * `ice-aktar` ile alır; korumalı derleme paketi bununla şifreler. `kid` anahtarın özeti olmalı.
 */
export const ModuleKeyFileSchema = z.strictObject({
  v: z.literal(1),
  tur: z.literal("tekserp-modul-anahtari"),
  modul: ModuleKeySchema,
  surum: z.number().int().min(1),
  kid: ModuleKeyIdSchema,
  anahtar: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

/** Dosya içeriğini doğrular; kid anahtarla uyuşmazsa null (kurcalanmış dosya kabul edilmez). */
export function parseModuleKeyFile(raw: unknown): { modul: string; surum: number; kid: string; anahtar: Buffer } | null {
  const parsed = ModuleKeyFileSchema.safeParse(raw);
  if (!parsed.success) return null;
  const anahtar = b64uDecode(parsed.data.anahtar);
  if (!anahtar || anahtar.length !== MODULE_KEY_BYTES || moduleKeyId(anahtar) !== parsed.data.kid) return null;
  return { modul: parsed.data.modul, surum: parsed.data.surum, kid: parsed.data.kid, anahtar };
}
