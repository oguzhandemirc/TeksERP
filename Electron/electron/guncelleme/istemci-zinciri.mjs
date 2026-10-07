// =============================================================================
// İSTEMCİ ZİNCİRİ — kök → ISTEMCI sertifikası (`ist-*`) → istemci belgesi (panel künyesi v:2) · BAĞIMLILIKSIZ
// =============================================================================
// Protokolün aynası (docs/design/ISTEMCI-ANAHTARI-KOK-ALTINDA.md §3.2–§3.4): kök çapası `anahtar-zinciri.ts
// prepareTrustAnchor`, sertifika `verifyCertificate` + `CertificateSchema`, dağıtım iptali `paket-zinciri.ts
// verifyPackageRevocation` + `isPackageCertificateRevoked` + `pickNewerPackageRevocation`, KABUL toleransı
// `PACKAGE_ACCEPT_TOLERANCE_DAYS`. Zod yok: şema denetimleri zod 4'ün regex'lerinin ve kurallarının birebir kopyası.
// Yalnız KABUL kipi vardır (kurulmuş panel yeniden doğrulanmaz). Tablet aynası YOK (karar 5, ortak tablette künye yok).
// Kâhin: `Teks-Erp/scripts/test_panel_imza.ts` §0e–§0k — aynı vektörde protokolle aynı karar (kod + ayrıntı kodu).
// =============================================================================
import { sign as edSign, verify as edVerify } from "node:crypto";
import { JWS_ALG, JWS_MAX_LENGTH, b64uEncode, fail, isPlainObject, ok, parseJws, publicKeyFromX } from "./kunye-jws.mjs";

/** Protokol `PROTOCOL_VERSION` (sertifika ve iptal belgesinin `v`si). */
const PROTOCOL_VERSION = 1;
export const CERT_TYP = "tekserp-sertifika";
/** Dağıtım iptali (PAKET + ISTEMCI satırları; protokol `TYP.PAKET_IPTAL`). */
export const DISTRIBUTION_REVOCATION_TYP = "tekserp-paketiptal";
export const CLIENT_CERT_USAGE = "ISTEMCI";
/** İmzalı yükte kök imzalı ISTEMCI sertifikası (compact JWS) ve imza anı (ISO). */
export const CLIENT_CERT_FIELD = "imzaciSertifikasi";
export const CLIENT_SIGNED_AT_FIELD = "imzaZamani";
/** Sertifika bitişinden sonra yeni belgenin kabul edildiği süre — PAKET'le AYNI sayı (tasarım §3.2). */
export const CLIENT_ACCEPT_TOLERANCE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
export const CLIENT_ACCEPT_TOLERANCE_MS = CLIENT_ACCEPT_TOLERANCE_DAYS * DAY_MS;
/** Protokol `CLOCK_SKEW_MS`: sertifika penceresi imza anında bu kadar esner. */
export const CLOCK_SKEW_MS = 10 * 60 * 1000;

export const LICENSE_CLASSES = Object.freeze(["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"]);
export const CERT_USAGES = Object.freeze(["ALT", "INDIRME", "BAYI", "HAK", "PAKET", "ISTEMCI"]);
const SUB_KID_PREFIX = Object.freeze({ ALT: "alt-", INDIRME: "ind-", BAYI: "bayi-", HAK: "ara-", PAKET: "pkt-", ISTEMCI: "ist-" });
const REVOCATION_MAX_ENTRIES = 256;

const ROOT_KID_PATTERN = /^kok-[a-z0-9-]{1,40}$/;
/** İstemci belgesini imzalayabilen TEK aile; `panel-*`/`paket-*` (gömülü çapalı v:1 aileleri) burada RED. */
const CLIENT_KID_PATTERN = /^ist-[a-z0-9-]{1,40}$/;
const CERT_KID_PATTERN = /^[a-z]+-[a-z0-9-]{1,60}$/;
const REVOCATION_ROW_KID_PATTERN = /^(?:pkt|ist)-[a-z0-9-]{1,60}$/;
const PUBLIC_KEY_X_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MODULE_KEY_PATTERN = /^[a-z][A-Za-z0-9]*([.-][A-Za-z0-9]+)*$/;
// zod 4.3 `z.uuid()` ve `z.iso.datetime()` (ofsetsiz, yalnız `Z`, saniye isteğe bağlı, sınırsız kesir) — birebir.
export const UUID_PATTERN =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
export const ISO_DATETIME_PATTERN =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$/;

/** Panelin göreceği kodlar (künye v:2'nin yenileri) — `detay` protokolün ince kodunu taşır. */
export const CLIENT_CHAIN_ERROR_CODES = Object.freeze(["SERTIFIKA_GECERSIZ", "SERTIFIKA_SURESI", "SERTIFIKA_IPTAL"]);

const isString = (v) => typeof v === "string";
const isUuid = (v) => isString(v) && UUID_PATTERN.test(v);
export const isIsoTime = (v) => isString(v) && ISO_DATETIME_PATTERN.test(v);
const isUnique = (list) => new Set(list).size === list.length;
const chainFail = (code, detay, message) => ({ ok: false, code, detay, message });

/** `ist-*`: kök imzalı ISTEMCI sertifikasını yükte taşıması ZORUNLU tek imzacı ailesi. */
export function isClientKid(kid) {
  return isString(kid) && CLIENT_KID_PATTERN.test(kid);
}

/** `kok-*`: kök çapasının kimlik biçimi (protokol `anahtar-zinciri.ts` ROOT_KID_PATTERN). */
export function isRootKid(kid) {
  return isString(kid) && ROOT_KID_PATTERN.test(kid);
}

/** Kök çapası (protokol `prepareTrustAnchor`): boş → GUVEN_CAPASI_BOS; `kok-` dışı/tekrarlı kid, biçimsiz anahtar ya da sınıf → BICIM. */
export function prepareRootAnchor(roots) {
  if (!Array.isArray(roots) || roots.length === 0) return fail("GUVEN_CAPASI_BOS", "Güven çapası boş: bu derlemede kök açık anahtarı yok");
  const lookup = new Map();
  for (const root of roots) {
    const kid = isPlainObject(root) ? root.kid : undefined;
    if (!isString(kid) || !ROOT_KID_PATTERN.test(kid) || lookup.has(kid)) {
      return fail("GUVEN_CAPASI_BICIM", `Kök kimliği biçimsiz ya da tekrarlı: ${String(kid)}`);
    }
    const key = isString(root.x) ? publicKeyFromX(root.x) : null;
    if (!key) return fail("GUVEN_CAPASI_BICIM", `Kök açık anahtarı biçimsiz: ${kid}`);
    const classes = root.classes;
    if (!Array.isArray(classes) || classes.length === 0 || classes.some((s) => !LICENSE_CLASSES.includes(s))) {
      return fail("GUVEN_CAPASI_BICIM", `Kökün sınıf listesi geçersiz: ${kid}`);
    }
    lookup.set(kid, { key, classes: Object.freeze([...classes]) });
  }
  return ok(lookup);
}

function verifyWithKey(token, typ, key) {
  const parsed = parseJws(token);
  if (!parsed.ok) return parsed;
  const { header, signingInput, signature } = parsed.value;
  if (header.typ !== typ) return fail("JWS_TYP", `Beklenen belge türü ${typ}, gelen ${header.typ}`);
  if (!key || key.type !== "public" || key.asymmetricKeyType !== "ed25519") return fail("JWS_KID", `Bilinmeyen anahtar kimliği: ${header.kid}`);
  let valid = false;
  try {
    valid = edVerify(null, signingInput, key, signature);
  } catch {
    valid = false;
  }
  return valid ? parsed : fail("JWS_IMZA", "İmza doğrulanamadı");
}

/** Protokol `decodeDocument`: bilinmeyen `v` şema hatasından ayrı kodlanır (yükseltme sinyali). */
function versionGate(payload) {
  return "v" in payload && payload.v !== PROTOCOL_VERSION ? fail("BELGE_SURUM", `Desteklenmeyen protokol sürümü: ${String(payload.v)}`) : null;
}

function isModuleList(list) {
  return Array.isArray(list) && list.length <= 64 && list.every((m) => isString(m) && m.length <= 64 && MODULE_KEY_PATTERN.test(m)) && isUnique(list);
}

/** Protokol `CertificateSchema` (tanınmayan alan sessizce düşer; dönen nesne yalnız bilinen alanlar). */
export function decodeCertificate(payload) {
  const gate = versionGate(payload);
  if (gate) return gate;
  const p = payload;
  const bad = [];
  if (p.v !== PROTOCOL_VERSION) bad.push("v");
  if (!isUuid(p.sertifikaId)) bad.push("sertifikaId");
  if (!CERT_USAGES.includes(p.kullanim)) bad.push("kullanim");
  if (!isString(p.kid) || !CERT_KID_PATTERN.test(p.kid)) bad.push("kid");
  if (!isString(p.x) || !PUBLIC_KEY_X_PATTERN.test(p.x)) bad.push("x");
  if (!Array.isArray(p.siniflar) || p.siniflar.length === 0 || !p.siniflar.every((s) => LICENSE_CLASSES.includes(s)) || !isUnique(p.siniflar)) bad.push("siniflar");
  if (!isIsoTime(p.baslangic)) bad.push("baslangic");
  if (!isIsoTime(p.bitis)) bad.push("bitis");
  const bayi = p.bayi;
  if (!(bayi === null || (isPlainObject(bayi) && isUuid(bayi.bayiId) && isModuleList(bayi.moduller)))) bad.push("bayi");
  if (bad.length) return fail("BELGE_SEMA", `Sertifika şemaya uymuyor: ${bad.join(", ")}`);
  if (!(Date.parse(p.bitis) > Date.parse(p.baslangic))) return fail("BELGE_SEMA", "Sertifika bitişi başlangıçtan sonra olmalı");
  if (!p.kid.startsWith(SUB_KID_PREFIX[p.kullanim])) return fail("BELGE_SEMA", "kid öneki kullanımla uyuşmuyor");
  if ((p.kullanim === "BAYI") !== (bayi !== null)) return fail("BELGE_SEMA", "Bayi tavanı yalnız BAYI sertifikasında");
  return ok({
    v: PROTOCOL_VERSION,
    sertifikaId: p.sertifikaId,
    kullanim: p.kullanim,
    kid: p.kid,
    x: p.x,
    siniflar: [...p.siniflar],
    baslangic: p.baslangic,
    bitis: p.bitis,
    bayi: bayi === null ? null : { bayiId: bayi.bayiId, moduller: [...bayi.moduller] },
  });
}

/**
 * Sertifika (protokol `verifyCertificate`, iptal argümansız — dağıtım iptali ayrıca bakılır): çapa → kök tanınıyor →
 * kök imzası → şema → kullanım → sınıflar kökün alt kümesi → `atMs` (imza anı) ± saat payı pencerede → açık anahtar.
 */
export function verifyCertificate(token, { roots, usage, atMs }) {
  const anchor = prepareRootAnchor(roots);
  if (!anchor.ok) return anchor;
  const parsed = parseJws(token);
  if (!parsed.ok) return parsed;
  const rootKid = parsed.value.header.kid;
  const root = anchor.value.get(rootKid);
  if (!root) return fail("KOK_BILINMIYOR", `Sertifikayı imzalayan kök tanınmıyor: ${rootKid}`);
  const j = verifyWithKey(token, CERT_TYP, root.key);
  if (!j.ok) return j;
  const b = decodeCertificate(j.value.payload);
  if (!b.ok) return b;
  const s = b.value;
  if (s.kullanim !== usage) return fail("SERTIFIKA_KULLANIM", `Beklenen ${usage} sertifikası, gelen ${s.kullanim}`);
  if (s.siniflar.some((x) => !root.classes.includes(x))) return fail("KOK_SINIF_YETKISIZ", `Kök ${rootKid} sertifikaya yetkisi olmayan sınıf vermiş`);
  if (!Number.isFinite(atMs) || atMs < Date.parse(s.baslangic) - CLOCK_SKEW_MS || atMs > Date.parse(s.bitis) + CLOCK_SKEW_MS) {
    return fail("SERTIFIKA_ZAMAN", `Sertifika ${s.kid} imza anında geçerli değildi`);
  }
  const key = publicKeyFromX(s.x);
  if (!key) return fail("BELGE_SEMA", "Sertifikadaki açık anahtar biçimsiz");
  return ok({ document: s, rootKid, allowedClasses: s.siniflar, key });
}

/** Protokol `PackageRevocationSchema` — satır `pkt-*` ya da `ist-*`, sertifika kimliği tekil. */
export function decodeDistributionRevocation(payload) {
  const gate = versionGate(payload);
  if (gate) return gate;
  const p = payload;
  const bad = [];
  if (p.v !== PROTOCOL_VERSION) bad.push("v");
  if (!isUuid(p.iptalId)) bad.push("iptalId");
  if (!Number.isSafeInteger(p.sira) || p.sira < 1) bad.push("sira");
  if (!isIsoTime(p.verilis)) bad.push("verilis");
  const rows = p.iptaller;
  const rowOk = (e) =>
    isPlainObject(e) &&
    isString(e.kid) &&
    REVOCATION_ROW_KID_PATTERN.test(e.kid) &&
    isUuid(e.sertifikaId) &&
    isIsoTime(e.tarih) &&
    isString(e.neden) &&
    e.neden.length <= 200;
  if (!Array.isArray(rows) || rows.length > REVOCATION_MAX_ENTRIES || !rows.every(rowOk)) bad.push("iptaller");
  else if (!isUnique(rows.map((e) => e.sertifikaId))) bad.push("iptaller (tekrarlı sertifika)");
  if (bad.length) return fail("BELGE_SEMA", `Dağıtım iptali şemaya uymuyor: ${bad.join(", ")}`);
  return ok({
    v: PROTOCOL_VERSION,
    iptalId: p.iptalId,
    sira: p.sira,
    verilis: p.verilis,
    iptaller: rows.map((e) => ({ kid: e.kid, sertifikaId: e.sertifikaId, tarih: e.tarih, neden: e.neden })),
  });
}

/** Dağıtım iptali (protokol `verifyPackageRevocation`): yalnız çapadaki bir KÖK imzalar. */
export function verifyDistributionRevocation(token, roots) {
  const anchor = prepareRootAnchor(roots);
  if (!anchor.ok) return anchor;
  const parsed = parseJws(token);
  if (!parsed.ok) return parsed;
  if (parsed.value.header.typ !== DISTRIBUTION_REVOCATION_TYP) {
    return fail("JWS_TYP", `Beklenen ${DISTRIBUTION_REVOCATION_TYP}, gelen ${parsed.value.header.typ}`);
  }
  const kid = parsed.value.header.kid;
  const root = anchor.value.get(kid);
  if (!root) return fail("KOK_BILINMIYOR", `Dağıtım iptalini imzalayan kök tanınmıyor: ${kid}`);
  const j = verifyWithKey(token, DISTRIBUTION_REVOCATION_TYP, root.key);
  if (!j.ok) return j;
  const b = decodeDistributionRevocation(j.value.payload);
  return b.ok ? ok({ document: b.value, rootKid: kid }) : b;
}

/** Sertifika iptalde mi: kid'iyle ya da tekil sertifika kimliğiyle (iptal ANAHTARIN iptalidir). */
export function isClientCertificateRevoked(cert, revocation) {
  if (!revocation) return false;
  return revocation.document.iptaller.some((e) => e.sertifikaId === cert.sertifikaId || e.kid === cert.kid);
}

/** Yüksek `sira` kazanır; eşit ya da düşük sıralı gelen yok sayılır (yerelde saklanan geri alınamaz, çırpınmaz). */
export function pickNewerRevocation(current, incoming) {
  if (!incoming) return current;
  if (!current) return incoming;
  return incoming.document.sira > current.document.sira ? incoming : current;
}

/**
 * İptal birleştirme (tasarım §3.4): adaylar sırayla — önce yerelde saklanan, sonra belirteç yanıtı ve künye bloğu.
 * Doğrulanamayan aday yok sayılır (PAKET güncelleyicisi gibi) ve `reddedilen`de kaynağıyla döner; en yüksek `sira`
 * kazanır, eşitlikte önce gelen kalır. `degisti`: kazanan yerel kaynaktan değilse çağıran onu saklar.
 */
export function mergeRevocations(roots, candidates) {
  let best = null;
  let bestToken = null;
  let bestSource = null;
  const reddedilen = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!isPlainObject(c) || c.token === undefined || c.token === null) continue;
    const v = verifyDistributionRevocation(c.token, roots);
    if (!v.ok) {
      reddedilen.push({ kaynak: c.kaynak, code: v.code, message: v.message });
      continue;
    }
    if (pickNewerRevocation(best, v.value) !== best) {
      best = v.value;
      bestToken = c.token;
      bestSource = c.kaynak;
    }
  }
  return { revocation: best, token: bestToken, kaynak: bestSource, reddedilen };
}

const CERT_FAILURE_TO_CLIENT = Object.freeze({ SERTIFIKA_ZAMAN: "SERTIFIKA_SURESI" });

/**
 * İstemci belgesi (KABUL kipi; tasarım §3.2 sırası): kök çapası → JWS biçimi → typ → imzacı `ist-*` → sertifika
 * (kök tanınıyor · ISTEMCI · şema · imza anında pencere) → imzalayan = sertifikanın kid'i → imza (sertifikadaki
 * anahtarla) → zaman: `şimdi ≤ bitiş + 180 gün` → iptal. Şema/kanal/sürüm bağı çağıranın (künye v:2).
 * Ret `{ok:false, code, detay, message}`: `code` panelin kodu, `detay` protokolün ince kodu.
 */
export function verifyClientSigned(token, { typ, roots, nowMs, revocation }) {
  const anchor = prepareRootAnchor(roots);
  if (!anchor.ok) return chainFail(anchor.code === "GUVEN_CAPASI_BOS" ? "CAPA_BOS" : "CAPA_GECERSIZ", anchor.code, anchor.message);
  const parsed = parseJws(token);
  if (!parsed.ok) return chainFail(parsed.code, parsed.code, parsed.message);
  const { header, payload } = parsed.value;
  if (header.typ !== typ) return chainFail("JWS_TYP", "JWS_TYP", `Beklenen belge türü ${typ}, gelen ${header.typ}`);
  if (!isClientKid(header.kid)) return chainFail("JWS_KID", "JWS_KID", `İstemci belgesini yalnız ist-* sertifikalı anahtar imzalar, gelen ${header.kid}`);
  const certToken = payload[CLIENT_CERT_FIELD];
  const signedAt = payload[CLIENT_SIGNED_AT_FIELD];
  if (!isString(certToken) || !isIsoTime(signedAt)) {
    return chainFail("SERTIFIKA_GECERSIZ", "SERTIFIKA_YOK", `${header.kid} imzalı belge ISTEMCI sertifikası ve imza zamanı taşımıyor`);
  }
  const cert = verifyCertificate(certToken, { roots, usage: CLIENT_CERT_USAGE, atMs: Date.parse(signedAt) });
  if (!cert.ok) return chainFail(CERT_FAILURE_TO_CLIENT[cert.code] ?? "SERTIFIKA_GECERSIZ", cert.code, cert.message);
  const c = cert.value.document;
  if (c.kid !== header.kid) return chainFail("JWS_KID", "JWS_KID", "Belgeyi imzalayan anahtar gömülü ISTEMCI sertifikasınınki değil");
  const j = verifyWithKey(token, typ, cert.value.key);
  if (!j.ok) return chainFail(j.code, j.code, j.message);
  if (nowMs === undefined || !Number.isFinite(nowMs) || nowMs > Date.parse(c.bitis) + CLIENT_ACCEPT_TOLERANCE_MS) {
    return chainFail("SERTIFIKA_SURESI", "TOLERANS", `ISTEMCI sertifikası ${c.kid} bitişinden ${CLIENT_ACCEPT_TOLERANCE_DAYS} günden fazla geçti`);
  }
  if (isClientCertificateRevoked(c, revocation)) return chainFail("SERTIFIKA_IPTAL", "SERTIFIKA_IPTAL", `ISTEMCI sertifikası ${c.kid} iptal edilmiş`);
  return ok({ payload, kid: header.kid, signedAt, certificate: c, rootKid: cert.value.rootKid });
}

// ── İmza tarafı (yayın makinesi) — panelde çağrılmaz ─────────────────────────
/** Zincirli istemci belgesini imzalar (protokol `signJws` ile bayt-eşit): yük + sertifika + imza anı. */
export function signClientDocument({ typ, kid, payload, privateKey, certificate, signedAt }) {
  if (!privateKey || privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("signClientDocument: yalnız Ed25519 özel anahtarı kabul edilir");
  }
  if (!isClientKid(kid) || !/^tekserp-[a-z]+$/.test(typ)) throw new Error(`signClientDocument: typ ya da kid uygun değil (${typ} · ${kid})`);
  const cert = parseJws(certificate);
  if (!cert.ok || cert.value.payload.kid !== kid) throw new Error("signClientDocument: sertifika bu anahtarın değil");
  if (!isIsoTime(signedAt)) throw new Error("signClientDocument: imza zamanı ISO değil");
  const body = { ...payload, [CLIENT_CERT_FIELD]: certificate, [CLIENT_SIGNED_AT_FIELD]: signedAt };
  const signingInput = `${b64uEncode(JSON.stringify({ alg: JWS_ALG, typ, kid }))}.${b64uEncode(JSON.stringify(body))}`;
  const token = `${signingInput}.${b64uEncode(edSign(null, Buffer.from(signingInput, "ascii"), privateKey))}`;
  if (token.length > JWS_MAX_LENGTH) throw new Error("signClientDocument: belge azami uzunluğu aşıyor");
  return token;
}
