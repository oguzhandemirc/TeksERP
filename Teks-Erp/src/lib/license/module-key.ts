// Modül anahtarı sarma/açma — Faz 2d için ARAYÜZ. Biçim `.tkenc` alıcı sarmasının kalıbıdır
// (`lib/backup-crypto/stream.ts`): geçici X25519 → ortak sır → HKDF-SHA256 (tuz = geçici açık ‖
// alıcı açık) → AES-256-GCM (sıfır nonce; anahtar her sarmada tektir). Fark: HKDF bilgisine MODÜL
// ADI girer — bir modül için sarılmış anahtar başkasının yerine geçemez. Sarma satıcı tarafındadır;
// açma üretimde native çekirdekte (`native/lisans-cekirdek/src/module_key.rs`), bu dosya onun
// başvurusu ve geliştirme yoludur (kâhin bekçisi iki tarafı aynı vektörlerde ölçer).
import crypto, { type KeyObject } from "node:crypto";
import { z } from "zod";
import { ModuleKeySchema, b64uDecode, b64uEncode } from "./protocol";

export const MODULE_KEY_HKDF_PREFIX = "tekserp/modul-anahtari/v1";
export const MODULE_KEY_ERROR_CODES = ["MODUL_SARMA_BICIM", "MODUL_UYUSMAZ", "MODUL_ANAHTAR_GECERSIZ", "MODUL_SARMA_ACILAMADI"] as const;
export type ModuleKeyErrorCode = (typeof MODULE_KEY_ERROR_CODES)[number];

/** Kiraya (2d) gömülecek sarma: `{v, modul, epk (32 bayt), sarili (32 anahtar + 16 etiket)}`. */
export const ModuleKeyWrapSchema = z.object({
  v: z.literal(1),
  modul: ModuleKeySchema,
  epk: z.string(),
  sarili: z.string(),
});
export type ModuleKeyWrap = z.infer<typeof ModuleKeyWrapSchema>;

export type ModuleKeyResult =
  | { readonly ok: true; readonly value: { readonly anahtar: string } }
  | { readonly ok: false; readonly code: ModuleKeyErrorCode; readonly message: string };

// X25519 PKCS#8 DER öneki (RFC 8410) — ham 32 bayttan özel anahtar kurmanın bağımlılıksız yolu.
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

function x25519Public(raw: Buffer): KeyObject {
  return crypto.createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64uEncode(raw) }, format: "jwk" });
}

function x25519Private(raw: Buffer): KeyObject {
  return crypto.createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
}

function rawPublic(key: KeyObject): Buffer {
  const jwk = key.export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("module-key: açık anahtar dışa aktarılamadı");
  const raw = b64uDecode(jwk.x);
  if (!raw) throw new Error("module-key: açık anahtar biçimsiz");
  return raw;
}

function wrapKeyFor(shared: Buffer, epk: Buffer, recipientPublic: Buffer, modul: string): Buffer {
  const info = Buffer.from(`${MODULE_KEY_HKDF_PREFIX}\u001f${modul}`, "utf8");
  return Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.concat([epk, recipientPublic]), info, 32));
}

/** Satıcı tarafı (ve test): 32 baytlık modül anahtarını kurulumun X25519 açık anahtarına sarar. */
export function wrapModuleKey(g: { readonly moduleKey: Buffer; readonly recipientPublicX: string; readonly modul: string }): ModuleKeyWrap {
  const recipient = b64uDecode(g.recipientPublicX);
  if (g.moduleKey.length !== 32 || !recipient || recipient.length !== 32 || !ModuleKeySchema.safeParse(g.modul).success) {
    throw new Error("wrapModuleKey: anahtar 32 bayt, alıcı 32 bayt ve modül adı geçerli olmalı");
  }
  const eph = crypto.generateKeyPairSync("x25519");
  const epk = rawPublic(eph.publicKey);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: x25519Public(recipient) });
  const c = crypto.createCipheriv("aes-256-gcm", wrapKeyFor(shared, epk, recipient, g.modul), Buffer.alloc(12));
  const sarili = Buffer.concat([c.update(g.moduleKey), c.final(), c.getAuthTag()]);
  return { v: 1, modul: g.modul, epk: b64uEncode(epk), sarili: b64uEncode(sarili) };
}

function failure(code: ModuleKeyErrorCode, message: string): ModuleKeyResult {
  return { ok: false, code, message };
}

/** Sarmayı açar (native `module_key::unwrap` ile AYNI denetim sırası). */
export function unwrapModuleKey(wrap: unknown, privateKeyX: string, expectedModule: string): ModuleKeyResult {
  if (typeof wrap !== "object" || wrap === null || Array.isArray(wrap)) return failure("MODUL_SARMA_BICIM", "Modül sarması bir JSON nesnesi değil");
  if (!("v" in wrap) || wrap.v !== 1) return failure("MODUL_SARMA_BICIM", "Desteklenmeyen modül sarması sürümü");
  const modul = "modul" in wrap ? wrap.modul : undefined;
  if (typeof modul !== "string" || !ModuleKeySchema.safeParse(modul).success) {
    return failure("MODUL_SARMA_BICIM", "Modül sarmasında modül adı geçersiz");
  }
  const epk = "epk" in wrap && typeof wrap.epk === "string" ? b64uDecode(wrap.epk) : null;
  const wrapped = "sarili" in wrap && typeof wrap.sarili === "string" ? b64uDecode(wrap.sarili) : null;
  if (!epk || epk.length !== 32 || !wrapped || wrapped.length !== 48) {
    return failure("MODUL_SARMA_BICIM", "Modül sarması biçimsiz (epk 32 · sarili 48 bayt)");
  }
  if (modul !== expectedModule) return failure("MODUL_UYUSMAZ", `Sarma ${modul} modülüne ait, istenen ${expectedModule}`);
  const privateRaw = b64uDecode(privateKeyX);
  if (!privateRaw || privateRaw.length !== 32) return failure("MODUL_ANAHTAR_GECERSIZ", "Kurulumun X25519 özel anahtarı biçimsiz");
  const privateKey = x25519Private(privateRaw);
  let shared: Buffer;
  try {
    shared = crypto.diffieHellman({ privateKey, publicKey: x25519Public(epk) });
  } catch {
    // OpenSSL düşük mertebeli noktada (ortak sır sıfır) türetmeyi reddeder.
    return failure("MODUL_ANAHTAR_GECERSIZ", "Geçici anahtar düşük mertebeli (ortak sır sıfır)");
  }
  if (shared.every((b) => b === 0)) return failure("MODUL_ANAHTAR_GECERSIZ", "Geçici anahtar düşük mertebeli (ortak sır sıfır)");
  const ownPublic = rawPublic(crypto.createPublicKey(privateKey));
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", wrapKeyFor(shared, epk, ownPublic, modul), Buffer.alloc(12));
    d.setAuthTag(wrapped.subarray(32));
    const key = Buffer.concat([d.update(wrapped.subarray(0, 32)), d.final()]);
    return { ok: true, value: { anahtar: b64uEncode(key) } };
  } catch {
    return failure("MODUL_SARMA_ACILAMADI", "Modül anahtarı açılamadı (başka kuruluma ait ya da kurcalanmış)");
  }
}
