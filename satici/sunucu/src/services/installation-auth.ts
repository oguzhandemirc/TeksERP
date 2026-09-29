// İMZALI İSTEK KAPISI — protokol sırası (docs/design/LISANS-PROTOKOLU.md §4):
//   ① readRequestIdentity (imzasız) → kurulum kaydı; etkinleştirme/taşımada açık anahtar GÖVDEDEN
//   ② verifyRequest (typ · imza · şema · kurulum · amaç · ±10 dk · gövde özeti)
//   ③ nonce kaydı ATOMİK: (kurulumId, nonce) UNIQUE; saklama = istek zamanı + 10 dk.
// Anahtar rolü: güncel · gövdeden · bekleyen taşıma · emekli (taşınmış) — son ikisi uç tarafından
// 409/403'e çevrilir; kurulum durumu imza doğrulanmadan açıklanmaz.
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

export type KeyRole = "CURRENT" | "BODY" | "PENDING_TRANSFER" | "RETIRED";

export interface AuthenticatedRequest {
  readonly installation: Kurulum;
  readonly request: RequestDoc;
  readonly kid: string;
  readonly publicKeyX: string;
  readonly role: KeyRole;
}

export interface AuthenticateInput {
  readonly header: unknown;
  readonly rawBody: Buffer;
  readonly purposes: readonly RequestPurpose[];
  readonly nowMs: number;
  /** Etkinleştirme ve taşımada anahtar kayıtlı değildir: gövdedeki açık anahtar. */
  readonly keyFromBody?: string;
}

async function resolveKey(installation: Kurulum, kid: string, keyFromBody: string | undefined): Promise<{ x: string; role: KeyRole }> {
  if (keyFromBody !== undefined) {
    let bodyKid: string;
    try {
      bodyKid = installationKeyId(keyFromBody);
    } catch {
      throw new VendorError(401, "ISTEK_KID", "Gövdedeki kurulum açık anahtarı biçimsiz");
    }
    if (bodyKid !== kid) throw new VendorError(401, "ISTEK_KID", "İstek gövdedeki anahtarla imzalanmamış");
    return { x: keyFromBody, role: "BODY" };
  }
  if (installation.anahtarKimligi === kid && installation.acikAnahtar) return { x: installation.acikAnahtar, role: "CURRENT" };
  const pending = await prisma.tasimaTalebi.findFirst({
    where: { kurulumId: installation.id, yeniAnahtarKimligi: kid, durum: "BEKLIYOR" },
  });
  if (pending) return { x: pending.yeniAcikAnahtar, role: "PENDING_TRANSFER" };
  const retired = await prisma.kurulumKaydi.findFirst({
    where: { kurulumId: installation.id, eskiAnahtarKimligi: kid },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (retired?.eskiAcikAnahtar) return { x: retired.eskiAcikAnahtar, role: "RETIRED" };
  throw new VendorError(401, "ISTEK_KID", "İstek bu kurulumun kayıtlı anahtarıyla imzalanmamış");
}

/** Nonce atomik kaydı: tekrar = 409 ISTEK_TEKRAR. Saklama isteğin zamanı + tolerans (en az şimdi + tolerans). */
async function recordNonce(installationDbId: string, request: RequestDoc, nowMs: number): Promise<void> {
  const expiresMs = Math.max(isoToMs(request.zaman), nowMs) + CLOCK_SKEW_MS;
  try {
    await prisma.nonceDefteri.create({
      data: { kurulumId: installationDbId, nonce: request.nonce, amac: request.amac, sonKullanim: new Date(expiresMs) },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new VendorError(409, "ISTEK_TEKRAR", "Bu istek daha önce işlendi (tekrar oynatma)");
    throw err;
  }
}

export async function authenticateRequest(g: AuthenticateInput): Promise<AuthenticatedRequest> {
  if (typeof g.header !== "string" || g.header.length === 0) {
    throw new VendorError(401, "ISTEK_GECERSIZ", "İmzalı istek başlığı (X-TKL-Istek) yok");
  }
  const identity = readRequestIdentity(g.header);
  if (!identity.ok) throw requestRejected(identity.code, identity.message);
  if (!UuidSchema.safeParse(identity.value.installationId).success) {
    throw new VendorError(401, "ISTEK_GECERSIZ", "İstekteki kurulum kimliği biçimsiz");
  }
  const installation = await prisma.kurulum.findUnique({ where: { kurulumId: identity.value.installationId } });
  if (!installation || !installation.aktif) {
    throw new VendorError(401, "KURULUM_BILINMIYOR", "Bu kurulum satıcıda kayıtlı değil");
  }
  const kid = identity.value.kid;
  const key = await resolveKey(installation, kid, g.keyFromBody);
  const verified = verifyRequest(g.header, {
    publicKeyX: key.x,
    body: g.rawBody,
    nowMs: g.nowMs,
    purposes: g.purposes,
    installationId: identity.value.installationId,
  });
  if (!verified.ok) throw requestRejected(verified.code, verified.message);
  await recordNonce(installation.id, verified.value, g.nowMs);
  if (installation.durum === "IPTAL" || key.role === "RETIRED") {
    throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulumun lisansı taşındı ya da iptal edildi; kira verilmez");
  }
  return { installation, request: verified.value, kid, publicKeyX: key.x, role: key.role };
}
