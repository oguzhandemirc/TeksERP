// PAKET anahtarı kökün altında (docs/design/PAKET-ANAHTARI-KOK-ALTINDA.md): paket belgeleri (bütünlük listesi ·
// sürüm bildirimi · PG künyesi) iki aileden biriyle imzalıdır — `paket-*` kid'i derlemeye gömülü çapadan,
// `pkt-*` kid'i yükte gömülü kök imzalı PAKET sertifikasıyla doğrulanır. Rust aynası
// `native/tekserp-dogrulama/src/paket_zinciri.rs` aynı sırayla aynı kodu verir (kâhin `test_paket_zinciri`).
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import { parseJws, signJws, verifyJws, type ParsedJws } from "./jws";
import {
  IsoTimeSchema,
  PROTOCOL_VERSION,
  REVOCATION_MAX_ENTRIES,
  TYP,
  UuidSchema,
  decodeDocument,
  type CertificateDoc,
  type LicenseClass,
} from "./belgeler";
import { prepareTrustAnchor, verifyCertificate } from "./anahtar-zinciri";
import { packageKeyLookup, type PackagePublicKey } from "./guncelleme-ortak";
import type { RootKey } from "./kok-anahtarlar";
import { DAY_MS, failure, forwardFailure, isoToMs, success, type ProtocolErrorCode, type Result } from "./ortak";

/** Zincirli belgenin yükünde kök imzalı PAKET sertifikası (compact JWS). */
export const PACKAGE_CERT_FIELD = "paketSertifikasi";
/** Zincirli belgenin imzalı imza anı — sertifika bu anda geçerli olmalı. */
export const PACKAGE_SIGNED_AT_FIELD = "imzaZamani";
/** KABUL kipinde sertifika bitişinden sonra yeni paketin kabul edildiği süre (kullanıcı kararı 2026-10-06). */
export const PACKAGE_ACCEPT_TOLERANCE_DAYS = 180;
export const PACKAGE_ACCEPT_TOLERANCE_MS = PACKAGE_ACCEPT_TOLERANCE_DAYS * DAY_MS;
/** Zincirli imza dosyalarının adları (eskisinin yanında; eski doğrulayıcı bunları hiç okumaz). */
export const CHAINED_INTEGRITY_FILE = "butunluk-zincir.jws";
export const CHAINED_RELEASE_POINTER_FILE = "son-zincir.json";
export const CHAINED_RELEASE_MANIFEST_FILE = "surum-zincir.json";
export const CHAINED_PG_POINTER_FILE = "pg-zincir.json";
/** Fabrikadaki PAKET iptal belgesi (`LICENSE_DIR` altında; en yüksek `sira` kazanır). */
export const PACKAGE_REVOCATION_FILE = "paket-iptal.jws";

const CHAIN_PACKAGE_KID = /^pkt-[a-z0-9-]{1,40}$/;

/**
 * Zincirli işaretçi aileleri: `son` (kanalın en yenisi, değişken, kid'siz) · `surum` (`<sürüm>/`) · `pg` (`pg/<s>-<d>/`).
 * Yeniden imza değişmez dizine YANINA yazılır: `<aile>-zincir-<kid>.json` (kid = imzalayan PAKET sertifikası).
 */
export type ChainedFamily = "son" | "surum" | "pg";
const CHAINED_FILE = /^(son|surum|pg)-zincir(?:-(pkt-[a-z0-9-]{1,40}))?\.json$/;

/** `<aile>-zincir.json` ya da `<aile>-zincir-<kid>.json`; `son` ailesi ve `pkt-*` dışı kid'e ad verilmez. */
export function chainedFileName(aile: ChainedFamily, kid: string | null = null): string {
  if (kid === null) return `${aile}-zincir.json`;
  if (aile === "son" || !isChainPackageKid(kid)) throw new Error(`chainedFileName: ${aile} ailesine ${kid} kid'li ad verilmez`);
  return `${aile}-zincir-${kid}.json`;
}

/** Dosya adı zincirli işaretçi ailesinden mi; kid'li adda kid (yalnız `surum`/`pg`). Değilse null. */
export function parseChainedFileName(ad: string): { readonly aile: ChainedFamily; readonly kid: string | null } | null {
  const m = CHAINED_FILE.exec(ad);
  if (!m) return null;
  const aile = m[1] as ChainedFamily;
  const kid = m[2] ?? null;
  return aile === "son" && kid !== null ? null : { aile, kid };
}

/** Seçime giren aday: dosya adı + kendi kuralıyla (şema, kanal) doğrulanmış belge ya da düşme nedeni. */
export interface ChainedCandidate<T> {
  readonly ad: string;
  readonly sonuc: Result<{ readonly value: T; readonly signed: PackageSigned }>;
}

export interface ChainedChoice<T> {
  readonly ad: string;
  readonly value: T;
  readonly signed: PackageSigned;
  /** Elenen adaylar (sıralı) — çağıran ekrana/duruma yazar. */
  readonly elenen: readonly { readonly ad: string; readonly code: ProtocolErrorCode; readonly message: string }[];
}

/** Aynı belge mi: imzaya bağlı alanlar (`paketImzaKid`, yeniden imzada değişen zip'in ad/boyut/özeti) dışında yük. */
function documentIdentity(payload: Record<string, unknown>): string {
  const p: Record<string, unknown> = { ...payload };
  delete p.paketImzaKid;
  const paket = p.paket;
  if (paket !== null && typeof paket === "object" && !Array.isArray(paket) && "paketId" in paket) p.paket = { paketId: (paket as Record<string, unknown>).paketId };
  return canonicalJson(p);
}

function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * ZİNCİR SEÇİMİ (Rust aynası `paket_zinciri::select_chained`; kâhin `test_zincir_secimi`): aynı dizinde kid'siz ve
 * kid'li zincirli dosyalar yan yanadır. Aday geçerliyse: belgesi doğrulandı · `pkt-*` sertifikalı · adındaki kid =
 * imzalayan · sertifikası iptalli DEĞİL (her kipte). Geçerliler aynı belgeyi anlatmalı; kazanan sertifika bitişi EN GEÇ
 * olandır. Belirsizlikte (farklı belge · en geç bitişte eşitlik) ve hiç geçerli yokken FAIL-CLOSED. Aday yoksa null
 * (eski takıma düşüş kararı çağıranın). Sıra: kid'siz önce, sonra ada göre.
 */
export function selectChainedDocument<T>(aile: ChainedFamily, adaylar: readonly ChainedCandidate<T>[]): Result<ChainedChoice<T>> | null {
  if (adaylar.length === 0) return null;
  const ordered = [...adaylar].sort((a, b) => {
    const ka = parseChainedFileName(a.ad)?.kid ?? null;
    const kb = parseChainedFileName(b.ad)?.kid ?? null;
    if ((ka === null) !== (kb === null)) return ka === null ? -1 : 1;
    return a.ad < b.ad ? -1 : a.ad > b.ad ? 1 : 0;
  });
  const rejected: { ad: string; code: ProtocolErrorCode; message: string }[] = [];
  const valid: { ad: string; value: T; signed: PackageSigned; bitis: number }[] = [];
  for (const a of ordered) {
    const n = parseChainedFileName(a.ad);
    if (!n || n.aile !== aile) {
      rejected.push({ ad: a.ad, code: "SURUM_ISARETCI", message: `${a.ad} ${aile}-zincir ailesinin adı değil` });
      continue;
    }
    if (!a.sonuc.ok) {
      rejected.push({ ad: a.ad, code: a.sonuc.code, message: a.sonuc.message });
      continue;
    }
    const { value, signed } = a.sonuc.value;
    if (signed.chain === null) {
      rejected.push({ ad: a.ad, code: "PAKET_SERTIFIKA_YOK", message: `${a.ad} kök sertifikalı pkt-* anahtarla imzalı değil (${signed.kid})` });
      continue;
    }
    if (n.kid !== null && n.kid !== signed.kid) {
      rejected.push({ ad: a.ad, code: "JWS_KID", message: `${a.ad} adındaki kid imzalayan değil (${signed.kid})` });
      continue;
    }
    if (signed.chain.revoked) {
      rejected.push({ ad: a.ad, code: "PAKET_SERTIFIKA_IPTAL", message: `${a.ad}: PAKET sertifikası ${signed.kid} iptal edilmiş` });
      continue;
    }
    valid.push({ ad: a.ad, value, signed, bitis: isoToMs(signed.chain.certificate.bitis) });
  }
  if (valid.length === 0) {
    const first = rejected[0]!;
    return failure(first.code, `zincirli dosyaların hiçbiri geçerli değil: ${rejected.map((e) => `${e.ad} (${e.code}: ${e.message})`).join(" · ")}`);
  }
  const identity = documentIdentity(valid[0]!.signed.payload);
  const mismatch = valid.find((g) => documentIdentity(g.signed.payload) !== identity);
  if (mismatch) return failure("SURUM_ISARETCI", `belirsiz: ${valid[0]!.ad} ile ${mismatch.ad} aynı belgeyi anlatmıyor — hiçbiri seçilmez`);
  const latest = Math.max(...valid.map((g) => g.bitis));
  const winners = valid.filter((g) => g.bitis === latest);
  if (winners.length !== 1) return failure("SURUM_ISARETCI", `belirsiz: ${winners.map((g) => g.ad).join(", ")} aynı sertifika bitişini taşıyor — hiçbiri seçilmez`);
  const k = winners[0]!;
  return success({ ad: k.ad, value: k.value, signed: k.signed, elenen: rejected });
}

/**
 * DAĞITIM İPTALİ (`tekserp-paketiptal`): `RevocationSchema`nın aynısı, satırı PAKET (`pkt-`) ya da ISTEMCI (`ist-`)
 * sertifikası; kendi `sira`sı. Eşleşme kid'le ya da (tekil) sertifika kimliğiyle: `ist-` satırı PAKET sertifikasına dokunmaz.
 */
export const PackageRevocationSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  iptalId: UuidSchema,
  sira: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  verilis: IsoTimeSchema,
  iptaller: z
    .array(z.object({ kid: z.string().regex(/^(?:pkt|ist)-[a-z0-9-]{1,60}$/), sertifikaId: UuidSchema, tarih: IsoTimeSchema, neden: z.string().max(200) }))
    .max(REVOCATION_MAX_ENTRIES)
    .refine((list) => new Set(list.map((e) => e.sertifikaId)).size === list.length, "İptal listesinde tekrarlı sertifika"),
});
export type PackageRevocationDoc = z.infer<typeof PackageRevocationSchema>;

/** `pkt-*`: yükte sertifika taşıması ZORUNLU aile; `paket-*` gömülü çapadan doğrulanır ve sertifika taşıyamaz. */
export function isChainPackageKid(kid: string): boolean {
  return CHAIN_PACKAGE_KID.test(kid);
}

/** KABUL: dışarıdan gelen yeni belge (iptal RED, bitiş + tolerans). YERLEŞİK: kurulu paket (iptal yalnız işaret). */
export type PackageVerifyMode = "KABUL" | "YERLESIK";

export interface VerifiedPackageRevocation {
  readonly document: PackageRevocationDoc;
  readonly rootKid: string;
}

export interface PackageTrust {
  /** Gömülü `paket-*` anahtarları (çağıranın sınıfa göre süzdüğü küme); kesimden sonra boş olabilir. */
  readonly keys: readonly PackagePublicKey[];
  readonly roots: readonly RootKey[];
  readonly mode: PackageVerifyMode;
  /** KABUL kipinde zorunlu: max(sistem saati, elde doğrulanmış kiranın verilişi). */
  readonly nowMs?: number;
  readonly revocation?: VerifiedPackageRevocation | null;
  /** `undefined` süzgeç yok · `null` sınıf bilinmiyor (zincirli belge RED) · dize sertifikanın kümesinde olmalı. */
  readonly installClass?: string | null;
}

export interface PackageChainSigner {
  readonly certificate: CertificateDoc;
  readonly rootKid: string;
  /** YERLEŞİK kipte iptal sert değildir; çağıran uyarı gösterir. */
  readonly revoked: boolean;
}

export interface PackageSigned {
  /** İmzası doğrulanmış yük; zincir alanları (`paketSertifikasi` · `imzaZamani`) ayıklanmış. */
  readonly payload: Record<string, unknown>;
  readonly kid: string;
  readonly chain: PackageChainSigner | null;
}

/** Sertifika PAKET iptal listesinde mi: kimliğiyle ya da kid'iyle (iptal ANAHTARIN iptalidir). */
export function isPackageCertificateRevoked(cert: CertificateDoc, revocation: VerifiedPackageRevocation | null | undefined): boolean {
  if (!revocation) return false;
  return revocation.document.iptaller.some((e) => e.sertifikaId === cert.sertifikaId || e.kid === cert.kid);
}

/** Gömülü çapalı (`paket-*`) belgede zincir alanı = şema ihlali; iki aile karışmaz. */
export function carriesPackageChainFields(payload: Record<string, unknown>): boolean {
  return PACKAGE_CERT_FIELD in payload || PACKAGE_SIGNED_AT_FIELD in payload;
}

function verifyChained(token: unknown, parsed: ParsedJws, typ: string, trust: PackageTrust): Result<PackageSigned> {
  const kid = parsed.header.kid;
  if (parsed.header.typ !== typ) return failure("JWS_TYP", `Beklenen belge türü ${typ}, gelen ${parsed.header.typ}`);
  const certToken = parsed.payload[PACKAGE_CERT_FIELD];
  const signedAt = parsed.payload[PACKAGE_SIGNED_AT_FIELD];
  if (typeof certToken !== "string" || typeof signedAt !== "string" || !IsoTimeSchema.safeParse(signedAt).success) {
    return failure("PAKET_SERTIFIKA_YOK", `${kid} imzalı belge PAKET sertifikası ve imza zamanı taşımıyor`);
  }
  const cert = verifyCertificate(certToken, { roots: trust.roots, usage: "PAKET", atMs: isoToMs(signedAt) });
  if (!cert.ok) return cert.code === "SERTIFIKA_ZAMAN" ? failure("PAKET_SERTIFIKA_ZAMAN", cert.message) : forwardFailure(cert);
  if (cert.value.document.kid !== kid) return failure("JWS_KID", "Belgeyi imzalayan anahtar gömülü PAKET sertifikasınınki değil");
  const j = verifyJws(token, { typ, findKey: (k) => (k === kid ? cert.value.key : undefined) });
  if (!j.ok) return forwardFailure(j);
  const revoked = isPackageCertificateRevoked(cert.value.document, trust.revocation);
  if (trust.mode === "KABUL") {
    if (revoked) return failure("PAKET_SERTIFIKA_IPTAL", `PAKET sertifikası ${kid} iptal edilmiş`);
    const now = trust.nowMs;
    if (now === undefined || !Number.isFinite(now) || now > isoToMs(cert.value.document.bitis) + PACKAGE_ACCEPT_TOLERANCE_MS) {
      return failure("PAKET_SERTIFIKA_ZAMAN", `PAKET sertifikası ${kid} bitişinden ${PACKAGE_ACCEPT_TOLERANCE_DAYS} günden fazla geçti`);
    }
  }
  const cls = trust.installClass;
  if (cls !== undefined && (cls === null || !cert.value.allowedClasses.includes(cls as LicenseClass))) {
    return failure("PAKET_SERTIFIKA_SINIF", `PAKET sertifikası ${kid} bu kurulumun sınıfına (${cls ?? "bilinmiyor"}) yetkili değil`);
  }
  const payload = { ...j.value.payload };
  delete payload[PACKAGE_CERT_FIELD];
  delete payload[PACKAGE_SIGNED_AT_FIELD];
  return success({ payload, kid, chain: { certificate: cert.value.document, rootKid: cert.value.rootKid, revoked } });
}

/**
 * Paket belgesinin imzası (şema çağıranın): `pkt-*` → zincir (sertifika kökle, imza anı penceresi, KABUL'de iptal +
 * bitiş + tolerans, sınıf) · aksi gömülü çapa (`paket-*`; sertifika alanı taşıyan belge BELGE_SEMA).
 */
export function verifyPackageSigned(token: unknown, typ: string, trust: PackageTrust): Result<PackageSigned> {
  const parsed = parseJws(token);
  if (parsed.ok && isChainPackageKid(parsed.value.header.kid)) return verifyChained(token, parsed.value, typ, trust);
  const lookup = packageKeyLookup(trust.keys);
  const j = verifyJws(token, { typ, findKey: (kid) => lookup.get(kid) });
  if (!j.ok) return forwardFailure(j);
  if (carriesPackageChainFields(j.value.payload)) return failure("BELGE_SEMA", "Gömülü çapalı paket belgesi PAKET sertifikası taşıyamaz");
  return success({ payload: j.value.payload, kid: j.value.header.kid, chain: null });
}

/** Zincirli paket belgesi imzalar: yük ÖNCE şemadan geçer, imzalanan şemanın çıktısı + iki zincir alanıdır. */
export function signChainedPackageDocument<T extends Record<string, unknown>>(g: {
  readonly typ: string;
  readonly schema: z.ZodType<T>;
  readonly payload: T;
  readonly key: { readonly kid: string; readonly privateKey: KeyObject };
  readonly certificate: string;
  readonly signedAt: string;
}): string {
  if (!isChainPackageKid(g.key.kid)) throw new Error("signChainedPackageDocument: kid pkt- ile başlamalı");
  const cert = parseJws(g.certificate);
  if (!cert.ok || cert.value.payload.kid !== g.key.kid) throw new Error("signChainedPackageDocument: sertifika bu anahtarın değil");
  const s = decodeDocument(g.schema, g.payload);
  if (!s.ok) throw new Error(`signChainedPackageDocument(${g.typ}): ${s.message}`);
  const payload = { ...s.value, [PACKAGE_CERT_FIELD]: g.certificate, [PACKAGE_SIGNED_AT_FIELD]: g.signedAt };
  return signJws({ typ: g.typ, kid: g.key.kid, payload, privateKey: g.key.privateKey });
}

/** PAKET İPTAL belgesi: yalnız çapadaki bir KÖK imzalar. */
export function verifyPackageRevocation(token: unknown, roots: readonly RootKey[]): Result<VerifiedPackageRevocation> {
  const anchor = prepareTrustAnchor(roots);
  if (!anchor.ok) return forwardFailure(anchor);
  const parsed = parseJws(token);
  if (!parsed.ok) return forwardFailure(parsed);
  if (parsed.value.header.typ !== TYP.PAKET_IPTAL) return failure("JWS_TYP", `Beklenen ${TYP.PAKET_IPTAL}, gelen ${parsed.value.header.typ}`);
  const kid = parsed.value.header.kid;
  const root = anchor.value.get(kid);
  if (!root) return failure("KOK_BILINMIYOR", `PAKET iptal belgesini imzalayan kök tanınmıyor: ${kid}`);
  const j = verifyJws(token, { typ: TYP.PAKET_IPTAL, findKey: (k) => (k === kid ? root.key : undefined) });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(PackageRevocationSchema, j.value.payload);
  return b.ok ? success({ document: b.value, rootKid: kid }) : forwardFailure(b);
}

/** Yüksek `sira` kazanır; eşit ya da düşük sıralı gelen yok sayılır. */
export function pickNewerPackageRevocation(
  current: VerifiedPackageRevocation | null,
  incoming: VerifiedPackageRevocation | null,
): VerifiedPackageRevocation | null {
  if (!incoming) return current;
  if (!current) return incoming;
  return incoming.document.sira > current.document.sira ? incoming : current;
}
