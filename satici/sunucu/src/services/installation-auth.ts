// İMZALI İSTEK KAPISI — protokol sırası (docs/design/LISANS-PROTOKOLU.md §4):
//   ① readRequestIdentity (imzasız) → kimlik varsa kurulum kaydı; etkinleştirme/taşımada açık anahtar GÖVDEDEN
//   ② verifyRequest (typ · imza · şema · taşınan kimliğin bağı · amaç · ±10 dk · gövde özeti)
//   ③ ucuz ön denetimler (çağıranda) → ④ nonce kaydı ATOMİK: (kapsam, nonce) UNIQUE; saklama = istek zamanı + 10 dk.
// Kimliksiz istek (D14) yalnız gövde anahtarlı amaçlarda (etkinleştirme: kurulumu KOD belirler; taşıma: kurulumsuz
// talep) geçer. Doğrulama yan etkisizdir: nonce ve hız sınırı ancak imza doğrulandıktan sonra sayılır, böylece
// imzasız çöp istek başkasının kurulum kotasını tüketemez.
import type { Kurulum } from "@prisma/client";
import {
  CLOCK_SKEW_MS,
  UuidSchema,
  installationKeyId,
  isoToMs,
  readRequestIdentity,
  verifyRequest,
  type RequestDoc,
  type RequestPurpose,
} from "../lisans-protokol";
import { VendorError, requestRejected } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { isUniqueViolation } from "../lib/prisma-errors";

/** Güncel · gövdeden (kayıtsız) · bekleyen taşıma · emekli (taşınmış ya da değiştirilmiş). */
export type KeyRole = "CURRENT" | "BODY" | "PENDING_TRANSFER" | "RETIRED";

export interface VerifiedRequest {
  /** Kimliksiz istekte null — kurulumu çağıran bulur (etkinleştirme: koddan) ya da hiç bağlamaz (taşıma). */
  readonly installation: Kurulum | null;
  readonly request: RequestDoc;
  readonly kid: string;
  readonly publicKeyX: string;
  readonly role: KeyRole;
}

/** Sonu gelmiş anahtar: taşınmış (emekli) anahtar ya da iptal edilmiş kurulum — kapanış kirası alabilir (K6). */
export type EndedKeyReason = "TASIMA" | "IPTAL";

export interface AuthenticatedRequest extends VerifiedRequest {
  readonly installation: Kurulum;
  /** Yalnız `allowEnded` ile doğrulanan istekte: anahtarın sonu geldi; çağıran kapanış kirası verir (403 yerine). */
  readonly ended?: EndedKeyReason;
}

export interface VerifyInput {
  readonly header: unknown;
  readonly rawBody: Buffer;
  readonly purposes: readonly RequestPurpose[];
  readonly nowMs: number;
  /** Etkinleştirme ve taşımada anahtar kayıtlı değildir: gövdedeki açık anahtar. */
  readonly keyFromBody?: string;
}

/** Nonce ve kurulum hız sınırının kapsamı: kurulumun satıcı kimliği; kurulumsuz talepte anahtar kimliği. */
export function requestScope(g: { readonly installationDbId: string | null; readonly kid: string }): string {
  return g.installationDbId ?? `kid:${g.kid}`;
}

async function isRetiredKey(installationDbId: string, kid: string): Promise<{ x: string } | null> {
  const retired = await prisma.kurulumKaydi.findFirst({
    where: { kurulumId: installationDbId, eskiAnahtarKimligi: kid },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return retired?.eskiAcikAnahtar ? { x: retired.eskiAcikAnahtar } : null;
}

/** Gövde anahtarının bu kuruluma göre rolü: güncel · emekli (taşınmış) · yeni (kayıtsız). */
export async function bodyKeyRole(installation: Kurulum, kid: string): Promise<KeyRole> {
  if (installation.anahtarKimligi === kid) return "CURRENT";
  return (await isRetiredKey(installation.id, kid)) ? "RETIRED" : "BODY";
}

async function registeredKey(installation: Kurulum, kid: string): Promise<{ x: string; role: KeyRole }> {
  if (installation.anahtarKimligi === kid && installation.acikAnahtar) return { x: installation.acikAnahtar, role: "CURRENT" };
  const pending = await prisma.tasimaTalebi.findFirst({
    where: { kurulumId: installation.id, yeniAnahtarKimligi: kid, durum: "BEKLIYOR" },
  });
  if (pending) return { x: pending.yeniAcikAnahtar, role: "PENDING_TRANSFER" };
  const retired = await isRetiredKey(installation.id, kid);
  if (retired) return { x: retired.x, role: "RETIRED" };
  throw new VendorError(401, "ISTEK_KID", "İstek bu kurulumun kayıtlı anahtarıyla imzalanmamış");
}

async function installationByLicenseId(licenseId: string): Promise<Kurulum> {
  const installation = await prisma.kurulum.findUnique({ where: { kurulumId: licenseId } });
  if (!installation || !installation.aktif) throw new VendorError(401, "KURULUM_BILINMIYOR", "Bu kurulum satıcıda kayıtlı değil");
  return installation;
}

/** ①② — yan etkisiz: kimlik + anahtar + imza. Nonce yazılmaz, hız sınırı sayılmaz. */
export async function verifySignedRequest(g: VerifyInput): Promise<VerifiedRequest> {
  if (typeof g.header !== "string" || g.header.length === 0) {
    throw new VendorError(401, "ISTEK_GECERSIZ", "İmzalı istek başlığı (X-TKL-Istek) yok");
  }
  const identity = readRequestIdentity(g.header);
  if (!identity.ok) throw requestRejected(identity.code, identity.message, g.nowMs);
  const claimedId = identity.value.installationId;
  if (claimedId !== null && !UuidSchema.safeParse(claimedId).success) {
    throw new VendorError(401, "ISTEK_GECERSIZ", "İstekteki kurulum kimliği biçimsiz");
  }
  const kid = identity.value.kid;
  const verify = (x: string): RequestDoc => {
    const verified = verifyRequest(g.header, { publicKeyX: x, body: g.rawBody, nowMs: g.nowMs, purposes: g.purposes, installationId: claimedId });
    if (!verified.ok) throw requestRejected(verified.code, verified.message, g.nowMs);
    return verified.value;
  };

  if (g.keyFromBody === undefined) {
    if (claimedId === null) throw new VendorError(401, "ISTEK_GECERSIZ", "İstek kurulum kimliği taşımıyor (yalnız etkinleştirme ve taşıma kimliksiz olabilir)");
    const installation = await installationByLicenseId(claimedId);
    const key = await registeredKey(installation, kid);
    return { installation, request: verify(key.x), kid, publicKeyX: key.x, role: key.role };
  }

  let bodyKid: string;
  try {
    bodyKid = installationKeyId(g.keyFromBody);
  } catch {
    throw new VendorError(401, "ISTEK_KID", "Gövdedeki kurulum açık anahtarı biçimsiz");
  }
  if (bodyKid !== kid) throw new VendorError(401, "ISTEK_KID", "İstek gövdedeki anahtarla imzalanmamış");
  const request = verify(g.keyFromBody);
  const installation = claimedId === null ? null : await installationByLicenseId(claimedId);
  const role = installation ? await bodyKeyRole(installation, kid) : "BODY";
  return { installation, request, kid, publicKeyX: g.keyFromBody, role };
}

/** ④ Nonce atomik kaydı: tekrar = 409 ISTEK_TEKRAR. Saklama isteğin zamanı + tolerans (en az şimdi + tolerans). */
export async function recordRequestNonce(g: { installationDbId: string | null; kid: string; request: RequestDoc; nowMs: number }): Promise<void> {
  const expiresMs = Math.max(isoToMs(g.request.zaman), g.nowMs) + CLOCK_SKEW_MS;
  try {
    await prisma.nonceDefteri.create({
      data: {
        kapsam: requestScope(g),
        kurulumId: g.installationDbId,
        nonce: g.request.nonce,
        amac: g.request.amac,
        sonKullanim: new Date(expiresMs),
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new VendorError(409, "ISTEK_TEKRAR", "Bu istek daha önce işlendi (tekrar oynatma)");
    throw err;
  }
}

export const installationCancelled = (): VendorError =>
  new VendorError(403, "KURULUM_IPTAL", "Bu kurulumun lisansı taşındı ya da iptal edildi; kira verilmez");

/**
 * Kayıtlı anahtarlı istek (yoklama · zil · çevrimdışı · DR): doğrula → ucuz ön denetimler (iptal/emekli 403,
 * bekleyen taşıma anahtarı 409, güncel olmayan anahtar 401) → kurulum hız sınırı (`limit`) → nonce.
 * Kurulum durumu imza doğrulanmadan açıklanmaz; reddedilecek istek nonce defterine yazılmaz.
 */
export async function authenticateRequest(
  g: VerifyInput & {
    readonly limit?: (scope: string) => void;
    /** Uca özgü ucuz ön denetim (yan etkisiz) — nonce'tan ÖNCE koşar. */
    readonly precheck?: (auth: AuthenticatedRequest) => Promise<void> | void;
    /** Kapanış kirasını anlayan istemcinin yoklaması: emekli anahtar / iptal kurulum 403 yerine `ended` ile geçer. */
    readonly allowEnded?: boolean;
  },
): Promise<AuthenticatedRequest> {
  if (g.keyFromBody !== undefined) throw new Error("authenticateRequest kayıtlı anahtarlı istek içindir");
  const v = await verifySignedRequest(g);
  const installation = v.installation!;
  const ended: EndedKeyReason | null = installation.durum === "IPTAL" ? "IPTAL" : v.role === "RETIRED" ? "TASIMA" : null;
  if (ended && !g.allowEnded) throw installationCancelled();
  if (!ended && v.role === "PENDING_TRANSFER") {
    throw new VendorError(409, "TASIMA_ONAYI_BEKLIYOR", "Bu makinenin taşıma talebi onay bekliyor; kurulum ek sürede çalışır");
  }
  if (!ended && v.role !== "CURRENT") throw new VendorError(401, "ISTEK_KID", "İstek bu kurulumun kayıtlı anahtarıyla imzalanmamış");
  const auth: AuthenticatedRequest = { ...v, installation, ...(ended ? { ended } : {}) };
  await g.precheck?.(auth);
  g.limit?.(requestScope({ installationDbId: installation.id, kid: v.kid }));
  await recordRequestNonce({ installationDbId: installation.id, kid: v.kid, request: v.request, nowMs: g.nowMs });
  return auth;
}
