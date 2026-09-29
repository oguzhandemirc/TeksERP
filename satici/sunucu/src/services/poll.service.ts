// YOKLAMA — saatlik (ya da zil üzerine) kira yenileme. Bekleyen taşıma anahtarı 409 alır;
// taşınmış anahtar kimlik kapısında 403 KURULUM_IPTAL almıştır.
import type { LicenseResponse, PollRequest } from "../lisans-protokol";
import { VendorError } from "../lib/errors";
import type { VendorContext } from "./context";
import type { AuthenticatedRequest } from "./installation-auth";
import { renewLease } from "./renewal.service";

export async function processPoll(
  ctx: VendorContext,
  auth: AuthenticatedRequest,
  body: PollRequest,
  nowMs: number,
): Promise<LicenseResponse> {
  if (auth.role === "PENDING_TRANSFER") {
    throw new VendorError(409, "TASIMA_ONAYI_BEKLIYOR", "Bu makinenin taşıma talebi onay bekliyor; kurulum ek sürede çalışır");
  }
  if (auth.role !== "CURRENT") throw new VendorError(401, "ISTEK_KID", "İstek bu kurulumun kayıtlı anahtarıyla imzalanmamış");
  const { response } = await renewLease(ctx, {
    installationDbId: auth.installation.id,
    kid: auth.kid,
    presentedLeaseId: body.sonKiraId,
    measured: body.parmakIzi,
    clientEntitlement: body.hak,
    telemetry: { durum: body.durum, saat: body.saat, ortam: body.ortam, saglik: body.saglik, gozlem: body.gozlem },
    nowMs,
  });
  return response;
}
