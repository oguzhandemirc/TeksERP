// YOKLAMA — saatlik (ya da zil üzerine) kira yenileme. Kimlik kapısı (authenticateRequest) bekleyen taşıma
// anahtarını 409, taşınmış/iptal edilmiş anahtarı 403 ile ZATEN durdurmuştur — kapanış kirasını anlayan istemcide
// (`allowEnded`) bu anahtar `ended` ile gelir ve kapanış kirası alır (K6); aksi hâlde burada yalnız güncel anahtar.
// Kira verildikten SONRA (ayrı, idempotent adımlar): fabrikanın kurulum kayıtları deftere yazılır ve
// yanıta kurulumun destek güncellemeleri eklenir — ikisi de kirayı düşüremez (hata yutulur, sonraki yoklama tekrarlar).
import type { LicenseResponse, PollRequest, SupportTicketUpdate } from "../lisans-protokol";
import { prisma } from "../lib/prisma";
import { closeEndedKey } from "./closing-lease";
import type { VendorContext } from "./context";
import type { AuthenticatedRequest } from "./installation-auth";
import { recordInstallHistory } from "./install-record.service";
import { pollV2Report } from "./local-intervention";
import { renewLease } from "./renewal.service";
import { supportUpdatesFor } from "./support.service";

export async function processPoll(
  ctx: VendorContext,
  auth: AuthenticatedRequest,
  body: PollRequest,
  nowMs: number,
): Promise<LicenseResponse & { destek?: SupportTicketUpdate[] }> {
  const telemetry = { durum: body.durum, saat: body.saat, ortam: body.ortam, saglik: body.saglik, gozlem: body.gozlem };
  // K6: sonu gelmiş anahtar (kapanış kirasını anlayan istemci) kapanış kirası alır; kurulum kaydı/destek yazılmaz.
  if (auth.ended) return closeEndedKey(ctx, auth, { presentedLeaseId: body.sonKiraId, measured: body.parmakIzi, telemetry, nowMs });
  const { response } = await renewLease(ctx, {
    installationDbId: auth.installation.id,
    kid: auth.kid,
    presentedLeaseId: body.sonKiraId,
    measured: body.parmakIzi,
    clientEntitlement: body.hak,
    telemetry,
    report: pollV2Report(body),
    ...(body.sifrelemeAnahtari ? { encryptionKey: body.sifrelemeAnahtari } : {}),
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
