// TOTP sırrı geçişi: düz (base32) saklanan sırları BİR KEZ `enc1:` sarmalına çevirir. Sarılı satırlara
// dokunmaz (idempotent); claim `WHERE totpSecret = düz` ile atomiktir — arada değişen satır atlanır,
// sonraki açılış yeniden dener. Mühür özeti AÇIK sırdan doğduğu için sarma mührü DEĞİŞTİRMEZ.
import prisma from "../lib/prisma";
import { getShortCredentialKeyRing } from "../lib/short-credential/keyring";
import { TOTP_SECRET_ENC_PREFIX } from "../lib/short-credential/totp-crypto";
import { storeTotpSecret } from "../services/helpers/totp-state.helper";
import { AuditService } from "../services/audit.service";
import { bilgi, uyari } from "../lib/logger";
import { reportJobFailure } from "./job-failure";

const STARTUP_DELAY_MS = 6 * 1000;

export interface TotpSecretWrapResult {
  readonly durum: "ANAHTAR_YOK" | "TAMAM";
  readonly kullanici: number;
  readonly pencere: number;
  readonly atlanan: number;
}

/** Düz sırları sarar; her satır kendi claim'iyle. Halka yoksa hiçbir şey yazmaz (düz kalır, uyarı). */
export async function wrapPlainTotpSecrets(): Promise<TotpSecretWrapResult> {
  if (!getShortCredentialKeyRing().ok) return { durum: "ANAHTAR_YOK", kullanici: 0, pencere: 0, atlanan: 0 };
  const users = await prisma.user.findMany({
    where: { totpSecret: { not: null }, NOT: { totpSecret: { startsWith: TOTP_SECRET_ENC_PREFIX } } },
    select: { id: true, totpSecret: true },
  });
  let kullanici = 0;
  let atlanan = 0;
  for (const u of users) {
    if (!u.totpSecret) continue;
    const res = await prisma.user.updateMany({
      where: { id: u.id, totpSecret: u.totpSecret },
      data: { totpSecret: storeTotpSecret(u.totpSecret) },
    });
    if (res.count === 1) kullanici++;
    else atlanan++;
  }
  const windows = await prisma.totpEnrollment.findMany({
    where: { NOT: { secret: { startsWith: TOTP_SECRET_ENC_PREFIX } } },
    select: { id: true, secret: true },
  });
  let pencere = 0;
  for (const w of windows) {
    const res = await prisma.totpEnrollment.updateMany({
      where: { id: w.id, secret: w.secret },
      data: { secret: storeTotpSecret(w.secret) },
    });
    if (res.count === 1) pencere++;
    else atlanan++;
  }
  if (kullanici + pencere > 0) {
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "TOTP_SECRET_WRAPPED",
      tableName: "users",
      payload: { kullanici, pencere, atlanan },
    }).catch(() => undefined);
  }
  return { durum: "TAMAM", kullanici, pencere, atlanan };
}

export function startTotpSecretJob(): void {
  setTimeout(() => {
    void wrapPlainTotpSecrets()
      .then((r) => {
        if (r.durum === "ANAHTAR_YOK") uyari("totp", "kısa kimlik anahtar halkası yok — düz TOTP sırları sarılamadı; sonraki açılışta yeniden denenir.");
        else if (r.kullanici + r.pencere > 0) bilgi("totp", `${r.kullanici} kullanıcı + ${r.pencere} pencere TOTP sırrı sarıldı (${r.atlanan} atlandı).`);
      })
      .catch((e) => reportJobFailure("totp-secret", e));
  }, STARTUP_DELAY_MS).unref();
}
