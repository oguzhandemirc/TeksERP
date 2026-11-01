// =============================================================================
// Barındırılan kurulumda parolalı girişin ikinci faktörü — KANALDAN BAĞIMSIZ (Y1, 2026-11-01)
// =============================================================================
// Sorun: `clientType` istemcinin beyanıdır; çerez kipi dışındaki (electron / mobile / boş) parola
// girişi web 2FA politikasını hiç görmüyordu → internetten erişilen VDS'te kod atlanıyordu.
// Kural (kullanıcı kararı "herkes kendi seçer"): barındırılanda Bearer parola girişi çerez yolunun
// aynı katmanlarından geçer — `auth.webTotpPolicy` + `User.webTotpOptOut` + güvenilir cihaz; ek
// olarak ONAYLI ve HMAC KANITLI saha cihazı (tablet) ikinci faktör sayılır. Süperadmin her kanalda kod.
// LAN (barındırılmayan) kurulumda bu modül hiç devreye girmez (`appliesHostedBearerRule` false).
// =============================================================================
import prisma from "../lib/prisma";
import { cookieLoginApplies } from "../lib/web-session-cookie";
import { isHostedInstallation } from "./helpers/install-class.helper";
import { webTotpWaived } from "./web-totp.service";

/** Kuralın uygulanacağı giriş: barındırılan ∧ parola ∧ çerez kipi DEĞİL (çerez yolu kendi dalında). */
export function appliesHostedBearerRule(clientType: string | undefined, via: string): boolean {
  return via === "password" && !cookieLoginApplies(clientType) && isHostedInstallation();
}

/** Masaüstü sınıfı beyanı (electron / çerezsiz web) — cihaz muafiyeti ve "hatırla" kutusu buna bakar. */
function declaresDesktop(clientType: string | undefined): boolean {
  return clientType === "electron" || clientType === "web";
}

export type HostedBearerVerdict =
  /** Politika USER_CHOICE ∧ kullanıcı kodu kapattı (sistem hesabı hariç). */
  | { kind: "WAIVED" }
  /** Onaylı + kanıtlı saha cihazından mobil giriş (sistem hesabı hariç). */
  | { kind: "APPROVED_DEVICE" }
  /** Kod (ya da masaüstünde güvenilir cihaz belirteci) gerekli. */
  | { kind: "REQUIRE"; desktop: boolean; systemAccount: boolean };

/**
 * FAIL-CLOSED: hesap okunamazsa sistem hesabı sayılır (muafiyet yok). Cihaz muafiyeti yalnız
 * middleware'in bu istekte kanıtı DOĞRULADIĞI onaylı cihaza; masaüstü beyanı muafiyet almaz.
 */
export async function decideHostedBearer(
  userId: string,
  clientType: string | undefined,
  approvedDeviceProven: boolean,
): Promise<HostedBearerVerdict> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { isSystemAccount: true } });
  const systemAccount = row ? row.isSystemAccount === true : true;
  const desktop = declaresDesktop(clientType);
  if (!systemAccount && (await webTotpWaived(userId))) return { kind: "WAIVED" };
  if (!systemAccount && !desktop && approvedDeviceProven) return { kind: "APPROVED_DEVICE" };
  return { kind: "REQUIRE", desktop, systemAccount };
}

export const HOSTED_ENROLLMENT_MESSAGE =
  "Bu sunucuya giriş için iki adımlı doğrulama kurulmalı. Yöneticinizden kurulum bağlantısı isteyin.";
