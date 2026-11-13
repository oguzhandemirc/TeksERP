// =============================================================================
// Patron push cihazı — telefonun Expo belirtecini fabrikaya kaydeder/bırakır (push köprüsü P2)
// =============================================================================
// Belirteç onu yazan OTURUMLA yaşar: kayıt yalnız patron oturumundan, yalnız kendi adına; oturum iptali (çıkış,
// parola, pasif, aynı tip yeni giriş, süre dolumu) belirteci BIRAKILACAK yapar ve ham değeri siler. Satır silinmez:
// bırakma durum geçişidir, aynı belirteç yeniden gelirse satır dirilir. Bulutla eşleme istek yolunda DEĞİL, iş
// turunda (`cloud-round.service.ts`); burası yalnız yerel durumu yazar. Ham belirteç ne yanıta ne log'a girer.
// =============================================================================
import { ClientType, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { pushBridgeEligibility } from "../../cloud-sync/eligibility";
import { readPatronPushEnabled } from "../system-setting.service";
import { digestPushToken, sealPushToken } from "./token-seal";
import { LIVE_STATES, RELEASE_DATA } from "./states";
import { requestPatronPushRound } from "./wake";

/**
 * Kullanıcı başına cihaz kaydı kilidi (tavan sayımı ↔ yazım). Uzay envanteri TEK KAYNAK:
 * `helpers/period-guard.helper.ts` başlığı; anahtar `hashtext(userId)`.
 */
export const PATRON_PUSH_LOCK_NS: number = 8048;

/** Kullanıcı başına canlı belirteç tavanı; aşan EN ESKİ (son görülme) belirteçler bırakılır. */
export const MAX_PUSH_TOKENS_PER_USER = 10;

export interface PushCaller {
  readonly userId: string;
  readonly jti: string | undefined;
}

export interface RegisterInput {
  readonly token: string;
  readonly platform: "android" | "ios";
  readonly deviceName: string | null;
}

export interface RegisterResult {
  readonly kayitli: true;
  readonly durum: "BEKLIYOR" | "KAYITLI";
  /** Tavan aşıldığı için bırakılan eski belirteç sayısı. */
  readonly birakilanEski: number;
}

async function assertEnabled(): Promise<void> {
  if (!(await readPatronPushEnabled())) {
    throw AppError.conflict("Patron telefonuna anlık bildirim bu fabrikada kapalı.", { code: "PATRON_PUSH_KAPALI" });
  }
}

/** Yalnız PATRON oturumu (girişte `clientType: "patron"`) cihaz yazar; oturum çağıranın olmalı. */
async function patronSessionId(caller: PushCaller): Promise<string> {
  const session = caller.jti
    ? await prisma.session.findUnique({ where: { jti: caller.jti }, select: { id: true, userId: true, deviceType: true, revokedAt: true } })
    : null;
  if (!session || session.userId !== caller.userId || session.revokedAt !== null || session.deviceType !== ClientType.PATRON) {
    throw AppError.forbidden("Bildirim cihazı yalnız patron uygulamasından kaydedilir.", { code: "PATRON_ISTEMCI_DEGIL" });
  }
  return session.id;
}

/** Tek deneme: kilit → var olanı devral/dirilt ya da yarat → tavanı uygula. Yarış kaybı (claim 0 / P2002) fırlatır. */
async function registerOnce(caller: PushCaller, sessionId: string, input: RegisterInput, digest: string, sealed: string): Promise<RegisterResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PATRON_PUSH_LOCK_NS}::int, hashtext(${caller.userId}))`;
    const now = new Date();
    const common = { userId: caller.userId, sessionId, tokenSealed: sealed, platform: input.platform, deviceName: input.deviceName, lastSeenAt: now };
    const existing = await tx.patronPushToken.findUnique({ where: { tokenDigest: digest }, select: { id: true, cloudState: true } });
    let state: RegisterResult["durum"];
    if (existing) {
      // KAYITLI bağ bulutta kurulu kalır (bağ kurulum ↔ özettir, kişiyi tanımaz); diğer her hâl yeniden bağlanır.
      state = existing.cloudState === "KAYITLI" ? "KAYITLI" : "BEKLIYOR";
      const revive = state === "BEKLIYOR" && existing.cloudState !== "BEKLIYOR";
      const claimed = await tx.patronPushToken.updateMany({
        where: { id: existing.id, cloudState: existing.cloudState },
        data: { ...common, cloudState: state, releasedAt: null, ...(revive ? { attempts: 0, nextAttemptAt: null, lastErrorCode: null } : {}) },
      });
      if (claimed.count === 0) throw new RegisterRace();
    } else {
      state = "BEKLIYOR";
      await tx.patronPushToken.create({ data: { ...common, tokenDigest: digest, cloudState: state }, select: { id: true } });
    }
    const overflow = await tx.patronPushToken.findMany({
      where: { userId: caller.userId, cloudState: { in: [...LIVE_STATES] } },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      skip: MAX_PUSH_TOKENS_PER_USER,
      select: { id: true },
    });
    const evicted = overflow.length === 0 ? 0 : (await tx.patronPushToken.updateMany({
      where: { id: { in: overflow.map((o) => o.id) }, cloudState: { in: [...LIVE_STATES] } },
      data: RELEASE_DATA,
    })).count;
    return { kayitli: true as const, durum: state, birakilanEski: evicted };
  });
}

class RegisterRace extends Error {}

function isRace(err: unknown): boolean {
  return err instanceof RegisterRace || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002");
}

/**
 * `POST /api/bildirim/cihaz` — İDEMPOTENT: aynı belirteç tek satır. Başka kullanıcının satırındaysa SAHİPLİK DEVRİ
 * (bir cihaz tek kullanıcı). İş turu ya da eşzamanlı kayıt satırı arada değiştirirse taze okumayla yeniden denenir.
 */
export async function registerPatronPushDevice(input: RegisterInput, caller: PushCaller): Promise<RegisterResult> {
  await assertEnabled();
  const sessionId = await patronSessionId(caller);
  const digest = digestPushToken(input.token);
  const sealed = sealPushToken(input.token, digest);
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await registerOnce(caller, sessionId, input, digest, sealed);
      requestPatronPushRound();
      return result;
    } catch (err) {
      if (!isRace(err) || attempt >= 3) {
        if (isRace(err)) throw AppError.conflict("Cihaz kaydı bu sırada değişti, yeniden deneyin.", { code: "PATRON_PUSH_CAKISMA" });
        throw err;
      }
    }
  }
}

/** `DELETE /api/bildirim/cihaz` — yalnız KENDİ canlı belirtecini bırakır; başkasınınki/olmayan `false` (sızıntı yok). */
export async function releasePatronPushDevice(token: string, caller: PushCaller): Promise<{ birakildi: boolean }> {
  await assertEnabled();
  await patronSessionId(caller);
  const res = await prisma.patronPushToken.updateMany({
    where: { tokenDigest: digestPushToken(token), userId: caller.userId, cloudState: { in: [...LIVE_STATES] } },
    data: RELEASE_DATA,
  });
  if (res.count > 0) requestPatronPushRound();
  return { birakildi: res.count > 0 };
}

/** `/auth/me` `patronPush` yeteneği: bayrak açık ∧ kurulum köprüye uygun (lisans geçerli gönderici). Bilgi, kapı değil. */
export async function patronPushAvailable(): Promise<boolean> {
  return (await readPatronPushEnabled()) && pushBridgeEligibility().ok;
}
