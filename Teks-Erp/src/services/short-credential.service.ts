// =============================================================================
// KISA KİMLİKLER (hızlı PIN + QR kart) — özet atama, tembel dönüşüm, durum
// =============================================================================
// DB'de yalnız "<kid>:<HMAC>" özeti durur; anahtar halkası LICENSE_DIR'de, emaneti yedek
// alıcılarına mühürlü. Giriş doğrulaması `AuthService`te; yönetim işleri (toplu dönüşüm,
// emanet, toplu sıfırlama) `short-credential-admin.service.ts`te.
// =============================================================================

import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { getShortCredentialKeyRing, type KeyRing } from "../lib/short-credential/keyring";
import { digestCardSecret, digestQuickPin } from "../lib/short-credential/digest";
import { recipientSetSignature } from "../lib/short-credential/escrow-crypto";
import { readBackupCryptoConfig, type BackupCryptoState } from "../lib/backup-crypto";

export const PIN_RE = /^\d{6}$/;

/** Anahtar halkası yoksa yeni özet YAZILAMAZ — düz değere düşmek yerine 503. */
export function requireKeyRing(): KeyRing {
  const st = getShortCredentialKeyRing();
  if (!st.ok) {
    throw new AppError(
      `Kısa kimlik anahtarı kullanılamıyor (${st.detail}). Hızlı PIN ve kart şu an verilemez — lisans deposunu (LICENSE_DIR) kontrol edin.`,
      503,
      true,
      { code: "SHORT_CREDENTIAL_KEY_UNAVAILABLE" },
    );
  }
  return st.ring;
}

type DigestColumn = "quickPinDigest" | "cardTokenDigest";

/** Halkada OLMAYAN anahtarla yazılmış özet sayısı (başka makineden gelen DB). */
export async function countForeignDigests(column: DigestColumn, kids: readonly string[]): Promise<number> {
  const col = Prisma.raw(`"${column}"`);
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM users
     WHERE ${col} IS NOT NULL AND split_part(${col}, ':', 1) <> ALL(${[...kids]}::text[])`;
  return Number(rows[0]?.n ?? 0);
}

export async function digestsByKid(column: DigestColumn): Promise<Map<string, number>> {
  const col = Prisma.raw(`"${column}"`);
  const rows = await prisma.$queryRaw<Array<{ kid: string; n: bigint }>>`
    SELECT split_part(${col}, ':', 1) AS kid, count(*) AS n FROM users
     WHERE ${col} IS NOT NULL GROUP BY 1`;
  return new Map(rows.map((r) => [r.kid, Number(r.n)]));
}

/** Bu PIN başka bir kullanıcıda (herhangi bir halka anahtarıyla ya da düz) tanımlı mı? */
export async function isQuickPinTaken(ring: KeyRing, pin: string, excludeUserId: string | null): Promise<boolean> {
  const digests = ring.keys.map((k) => digestQuickPin(k, pin));
  const other = await prisma.user.findFirst({
    where: {
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      OR: [{ quickPinDigest: { in: digests } }, { quickPin: pin }],
    },
    select: { id: true },
  });
  return other !== null;
}

export type ShortCredentialStatus = Awaited<ReturnType<typeof ShortCredentialService.status>>;

export class ShortCredentialService {
  /**
   * Kullanıcıya hızlı PIN YAZ (özet, etkin anahtarla). `pin` verilmezse çakışmayan rastgele
   * üretilir. Düz kolon aynı ifadede NULL'lanır. Döner: atanan düz PIN (yalnız çağırana).
   */
  static async assignQuickPin(userId: string, pin: string | null): Promise<string> {
    const ring = requireKeyRing();
    const write = async (candidate: string): Promise<"ok" | "taken"> => {
      if (await isQuickPinTaken(ring, candidate, userId)) return "taken";
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { quickPinDigest: digestQuickPin(ring.active, candidate), quickPinSetAt: new Date(), quickPin: null },
        });
        return "ok";
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "taken";
        throw e;
      }
    };
    if (pin !== null) {
      if (!PIN_RE.test(pin)) throw AppError.badRequest("Hızlı PIN 6 haneli rakam olmalı");
      if ((await write(pin)) === "taken") {
        throw AppError.conflict(
          "Bu PIN başka bir kullanıcıda tanımlı — hızlı PIN benzersiz olmalı (farklı bir PIN girin veya rastgele üretin)",
        );
      }
      return pin;
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = String(randomInt(0, 1_000_000)).padStart(6, "0");
      if ((await write(candidate)) === "ok") return candidate;
    }
    throw AppError.internal("Benzersiz PIN üretilemedi — tekrar deneyin");
  }

  /** Durum: anahtar halkası, özet/düz sayıları, yabancı anahtarlar, emanet. Değer DÖNMEZ. */
  static async status() {
    const st = getShortCredentialKeyRing();
    const ringKids = st.ok ? st.ring.keys.map((k) => k.kid) : [];
    const [pinByKid, cardByKid, legacyPin, legacyCard, legacyFormat, escrowRows, crypto] = await Promise.all([
      digestsByKid("quickPinDigest"),
      digestsByKid("cardTokenDigest"),
      prisma.user.count({ where: { quickPin: { not: null } } }),
      prisma.user.count({ where: { cardToken: { not: null } } }),
      prisma.user.count({ where: { cardTokenLegacy: true, cardTokenDigest: { not: null } } }),
      prisma.shortCredentialKeyEscrow.findMany({ select: { kid: true, recipientFingerprints: true } }),
      readBackupCryptoConfig().catch(() => null),
    ]);
    const escrowKids = new Set(escrowRows.map((r) => r.kid));
    const allKids = new Set([...pinByKid.keys(), ...cardByKid.keys()]);
    const foreign = [...allKids]
      .filter((k) => !ringKids.includes(k))
      .map((kid) => ({ kid, pin: pinByKid.get(kid) ?? 0, card: cardByKid.get(kid) ?? 0, escrow: escrowKids.has(kid) }));
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    const cryptoState: BackupCryptoState | null = crypto?.state ?? null;
    const sig = crypto && crypto.state === "acik" ? recipientSetSignature(crypto.recipients) : null;
    return {
      key: st.ok
        ? { ok: true as const, activeKid: st.ring.active.kid, kids: ringKids, problem: null, detail: null }
        : { ok: false as const, activeKid: null, kids: [], problem: st.problem, detail: st.detail },
      pin: { digest: sum(pinByKid), legacyPlain: legacyPin, foreign: foreign.reduce((a, f) => a + f.pin, 0) },
      card: {
        digest: sum(cardByKid),
        legacyPlain: legacyCard,
        legacyFormat,
        foreign: foreign.reduce((a, f) => a + f.card, 0),
      },
      foreignKids: foreign,
      escrow: {
        backupCrypto: cryptoState,
        sealedKids: [...escrowKids],
        /** Halkada olup emaneti EKSİK ya da alıcı kümesi ESKİ olan anahtarlar (yeni makineye dönüşte kaybolur). */
        unsealedRingKids: ringKids.filter((k) => {
          const row = escrowRows.find((r) => r.kid === k);
          return !row || (sig !== null && row.recipientFingerprints !== sig);
        }),
      },
    };
  }

  /**
   * TEMBEL DÖNÜŞÜM — yalnız BAŞARILI girişten sonra çağrılır: o kullanıcının düz değerini
   * özete çevirip düz kolonu boşaltır. Atomik claim (`WHERE id ∧ düz = okunan`): eşzamanlı
   * iki girişten biri yazar, öteki 0 satırla no-op; arada yönetici PIN'i değiştirdiyse de 0.
   * Halka yoksa ya da çakışma varsa düz kalır (betik raporlar) — giriş ASLA bundan düşmez.
   */
  static async convertOnLogin(userId: string, kind: "pin" | "card", plain: string): Promise<boolean> {
    const st = getShortCredentialKeyRing();
    if (!st.ok) return false;
    const active = st.ring.active;
    let converted = false;
    try {
      converted = await prisma.$transaction(async (tx) => {
        const res =
          kind === "pin"
            ? await tx.user.updateMany({
                where: { id: userId, quickPin: plain },
                data: { quickPinDigest: digestQuickPin(active, plain), quickPin: null },
              })
            : await tx.user.updateMany({
                where: { id: userId, cardToken: plain },
                data: { cardTokenDigest: digestCardSecret(active, userId, plain), cardTokenLegacy: true, cardToken: null },
              });
        return res.count === 1;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
      throw e;
    }
    if (converted) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: kind === "pin" ? "USER_QUICK_PIN" : "USER_CARD_TOKEN",
        recordId: userId,
        newData: { converted: "LAZY_LOGIN", kid: active.kid },
      }).catch(() => undefined);
    }
    return converted;
  }

}

const HEALTH_TTL_MS = 60 * 1000;

let healthCache: { at: number; status: ShortCredentialStatus | null } | null = null;
let healthRefreshing = false;

/** Sağlık yükü için önbellekli durum (5 sn'lik poll DB'ye her seferinde gitmesin); `null` = ölçülemedi. */
export function shortCredentialHealthSnapshot(): {
  status: ShortCredentialStatus | null;
  stale: boolean;
} {
  const now = Date.now();
  const stale = !healthCache || now - healthCache.at > HEALTH_TTL_MS;
  if (stale && !healthRefreshing) {
    healthRefreshing = true;
    void ShortCredentialService.status()
      .then((status) => {
        healthCache = { at: Date.now(), status };
      })
      .catch(() => {
        healthCache = { at: Date.now(), status: null };
      })
      .finally(() => {
        healthRefreshing = false;
      });
  }
  return { status: healthCache?.status ?? null, stale };
}
