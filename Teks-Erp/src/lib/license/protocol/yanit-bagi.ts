// Canlı lisans yanıtının İSTEK BAĞI (6.3c): satıcı yanıttaki kirayı, yanıtın cevapladığı isteğin nonce'una ALT imzasıyla
// bağlar; fabrika canlı alışverişte yalnız KENDİ gönderdiği nonce'la eşleşen yanıtı kabul eder (araya girip eski ya da
// başka bir yanıtı oynatmak RED). Bağ kirayı değiştirmez — aynı kirayı yeniden veren yol (tekrar · kapanış) taze bağ basar.
import type { KeyObject } from "node:crypto";
import { jwsDigest, parseJws, verifyJws } from "./jws";
import { ResponseBindingSchema, TYP, decodeDocument, signDocument, type LeaseDoc, type LicenseClass, type ResponseBindingDoc } from "./belgeler";
import { verifyCertificate, type VerifiedRevocation } from "./anahtar-zinciri";
import type { RootKey } from "./kok-anahtarlar";
import { failure, forwardFailure, isPlainObject, isoToMs, msToIso, success, type Result } from "./ortak";

/** Satıcı: kirayı (compact metin) isteğin nonce'una bağlar. İmzalayan ALT anahtar kendi sertifikasını gömer. */
export function signResponseBinding(g: {
  readonly lease: string;
  readonly nonce: string;
  readonly nowMs: number;
  readonly key: { readonly kid: string; readonly privateKey: KeyObject; readonly certificate: string };
}): string {
  const payload: ResponseBindingDoc = { v: 1, kiraOzeti: jwsDigest(g.lease), istekNonce: g.nonce, verilis: msToIso(g.nowMs), altSertifika: g.key.certificate };
  return signDocument({ typ: TYP.YANIT_BAGI, schema: ResponseBindingSchema, payload, key: { kid: g.key.kid, privateKey: g.key.privateKey } });
}

/**
 * Fabrika: bağın zinciri (kök → ALT sertifikası, imza anında geçerli, iptal edilmemiş) + imzası + bu kiraya ve bu
 * nonce'a bağı. `sinif`: kiranın bağlı olduğu HAK'ın sınıfı — bağı imzalayan ALT anahtar ona yetkili olmalı.
 */
export function verifyResponseBinding(
  token: unknown,
  roots: readonly RootKey[],
  g: { readonly lease: string; readonly nonce: string; readonly sinif: LicenseClass; readonly revocation?: VerifiedRevocation | null },
): Result<ResponseBindingDoc> {
  const parsed = parseJws(token);
  if (!parsed.ok) return forwardFailure(parsed);
  if (parsed.value.header.typ !== TYP.YANIT_BAGI) return failure("JWS_TYP", `Beklenen ${TYP.YANIT_BAGI}, gelen ${parsed.value.header.typ}`);
  const payload = parsed.value.payload;
  const certToken = isPlainObject(payload) ? payload.altSertifika : undefined;
  const issued = isPlainObject(payload) ? payload.verilis : undefined;
  if (typeof certToken !== "string" || typeof issued !== "string") return failure("BELGE_SEMA", "Yanıt bağı alt sertifika ya da veriliş zamanı taşımıyor");
  const cert = verifyCertificate(certToken, { roots, usage: "ALT", atMs: isoToMs(issued), revocation: g.revocation });
  if (!cert.ok) return forwardFailure(cert);
  const kid = parsed.value.header.kid;
  if (cert.value.document.kid !== kid) return failure("JWS_KID", "Yanıt bağını imzalayan anahtar gömülü alt sertifikanınki değil");
  const j = verifyJws(token, { typ: TYP.YANIT_BAGI, findKey: (k) => (k === kid ? cert.value.key : undefined) });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(ResponseBindingSchema, j.value.payload);
  if (!b.ok) return forwardFailure(b);
  if (!cert.value.allowedClasses.includes(g.sinif)) return failure("YANIT_BAGI_UYUSMAZ", `Yanıt bağını imzalayan alt anahtar ${g.sinif} sınıfına yetkili değil`);
  if (b.value.kiraOzeti !== jwsDigest(g.lease)) return failure("YANIT_BAGI_UYUSMAZ", "Yanıt bağı bu yanıtın kirasına bağlı değil");
  if (b.value.istekNonce !== g.nonce) return failure("YANIT_NONCE_UYUSMAZ", "Yanıt bu isteğe ait değil (başka isteğin nonce'u)");
  return success(b.value);
}

/** `BAGLI`: bağ doğrulandı · `BAGSIZ`: bağ yok ve kira bağ beyan etmiyor (bağ basmayan eski satıcı). */
export type LiveBindingOutcome = "BAGLI" | "BAGSIZ";

/**
 * Canlı alışverişin kararı (TEK yer): bağ varsa doğrulanır; yoksa kira `yanitBagli` beyan ediyorsa RED (bağ yanıttan
 * soyulmuş), etmiyorsa eski satıcı kabul edilir. Taşınmış yanıt (dosya · QR) bu karara GİRMEZ — nonce'u bekleyen yok.
 */
export function checkLiveResponseBinding(
  roots: readonly RootKey[],
  g: {
    readonly lease: LeaseDoc;
    readonly leaseToken: string;
    readonly binding: string | undefined;
    readonly nonce: string;
    readonly sinif: LicenseClass;
    readonly revocation?: VerifiedRevocation | null;
  },
): Result<LiveBindingOutcome> {
  if (g.binding === undefined) {
    return g.lease.yanitBagli === true ? failure("YANIT_BAGI_YOK", "Kira istek bağıyla teslim edilmeli ama yanıt bağ taşımıyor") : success("BAGSIZ");
  }
  const v = verifyResponseBinding(g.binding, roots, { lease: g.leaseToken, nonce: g.nonce, sinif: g.sinif, revocation: g.revocation });
  return v.ok ? success("BAGLI") : forwardFailure(v);
}
