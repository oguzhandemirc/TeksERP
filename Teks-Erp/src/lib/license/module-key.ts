// Modül anahtarı AÇMA (fabrika) — sarma protokolde (`protocol/modul-anahtari.ts`). Biçim `.tkenc` alıcı sarmasının kalıbıdır
// (`lib/backup-crypto/stream.ts`): geçici X25519 → ortak sır → HKDF-SHA256 (tuz = geçici açık ‖
// alıcı açık) → AES-256-GCM (sıfır nonce; anahtar her sarmada tektir). Fark: HKDF bilgisine MODÜL
// ADI girer — bir modül için sarılmış anahtar başkasının yerine geçemez. Sarma satıcı tarafındadır;
// açma üretimde native çekirdekte (`native/lisans-cekirdek/src/module_key.rs`), bu dosya onun
// başvurusu ve geliştirme yoludur (kâhin bekçisi iki tarafı aynı vektörlerde ölçer).
import crypto, { type KeyObject } from "node:crypto";
import {
  ModuleKeySchema,
  b64uDecode,
  b64uEncode,
  checkLeaseBinding,
  moduleKeyId,
  moduleWrapKey,
  verifyEntitlement,
  verifyLease,
  x25519PublicFromRaw,
  x25519RawPublic,
  type ProtocolErrorCode,
  type RootKey,
} from "./protocol";
import { ROOT_PUBLIC_KEYS } from "./trust-anchor";

export {
  MODULE_KEY_HKDF_PREFIX,
  ModuleKeyWrapSchema,
  wrapModuleKey,
  moduleKeyId,
  type ModuleKeyWrap,
} from "./protocol";
export const MODULE_KEY_ERROR_CODES = ["MODUL_SARMA_BICIM", "MODUL_UYUSMAZ", "MODUL_ANAHTAR_GECERSIZ", "MODUL_SARMA_ACILAMADI"] as const;
export type ModuleKeyErrorCode = (typeof MODULE_KEY_ERROR_CODES)[number];

export type ModuleKeyResult =
  | { readonly ok: true; readonly value: { readonly anahtar: string } }
  | { readonly ok: false; readonly code: ModuleKeyErrorCode; readonly message: string };

// X25519 PKCS#8 DER öneki (RFC 8410) — ham 32 bayttan özel anahtar kurmanın bağımlılıksız yolu.
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

export function x25519Private(raw: Buffer): KeyObject {
  return crypto.createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
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
    shared = crypto.diffieHellman({ privateKey, publicKey: x25519PublicFromRaw(epk) });
  } catch {
    // OpenSSL düşük mertebeli noktada (ortak sır sıfır) türetmeyi reddeder.
    return failure("MODUL_ANAHTAR_GECERSIZ", "Geçici anahtar düşük mertebeli (ortak sır sıfır)");
  }
  if (shared.every((b) => b === 0)) return failure("MODUL_ANAHTAR_GECERSIZ", "Geçici anahtar düşük mertebeli (ortak sır sıfır)");
  const ownPublic = x25519RawPublic(crypto.createPublicKey(privateKey));
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", moduleWrapKey(shared, epk, ownPublic, modul), Buffer.alloc(12));
    d.setAuthTag(wrapped.subarray(32));
    const key = Buffer.concat([d.update(wrapped.subarray(0, 32)), d.final()]);
    return { ok: true, value: { anahtar: b64uEncode(key) } };
  } catch {
    return failure("MODUL_SARMA_ACILAMADI", "Modül anahtarı açılamadı (başka kuruluma ait ya da kurcalanmış)");
  }
}

/** Kiradan açmanın ek kodları (Faz 2d) — native `code::CORE` aynası. */
export const LEASE_MODULE_KEY_ERROR_CODES = ["MODUL_HAK_YOK", "MODUL_DONMUS", "MODUL_ANAHTARI_YOK", "MODUL_KID_UYUSMAZ"] as const;
export type LeaseModuleKeyErrorCode = (typeof LEASE_MODULE_KEY_ERROR_CODES)[number];

export interface LeaseModuleKeyRequest {
  readonly lease: unknown;
  readonly entitlement: unknown;
  readonly privateKeyX: string;
  readonly modul: string;
  readonly kid: string;
  readonly roots?: readonly RootKey[];
}

export type LeaseModuleKeyResult =
  | { readonly ok: true; readonly value: { readonly anahtar: string; readonly surum: number } }
  | { readonly ok: false; readonly code: ProtocolErrorCode | ModuleKeyErrorCode | LeaseModuleKeyErrorCode; readonly message: string };

/**
 * Modül anahtarı YALNIZ doğrulanmış kiradan (native `unwrap_lease_module_key` ile AYNI sıra): kira →
 * HAK → bağ → modül HAK'ta mı → dondurulmuş mu → kirada (modül, kid) hakkı → sarma → açılan anahtarın kimliği.
 */
export function unwrapLeaseModuleKey(g: LeaseModuleKeyRequest): LeaseModuleKeyResult {
  const anchor = g.roots ?? ROOT_PUBLIC_KEYS;
  const k = verifyLease(g.lease, anchor);
  if (!k.ok) return k;
  const h = verifyEntitlement(g.entitlement, anchor);
  if (!h.ok) return h;
  const bound = checkLeaseBinding(k.value, h.value);
  if (!bound.ok) return bound;
  if (!h.value.document.moduller.includes(g.modul)) return { ok: false, code: "MODUL_HAK_YOK", message: `${g.modul} modülü HAK'ta yok` };
  if (k.value.document.yaptirim.donmusModuller.includes(g.modul)) {
    return { ok: false, code: "MODUL_DONMUS", message: `${g.modul} modülü lisans sunucusunca dondurulmuş` };
  }
  const grant = (k.value.document.modulAnahtarlari ?? []).find((x) => x.modul === g.modul && x.kid === g.kid);
  if (!grant) return { ok: false, code: "MODUL_ANAHTARI_YOK", message: `Kira ${g.modul} modülünün ${g.kid} anahtarını taşımıyor` };
  const opened = unwrapModuleKey(grant.sarma, g.privateKeyX, g.modul);
  if (!opened.ok) return opened;
  const raw = b64uDecode(opened.value.anahtar);
  if (!raw || moduleKeyId(raw) !== g.kid) return { ok: false, code: "MODUL_KID_UYUSMAZ", message: "Açılan anahtarın kimliği istenen kimlik değil" };
  return { ok: true, value: { anahtar: opened.value.anahtar, surum: grant.surum } };
}
