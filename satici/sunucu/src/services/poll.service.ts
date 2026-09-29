// YOKLAMA — saatlik (ya da zil üzerine) kira yenileme. Kimlik kapısı (authenticateRequest) bekleyen taşıma
// anahtarını 409, taşınmış/iptal edilmiş anahtarı 403 ile ZATEN durdurmuştur; burada yalnız güncel anahtar.
// Kira verildikten SONRA (ayrı, idempotent adımlar): fabrikanın kurulum kayıtları deftere yazılır ve
// yanıta kurulumun destek güncellemeleri eklenir — ikisi de kirayı düşüremez (hata yutulur, sonraki yoklama tekrarlar).
import type { LicenseResponse, PollRequest, SupportTicketUpdate } from "../lisans-protokol";
import { prisma } from "../lib/prisma";
import type { VendorContext } from "./context";
import type { AuthenticatedRequest } from "./installation-auth";
import { recordInstallHistory } from "./install-record.service";
import { renewLease } from "./renewal.service";
import { supportUpdatesFor } from "./support.service";

export async function processPoll(
  ctx: VendorContext,
  auth: AuthenticatedRequest,
  body: PollRequest,
  nowMs: number,
): Promise<LicenseResponse & { destek?: SupportTicketUpdate[] }> {
  const { response } = await renewLease(ctx, {
    installationDbId: auth.installation.id,
    kid: auth.kid,
    presentedLeaseId: body.sonKiraId,
    measured: body.parmakIzi,
    clientEntitlement: body.hak,
    telemetry: { durum: body.durum, saat: body.saat, ortam: body.ortam, saglik: body.saglik, gozlem: body.gozlem },
    nowMs,
  });
  try {
    await recordInstallHistory(prisma, { installationDbId: auth.installation.id, kid: auth.kid, records: body.kurulumKayitlari });
  } catch (err) {
    console.error(`[yoklama] kurulum kaydı yazılamadı: ${err instanceof Error ? err.message : String(err)}`);
  }
  let destek: SupportTicketUpdate[] = [];
  try {
    destek = await supportUpdatesFor(prisma, auth.installation.id, nowMs);
  } catch (err) {
    console.error(`[yoklama] destek güncellemesi okunamadı: ${err instanceof Error ? err.message : String(err)}`);
  }
  return destek.length > 0 ? { ...response, destek } : response;
}
