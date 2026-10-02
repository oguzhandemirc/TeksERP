// İSTEK: fabrikadan dışarı giden her istek kurulum anahtarıyla imzalanır (kimlik + tazelik
// + gövde bütünlüğü). Başlıkta `X-TKL-Istek`, çevrimdışı yolda `zarf` içinde taşınır.
import { createHash, randomBytes, timingSafeEqual, type KeyObject } from "node:crypto";
import { publicKeyFromX, publicKeyX, parseJws, verifyJws, installationKeyId } from "./jws";
import { RequestSchema, TYP, decodeDocument, signDocument, type RequestPurpose, type RequestDoc } from "./belgeler";
import { CLOCK_SKEW_MS, b64uDecode, b64uEncode, success, isPlainObject, failure, forwardFailure, isoToMs, msToIso, type Result } from "./ortak";

export const REQUEST_HEADER = "X-TKL-Istek";

/** 128 bit rastgele, base64url (22 karakter). */
export function generateNonce(): string {
  return b64uEncode(randomBytes(16));
}

/** Gövdenin HAM baytlarının sha256'sı — sunucu ayrıştırmadan ÖNCEKİ baytları özetler. */
export function bodyDigest(body: Uint8Array | string): string {
  return b64uEncode(createHash("sha256").update(body).digest());
}

/**
 * `installationId: null` yalnız kimliği henüz bilinmeyen amaçta (etkinleştirme, taşıma) geçerlidir —
 * alan imzaya hiç girmez; başka amaçta şema reddeder (programcı hatası, fırlatır). `path` verilirse isteğin
 * gittiği uç (`ENDPOINTS`; zarfla taşınanda `/v1/cevrimdisi`) imzaya girer.
 */
export function signRequest(g: {
  readonly installationId: string | null;
  readonly purpose: RequestPurpose;
  readonly body: Uint8Array | string;
  readonly key: { readonly privateKey: KeyObject; readonly nowMs: number; readonly nonce?: string };
  readonly path?: string;
}): string {
  const kid = installationKeyId(publicKeyX(g.key.privateKey));
  const payload: RequestDoc = {
    v: 1,
    kurulumId: g.installationId ?? undefined,
    zaman: msToIso(g.key.nowMs),
    nonce: g.key.nonce ?? generateNonce(),
    amac: g.purpose,
    govdeOzeti: bodyDigest(g.body),
    ...(g.path !== undefined ? { yol: g.path } : {}),
  };
  return signDocument({ typ: TYP.ISTEK, schema: RequestSchema, payload, key: { kid, privateKey: g.key.privateKey } });
}

/**
 * İmzayı DOĞRULAMADAN kurulum kimliğini okur — sunucu açık anahtarı bununla bulur. `null` = istek
 * kimlik taşımıyor (yok · "" · null; yalnız etkinleştirme/taşımada meşru, şema denetler).
 */
export function readRequestIdentity(token: unknown): Result<{ installationId: string | null; kid: string }> {
  const parsed = parseJws(token);
  if (!parsed.ok) return forwardFailure(parsed);
  const installationId = parsed.value.payload.kurulumId;
  if (installationId !== undefined && installationId !== null && typeof installationId !== "string") {
    return failure("BELGE_SEMA", "İstek kurulum kimliği biçimsiz");
  }
  return success({ installationId: installationId || null, kid: parsed.value.header.kid });
}

function digestsEqual(a: string, b: string): boolean {
  const x = b64uDecode(a);
  const y = b64uDecode(b);
  return x !== null && y !== null && x.length === y.length && timingSafeEqual(x, y);
}

export interface RequestVerifyInput {
  /** Kurulumun kayıtlı (etkinleştirmede: gövdedeki) açık anahtarı, base64url `x`. */
  readonly publicKeyX: string;
  readonly body: Uint8Array | string;
  readonly nowMs: number;
  readonly purposes: readonly RequestPurpose[];
  /**
   * Sunucunun kurulumu bulduğu kimlik (bulamadıysa null); istek kimlik TAŞIYORSA onunla aynı olmalı. Kimlik
   * taşımayan istek (yalnız etkinleştirme/taşıma — şema denetler) bağ denetiminden muaftır: bağ koddadır.
   */
  readonly installationId: string | null;
  /**
   * İsteği alan uç (`ENDPOINTS` sabiti — vekil/bağlama farkından bağımsız). İmzalı istek `yol` taşıyorsa eşit
   * olmalı (`ISTEK_YOL`); `yol` taşımayan (eski) istek denetlenmez.
   */
  readonly path?: string;
}

/** Tekrar oynatma (nonce) denetimi BURADA DEĞİL: çağıran `NonceDefteri` ya da DB'de atomik yapar. */
export function verifyRequest(token: unknown, g: RequestVerifyInput): Result<RequestDoc> {
  const key = publicKeyFromX(g.publicKeyX);
  if (!key) return failure("ISTEK_KID", "Kurulum açık anahtarı biçimsiz");
  const kid = installationKeyId(g.publicKeyX);
  const j = verifyJws(token, { typ: TYP.ISTEK, findKey: (k) => (k === kid ? key : undefined) });
  if (!j.ok) return j.code === "JWS_KID" ? failure("ISTEK_KID", "İstek bu kurulumun anahtarıyla imzalanmamış") : forwardFailure(j);
  const b = decodeDocument(RequestSchema, j.value.payload);
  if (!b.ok) return forwardFailure(b);
  const request = b.value;
  if (request.kurulumId !== undefined && request.kurulumId !== g.installationId) {
    return failure("ISTEK_KURULUM", "İsteğin kurulum kimliği anahtarın sahibiyle uyuşmuyor");
  }
  if (!g.purposes.includes(request.amac)) return failure("ISTEK_AMAC", `Bu uç ${request.amac} amaçlı isteği kabul etmez`);
  if (request.yol !== undefined && g.path !== undefined && request.yol !== g.path) {
    return failure("ISTEK_YOL", `İstek ${request.yol} ucu için imzalanmış, ${g.path} ucuna gelmiş`);
  }
  if (Math.abs(isoToMs(request.zaman) - g.nowMs) > CLOCK_SKEW_MS) {
    return failure("ISTEK_ZAMAN", "İstek zamanı sunucu saatinden 10 dakikadan fazla sapıyor");
  }
  if (!digestsEqual(request.govdeOzeti, bodyDigest(g.body))) return failure("ISTEK_GOVDE_OZETI", "Gövde imzalı özetle uyuşmuyor");
  return success(request);
}

/**
 * Bellek içi tekrar oynatma defteri. Nonce, isteğin ZAMANI + tolerans anına dek tutulur:
 * zaman denetimi ±10 dk kabul ettiği için geçerli pencere 20 dakikadır; sabit bir
 * "görüldükten sonra N dk" süresi bu pencereden kısa kalırsa tekrar kabul edilir.
 */
export class NonceLedger {
  private readonly expiries = new Map<string, number>();

  /** İlk görülüşte `true` (kaydedildi), tekrarda `false`. */
  record(g: { readonly installationId: string; readonly nonce: string; readonly requestTimeMs: number; readonly nowMs: number }): boolean {
    this.prune(g.nowMs);
    const key = `${g.installationId}\u001f${g.nonce}`;
    if (this.expiries.has(key)) return false;
    this.expiries.set(key, Math.max(g.requestTimeMs, g.nowMs) + CLOCK_SKEW_MS);
    return true;
  }

  get size(): number {
    return this.expiries.size;
  }

  private prune(nowMs: number): void {
    for (const [key, end] of this.expiries) if (end < nowMs) this.expiries.delete(key);
  }
}

/** Çevrimdışı/aktarma zarfı: imzalı istek + ham gövde tek metinde (panel ya da QR taşır). */
export function wrapEnvelope(request: string, body: Uint8Array | string): string {
  return b64uEncode(JSON.stringify({ v: 1, istek: request, govde: b64uEncode(body) }));
}

export function openEnvelope(envelope: string): Result<{ request: string; body: Buffer }> {
  const raw = b64uDecode(envelope);
  let content: unknown;
  try {
    content = raw ? JSON.parse(raw.toString("utf8")) : undefined;
  } catch {
    content = undefined;
  }
  if (!isPlainObject(content) || content.v !== 1 || typeof content.istek !== "string" || typeof content.govde !== "string") {
    return failure("ZARF_BICIM", "Aktarma zarfı çözülemedi");
  }
  const body = b64uDecode(content.govde);
  if (!body) return failure("ZARF_BICIM", "Aktarma zarfının gövdesi çözülemedi");
  return success({ request: content.istek, body });
}

