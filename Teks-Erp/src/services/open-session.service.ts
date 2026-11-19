// =============================================================================
// TeksERP — Açık oturumlar (Sistem → Bağlı İstemciler → "Açık oturumlar")
// =============================================================================
// Bağlı istemci defteri (`lib/client-registry`) KURULUM düzeyinde ve süreç belleğindedir;
// bu servis OTURUM düzeyindedir ve `sessions` tablosundan okur (restart'ta boşalmaz).
// jti/belirteç projeksiyona, yanıta ve audit yüküne GİRMEZ; IP tutulmaz.
// =============================================================================

import { ClientType, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { effectiveClientPolicy } from "../lib/client-policy-lease";
import { AppError } from "../utils/app-error";
import { listSearchWhere, matchingEnumValues } from "../utils/list-search";
import { AuditService } from "./audit.service";
import { mainDeviceByLocalIds } from "./helpers/device-identity.helper";
import { ACTOR_SELECT } from "./helpers/system-account.helper";
import { isSystemAccountAuthorized, SEAL_ROW_SELECT } from "./helpers/system-account-seal.helper";
import { releasePushTokensForSession } from "./patron-push/lifecycle";
import { SessionRegistryService } from "./session-registry.service";

/** Liste tavanı — oturum kullanıcı başına ≤20; tavan aşılırsa `truncated` söyler. */
export const OPEN_SESSION_LIST_MAX = 500;
export const OPEN_SESSION_LIST_DEFAULT = 200;
/** Panelde gösterilen cihaz kimliği öneki (tam değer listelenmez). */
const DEVICE_ID_PREFIX_LEN = 8;
export const ADMIN_REVOKE_REASON = "ADMIN_REVOKE";

/** Oturum türü → istemci künye türü (sürüm politikası anahtarı). */
const KIND_BY_TYPE: Record<ClientType, string> = {
  ELECTRON: "electron",
  MOBILE: "mobil",
  WEB: "web",
  PATRON: "patron",
};

/** Arama için türlerin ekranda görünen adları (panel `SESSION_TYPE_LABELS` ile aynı). */
const TYPE_SEARCH_LABELS: Record<ClientType, readonly string[]> = {
  ELECTRON: ["Masaüstü panel", "panel"],
  MOBILE: ["Tablet", "saha"],
  WEB: ["Tarayıcı", "web"],
  PATRON: ["Patron telefonu", "patron"],
};

/** "Açık" oturum yüklemi — TEK KAYNAK (liste ve sonlandırma claim'i aynı koşulu kullanır). */
export function openSessionWhere(now: Date): Prisma.SessionWhereInput {
  return { revokedAt: null, expiresAt: { gt: now } };
}

/** jti BİLEREK yok: belirteç kimliği yönetim ekranına çıkmaz. */
const SESSION_LIST_SELECT = {
  id: true,
  deviceType: true,
  deviceId: true,
  clientVersion: true,
  lastSeenAt: true,
  createdAt: true,
  expiresAt: true,
  user: { select: ACTOR_SELECT },
} as const satisfies Prisma.SessionSelect;

async function searchWhere(search: string | undefined): Promise<Prisma.SessionWhereInput | undefined> {
  if (!search) return undefined;
  const textOr = listSearchWhere<Prisma.SessionWhereInput>(search, {
    plain: ["user.username", "user.fullName", "clientVersion"],
  });
  const deviceOr = listSearchWhere<Prisma.DeviceWhereInput>(search, { plain: ["name", "mergedInto.name"] });
  const devices = deviceOr
    ? await prisma.device.findMany({ where: deviceOr, select: { deviceId: true }, take: OPEN_SESSION_LIST_MAX })
    : [];
  const types = matchingEnumValues(search, TYPE_SEARCH_LABELS);
  const or: Prisma.SessionWhereInput[] = [...(textOr?.OR ?? [])];
  if (devices.length > 0) or.push({ deviceId: { in: devices.map((d) => d.deviceId) } });
  if (types.length > 0) or.push({ deviceType: { in: types } });
  // Hiçbir yaprak yoksa (eşleşen yok) boş OR "hiç kayıt" anlamına gelir — bilinçli.
  return { OR: or };
}

export interface OpenSessionListInput {
  search?: string;
  limit?: number;
  /** İsteği yapan oturumun jti'si — yalnız `isCurrent` işareti için, yanıta yazılmaz. */
  currentJti?: string | null;
}

export const OpenSessionService = {
  async list({ search, limit = OPEN_SESSION_LIST_DEFAULT, currentJti }: OpenSessionListInput) {
    const now = new Date();
    const take = Math.min(Math.max(1, limit), OPEN_SESSION_LIST_MAX);
    const sw = await searchWhere(search);
    const where: Prisma.SessionWhereInput = sw ? { AND: [openSessionWhere(now), sw] } : openSessionWhere(now);
    const rows = await prisma.session.findMany({
      where,
      // Son görülen önce; hiç istek atmamış oturum sonda; eşitlik bozucu createdAt + id.
      orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      select: SESSION_LIST_SELECT,
    });
    const truncated = rows.length > take;
    const page = truncated ? rows.slice(0, take) : rows;

    const currentId = currentJti
      ? (await prisma.session.findUnique({ where: { jti: currentJti }, select: { id: true } }))?.id ?? null
      : null;
    const deviceIds = [...new Set(page.map((r) => r.deviceId).filter((v): v is string => !!v))];
    const devices = await mainDeviceByLocalIds(prisma, deviceIds);

    return {
      now: now.toISOString(),
      truncated,
      limit: take,
      sessions: page.map((r) => {
        const kind = KIND_BY_TYPE[r.deviceType];
        const d = r.deviceId ? devices.get(r.deviceId) : undefined;
        return {
          id: r.id,
          deviceType: r.deviceType,
          deviceName: d?.name ?? null,
          deviceKind: d?.kind ?? null,
          deviceIdPrefix: r.deviceId ? r.deviceId.slice(0, DEVICE_ID_PREFIX_LEN) : null,
          /** Girişte bildirilen sürüm; null = ÖLÇÜLEMEDİ (eski istemci DEMEK DEĞİL). */
          clientVersion: r.clientVersion,
          expectedVersion: effectiveClientPolicy(kind)?.currentVersion ?? null,
          lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          isCurrent: r.id === currentId,
          user: r.user,
        };
      }),
    };
  },

  /**
   * Yönetici başka bir açık oturumu sonlandırır — durum geçişi (veri kaybı yok; kullanıcı yeniden
   * girer). Atomik claim: açık değilse 409. Kendi oturumu 400 (çıkış ayrı yol); en yetkili hesabın
   * oturumunu yalnız kendisi kapatır (403 + audit, `/users/:id` yazma korumasının ikizi).
   */
  async revoke(params: { actorUserId: string; actorIsSystemAccount: boolean; actorJti: string | null; sessionId: string; ipAddress: string | null }) {
    const { actorUserId, actorIsSystemAccount, actorJti, sessionId, ipAddress } = params;
    const target = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, jti: true, userId: true, deviceType: true, clientVersion: true, user: { select: SEAL_ROW_SELECT } },
    });
    if (!target) throw AppError.notFound("Oturum bulunamadı.", { code: "SESSION_NOT_FOUND" });
    if (actorJti && target.jti === actorJti) {
      throw AppError.badRequest("Kullandığınız oturumu buradan sonlandıramazsınız; Çıkış yapın.", { code: "SESSION_IS_CURRENT" });
    }
    if (!actorIsSystemAccount && isSystemAccountAuthorized(target.user)) {
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "SYSTEM_ACCOUNT_WRITE_BLOCKED",
        userId: actorUserId,
        tableName: "sessions",
        recordId: target.id,
        ipAddress,
        payload: { targetUserId: target.userId, operation: "SESSION_REVOKE" },
      }).catch(() => undefined);
      throw AppError.forbidden("En yetkili hesabın oturumu başka bir kullanıcı tarafından sonlandırılamaz.");
    }
    const now = new Date();
    // Satırı oturum defterinin tek yazar ailesi yazar (audit muafiyeti beyanı); audit burada.
    const claim = await SessionRegistryService.revokeOpenById(target.id, openSessionWhere(now), now, ADMIN_REVOKE_REASON);
    if (claim.count === 0) {
      throw AppError.conflict("Bu oturum zaten kapanmış.", { code: "SESSION_NOT_OPEN" });
    }
    // Patron push belirteci oturumla yaşar; hata sonlandırmayı bozmaz (iş turunun süpürmesi ikinci hattır).
    await releasePushTokensForSession(target.jti).catch(() => 0);
    await AuditService.logEvent({
      category: "AUTH",
      action: "SESSION_REVOKED_BY_ADMIN",
      userId: actorUserId,
      tableName: "sessions",
      recordId: target.id,
      ipAddress,
      payload: { targetUserId: target.userId, deviceType: target.deviceType, clientVersion: target.clientVersion },
    });
    return { id: target.id, revokedAt: now.toISOString() };
  },
};
