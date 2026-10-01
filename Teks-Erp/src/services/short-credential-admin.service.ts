// Kısa kimlik YÖNETİM işleri: toplu dönüşüm, anahtar emaneti (mühürle / geri koy), toplu PIN
// sıfırlama. Giriş sıcak yolundan ayrı tutulur; DB'ye yalnız özet ve mühürlü anahtar yazar.
import type { KeyObject } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { addKeyToRing, getShortCredentialKeyRing, kidOf } from "../lib/short-credential/keyring";
import { digestCardSecret, digestQuickPin } from "../lib/short-credential/digest";
import { openSealedKey, recipientSetSignature, sealKey } from "../lib/short-credential/escrow-crypto";
import { readBackupCryptoConfig, type BackupCryptoState } from "../lib/backup-crypto";
import { rememberIssuedPin } from "./helpers/credential-reveal.helper";
import { digestsByKid, requireKeyRing, ShortCredentialService } from "./short-credential.service";

const BULK_RESET_MAX = 500;

export class ShortCredentialAdminService {
  // ── Dönüşüm (düz → özet) ────────────────────────────────────────────────────

  /** Dönüşüm önizlemesi — etkilenen HER kullanıcı (değer DÖNMEZ). */
  static async previewConversion() {
    const rows = await prisma.user.findMany({
      where: { OR: [{ quickPin: { not: null } }, { cardToken: { not: null } }] },
      select: { id: true, username: true, fullName: true, isActive: true, quickPin: true, cardToken: true },
      orderBy: { username: "asc" },
    });
    return rows.map((r) => ({
      userId: r.id,
      username: r.username,
      fullName: r.fullName,
      isActive: r.isActive,
      pin: r.quickPin !== null,
      card: r.cardToken !== null,
    }));
  }

  /**
   * Düz PIN/kartları özete çevirir — idempotent (ikinci koşum 0). Satır başı ATOMİK claim:
   * yalnız düz değer hâlâ aynıysa yazılır; arada değişen satır atlanır (sayılır).
   */
  static async applyConversion(actorUserId?: string) {
    const ring = requireKeyRing();
    const rows = await prisma.user.findMany({
      where: { OR: [{ quickPin: { not: null } }, { cardToken: { not: null } }] },
      select: { id: true, quickPin: true, cardToken: true },
    });
    let pin = 0;
    let card = 0;
    const skipped: Array<{ userId: string; reason: string }> = [];
    for (const r of rows) {
      if (r.quickPin !== null) {
        try {
          const res = await prisma.user.updateMany({
            where: { id: r.id, quickPin: r.quickPin },
            data: { quickPinDigest: digestQuickPin(ring.active, r.quickPin), quickPin: null },
          });
          if (res.count === 1) pin++;
          else skipped.push({ userId: r.id, reason: "PIN_ARADA_DEGISTI" });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            skipped.push({ userId: r.id, reason: "PIN_CAKISMA" });
          } else throw e;
        }
      }
      if (r.cardToken !== null) {
        const res = await prisma.user.updateMany({
          where: { id: r.id, cardToken: r.cardToken },
          data: {
            cardTokenDigest: digestCardSecret(ring.active, r.id, r.cardToken),
            cardTokenLegacy: true,
            cardToken: null,
          },
        });
        if (res.count === 1) card++;
        else skipped.push({ userId: r.id, reason: "KART_ARADA_DEGISTI" });
      }
    }
    const remaining = {
      pin: await prisma.user.count({ where: { quickPin: { not: null } } }),
      card: await prisma.user.count({ where: { cardToken: { not: null } } }),
    };
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "SHORT_CREDENTIAL_CONVERTED",
      userId: actorUserId ?? null,
      payload: { pin, card, skipped, remaining, kid: ring.active.kid },
    }).catch(() => undefined);
    return { pin, card, skipped, remaining, kid: ring.active.kid };
  }

  // ── Anahtar emaneti ─────────────────────────────────────────────────────────

  /**
   * Halkadaki her anahtarı yedek alıcılarına mühürler (eksik ya da alıcı kümesi değişmişse).
   * Yedek şifrelemesi kapalıysa hiçbir şey yazmaz — durum döner, sağlık uyarır.
   */
  static async syncEscrow(): Promise<{ state: BackupCryptoState | "anahtar-yok"; sealed: string[]; current: string[] }> {
    const st = getShortCredentialKeyRing();
    if (!st.ok) return { state: "anahtar-yok", sealed: [], current: [] };
    const cfg = await readBackupCryptoConfig();
    if (cfg.state !== "acik") return { state: cfg.state, sealed: [], current: [] };
    const sig = recipientSetSignature(cfg.recipients);
    const sealed: string[] = [];
    const current: string[] = [];
    for (const k of st.ring.keys) {
      const row = await prisma.shortCredentialKeyEscrow.findUnique({
        where: { kid: k.kid },
        select: { recipientFingerprints: true },
      });
      if (row?.recipientFingerprints === sig) {
        current.push(k.kid);
        continue;
      }
      const blob = await sealKey(k.key, cfg.recipients);
      await prisma.shortCredentialKeyEscrow.upsert({
        where: { kid: k.kid },
        create: { kid: k.kid, sealed: blob, recipientFingerprints: sig },
        update: { sealed: blob, recipientFingerprints: sig },
      });
      sealed.push(k.kid);
    }
    if (sealed.length > 0) {
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "SHORT_CREDENTIAL_ESCROW_SEALED",
        payload: { kids: sealed, recipients: cfg.recipients.map((r) => r.ad) },
      }).catch(() => undefined);
    }
    return { state: "acik", sealed, current };
  }

  /**
   * Özetlerde kullanılan ama halkada OLMAYAN anahtarları emanetten açıp halkaya EKLER.
   * `identities`: yerel anahtar (yedek parolasıyla açılmış) ya da kâğıt müşteri/satıcı anahtarı.
   */
  static async restoreKeysFromEscrow(identities: KeyObject[], actorUserId?: string | null) {
    const ring = requireKeyRing();
    const ringKids = ring.keys.map((k) => k.kid);
    const [pinByKid, cardByKid] = await Promise.all([digestsByKid("quickPinDigest"), digestsByKid("cardTokenDigest")]);
    const needed = [...new Set([...pinByKid.keys(), ...cardByKid.keys()])].filter((k) => !ringKids.includes(k));
    const rows = needed.length
      ? await prisma.shortCredentialKeyEscrow.findMany({ where: { kid: { in: needed } }, select: { kid: true, sealed: true } })
      : [];
    const restored: string[] = [];
    const failed: string[] = [];
    for (const row of rows) {
      try {
        const key = await openSealedKey(row.sealed, identities);
        if (kidOf(key) !== row.kid) {
          failed.push(row.kid);
          continue;
        }
        addKeyToRing(key, "EMANETTEN");
        key.fill(0);
        restored.push(row.kid);
      } catch {
        failed.push(row.kid);
      }
    }
    const notEscrowed = needed.filter((k) => !rows.some((r) => r.kid === k));
    if (restored.length > 0 || failed.length > 0) {
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "SHORT_CREDENTIAL_KEY_RESTORED",
        userId: actorUserId ?? null,
        payload: { restored, failed, notEscrowed },
      }).catch(() => undefined);
    }
    // Geri konan anahtar bu makinenin alıcılarıyla da mühürlensin (bir sonraki taşımaya hazır).
    if (restored.length > 0) await ShortCredentialAdminService.syncEscrow().catch(() => undefined);
    return { needed, restored, failed, notEscrowed };
  }

  // ── Toplu hızlı PIN sıfırlama ───────────────────────────────────────────────

  /**
   * Önizleme: `uyusmayan` = özeti halkada olmayan anahtarla yazılmış (doğrulanamayan) PIN'ler;
   * `tumu` = PIN'i olan her aktif kullanıcı. Kart uyuşmazlıkları bilgi olarak döner (tek tek basılır).
   */
  static async bulkResetPreview(scope: "uyusmayan" | "tumu") {
    const ring = requireKeyRing();
    const ringKids = ring.keys.map((k) => k.kid);
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        isSystemAccount: false,
        OR: [
          { quickPinDigest: { not: null } },
          { quickPin: { not: null } },
          { cardTokenDigest: { not: null } },
        ],
      },
      select: {
        id: true, username: true, fullName: true,
        quickPinDigest: true, quickPin: true, quickPinSetAt: true,
        cardTokenDigest: true, cardIssuedAt: true,
      },
      orderBy: { fullName: "asc" },
    });
    const foreign = (d: string | null) => d !== null && !ringKids.includes(d.split(":")[0]!);
    const pins = users
      .filter((u) => u.quickPinDigest !== null || u.quickPin !== null)
      .map((u) => ({
        userId: u.id,
        username: u.username,
        fullName: u.fullName,
        reason: foreign(u.quickPinDigest) ? "ANAHTAR_UYUSMUYOR" : u.quickPin !== null ? "DUZ_METIN" : "GECERLI",
        setAt: u.quickPinSetAt,
      }))
      .filter((r) => scope === "tumu" || r.reason === "ANAHTAR_UYUSMUYOR");
    const cards = users
      .filter((u) => foreign(u.cardTokenDigest))
      .map((u) => ({ userId: u.id, username: u.username, fullName: u.fullName, issuedAt: u.cardIssuedAt }));
    return { scope, pins, cardsToReprint: cards };
  }

  /** Seçili kullanıcılara yeni rastgele PIN — düz değerler YALNIZ bu cevapta döner. */
  static async bulkResetApply(userIds: string[], actorUserId?: string) {
    if (userIds.length === 0) throw AppError.badRequest("En az bir kullanıcı seçin");
    if (userIds.length > BULK_RESET_MAX) throw AppError.badRequest(`En çok ${BULK_RESET_MAX} kullanıcı seçilebilir`);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true, deletedAt: null, isSystemAccount: false },
      select: { id: true, username: true, fullName: true },
      orderBy: { fullName: "asc" },
    });
    const results: Array<{ userId: string; username: string; fullName: string; pin: string }> = [];
    for (const u of users) {
      const pin = await ShortCredentialService.assignQuickPin(u.id, null);
      rememberIssuedPin(u.id, pin);
      await AuditService.log({
        userId: actorUserId, action: "UPDATE", tableName: "USER_QUICK_PIN",
        recordId: u.id, newData: { username: u.username, rotated: true, bulk: true },
      }).catch(() => undefined);
      results.push({ userId: u.id, username: u.username, fullName: u.fullName, pin });
    }
    const skipped = userIds.filter((id) => !users.some((u) => u.id === id));
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "SHORT_CREDENTIAL_BULK_RESET",
      userId: actorUserId ?? null,
      payload: { count: results.length, userIds: results.map((r) => r.userId), skipped },
    }).catch(() => undefined);
    return { results, skipped };
  }
}
