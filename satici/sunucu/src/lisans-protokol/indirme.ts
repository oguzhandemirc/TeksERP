// İNDİRME belirteci: kanal-öneki + kurulum + kısa ömür. Doğrulayıcı kenarda (CF Worker)
// yeniden yazılır; bu dosya onun kâhinidir — iki taraf aynı sınırları uygular.
import type { KeyObject } from "node:crypto";
import { publicKeyFromX, verifyJws } from "./jws";
import { DownloadSchema, TYP, decodeDocument, signDocument, type DownloadDoc } from "./belgeler";
import { CLOCK_SKEW_MS, success, failure, forwardFailure, isoToMs, type Result } from "./ortak";

export const DOWNLOAD_MAX_TTL_MS = 70 * 60 * 1000;
const DOWNLOAD_KID_PATTERN = /^ind-[a-z0-9-]{1,60}$/;

export interface DownloadPublicKey {
  readonly kid: string;
  readonly x: string;
}

export function signDownloadToken(g: {
  readonly payload: DownloadDoc;
  readonly key: { readonly kid: string; readonly privateKey: KeyObject };
  readonly nowMs: number;
}): string {
  if (!DOWNLOAD_KID_PATTERN.test(g.key.kid)) throw new Error("signDownloadToken: kid ind- ile başlamalı");
  if (isoToMs(g.payload.exp) - g.nowMs > DOWNLOAD_MAX_TTL_MS) {
    throw new Error("signDownloadToken: ömür 70 dakikayı aşamaz");
  }
  return signDocument({ typ: TYP.INDIRME, schema: DownloadSchema, payload: g.payload, key: g.key });
}

export function verifyDownloadToken(
  token: unknown,
  g: { readonly keys: readonly DownloadPublicKey[]; readonly nowMs: number },
): Result<DownloadDoc> {
  const lookup = new Map<string, KeyObject>();
  for (const a of g.keys) {
    const keyObj = DOWNLOAD_KID_PATTERN.test(a.kid) ? publicKeyFromX(a.x) : null;
    if (keyObj) lookup.set(a.kid, keyObj);
  }
  const j = verifyJws(token, { typ: TYP.INDIRME, findKey: (kid) => lookup.get(kid) });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(DownloadSchema, j.value.payload);
  if (!b.ok) return forwardFailure(b);
  const exp = isoToMs(b.value.exp);
  if (g.nowMs > exp + CLOCK_SKEW_MS) return failure("BELGE_SURESI_DOLDU", "İndirme belirtecinin süresi doldu");
  if (exp - g.nowMs > DOWNLOAD_MAX_TTL_MS + CLOCK_SKEW_MS) {
    return failure("INDIRME_OMUR", "İndirme belirtecinin ömrü izin verilenden uzun");
  }
  return success(b.value);
}

const FORBIDDEN_PATH_PART = /(\.\.|\\|\/\/|%2e|%2f|%5c|%00)/i;

/** İstenen yol belirtecin önekinin altında mı? Kaçış dizileri ve `..` RED. */
export function isDownloadPathAllowed(doc: DownloadDoc, path: string): boolean {
  if (FORBIDDEN_PATH_PART.test(path)) return false;
  return path.startsWith(doc.yolOneki) && path.length > doc.yolOneki.length;
}
