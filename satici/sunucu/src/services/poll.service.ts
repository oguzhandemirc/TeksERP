// YOKLAMA — saatlik (ya da zil üzerine) kira yenileme. Kimlik kapısı (authenticateRequest) bekleyen taşıma
// anahtarını 409, taşınmış/iptal edilmiş anahtarı 403 ile ZATEN durdurmuştur; burada yalnız güncel anahtar.
import type { LicenseResponse, PollRequest } from "../lisans-protokol";
import type { VendorContext } from "./context";
import type { AuthenticatedRequest } from "./installation-auth";
import { renewLease } from "./renewal.service";

export async function processPoll(
  ctx: VendorContext,
  auth: AuthenticatedRequest,
  body: PollRequest,
  nowMs: number,
): Promise<LicenseResponse> {
  const { response } = await renewLease(ctx, {
    installationDbId: auth.installation.id,
    kid: auth.kid,
    presentedLeaseId: body.sonKiraId,
    measured: body.parmakIzi,
    clientEntitlement: body.hak,
    telemetry: { durum: body.durum, saat: body.saat, ortam: body.ortam, saglik: body.saglik, gozlem: body.gozlem },
    ...(body.sifrelemeAnahtari ? { encryptionKey: body.sifrelemeAnahtari } : {}),
    nowMs,
  });
  return response;
}
