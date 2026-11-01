/**
 * Kimlik sıfırlama kademesi — İKİ KİŞİLİK ONAY (güvenlik denetimi Bölge 2 B1b, kullanıcı kararı 2026-10-12).
 *
 * Kimlik teslim eden dört işlem (parola · iki adımlı doğrulama · hızlı PIN · kart) hedefin kimliğiyle
 * çalışmayı mümkün kılar; hedef aktörden daha yetkiliyse (efektif izin kümesi aktörünkünü AŞIYORSA) tek
 * kişi yapamaz: talep açılır, hedefi kapsayan İKİNCİ bir yetkili onaylar ve işlemi ONAYLAYAN uygular.
 * "Daha yetkili" ve "kapsar" tek yüklemden (`uncoveredCodes`) gelir — yetki verme kapısıyla aynı.
 */
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { AuthService } from "./auth.service";
import { PermissionManagementService } from "./permission-management.service";
import { TotpAccountService } from "./totp-account.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { uncoveredCodes } from "./helpers/permission-cover.helper";

export const CREDENTIAL_RESET_KINDS = ["PASSWORD", "TOTP", "QUICK_PIN", "CARD"] as const;
export type CredentialResetKind = (typeof CREDENTIAL_RESET_KINDS)[number];
export const CREDENTIAL_RESET_STATUSES = ["PENDING", "APPLIED", "REJECTED", "CANCELLED"] as const;
export type CredentialResetStatus = (typeof CREDENTIAL_RESET_STATUSES)[number];

/** Bekleyen talebin onaylanabileceği süre — eskiyen talep yeniden açılır (bağlam tazelensin). */
export const CREDENTIAL_RESET_TTL_MS = 24 * 60 * 60 * 1000;

const KIND_LABEL: Record<CredentialResetKind, string> = {
  PASSWORD: "parola sıfırlama",
  TOTP: "iki adımlı doğrulama sıfırlama",
  QUICK_PIN: "hızlı PIN yenileme",
  CARD: "kart yenileme",
};

/** Hedefin aktörün kapsamadığı izinleri — boşsa aktör hedeften daha yetkili ya da eşittir. */
export async function targetExceedsActor(actorUserId: string, targetUserId: string): Promise<string[]> {
  const [actor, target] = [
    await AuthService.getEffectivePermissions(actorUserId),
    await AuthService.getEffectivePermissions(targetUserId),
  ];
  return uncoveredCodes(actor, target);
}

/** Doğrudan uçların kapısı: hedef aktörü aşıyorsa 403 — yol iki kişilik talep. */
export async function assertDirectCredentialResetAllowed(
  actorUserId: string | undefined,
  targetUserId: string,
  kind: CredentialResetKind,
): Promise<void> {
  if (!actorUserId || actorUserId === targetUserId) return;
  const extra = await targetExceedsActor(actorUserId, targetUserId);
  if (extra.length === 0) return;
  throw AppError.forbidden(
    `Bu hesap sizden daha yetkili — ${KIND_LABEL[kind]} ikinci bir yöneticinin onayını ister. Onay talebi oluşturun.`,
    { code: "CREDENTIAL_RESET_NEEDS_APPROVAL", kind, targetUserId, exceedingCodes: extra },
  );
}

const VIEW_SELECT = {
  id: true,
  kind: true,
  reason: true,
  status: true,
  createdAt: true,
  decidedAt: true,
  targetUser: { select: { id: true, username: true, fullName: true } },
  requestedBy: { select: { id: true, username: true, fullName: true } },
  decidedBy: { select: { id: true, username: true, fullName: true } },
} as const;

async function requestView(id: string) {
  const row = await prisma.credentialResetRequest.findUniqueOrThrow({ where: { id }, select: VIEW_SELECT });
  return { ...row, expiresAt: new Date(row.createdAt.getTime() + CREDENTIAL_RESET_TTL_MS) };
}
export type CredentialResetRequestView = Awaited<ReturnType<typeof requestView>>;

export interface CreateCredentialResetInput {
  targetUserId: string;
  kind: CredentialResetKind;
  reason?: string | null;
  clientToken?: string;
}

function replayFor(input: CreateCredentialResetInput) {
  return tokenReplay<{ id: string; targetUserId: string; kind: string }, CredentialResetRequestView>({
    find: (db, clientToken) =>
      db.credentialResetRequest.findUnique({ where: { clientToken }, select: { id: true, targetUserId: true, kind: true } }),
    alive: { neverDies: "talep satırı silinmez; karar durum geçişidir" },
    identity: (p) => [
      { ad: "hedef", mevcut: p.targetUserId, gelen: input.targetUserId },
      { ad: "tur", mevcut: p.kind, gelen: input.kind },
    ],
    collision: "Bu işlem kimliği başka bir onay talebine ait; formu yeniden gönderin.",
    respond: (p) => requestView(p.id),
  });
}

export class CredentialResetService {
  static async create(actorUserId: string, input: CreateCredentialResetInput): Promise<CredentialResetRequestView> {
    return replayFor(input).run(input.clientToken, async () => {
      if (input.targetUserId === actorUserId) {
        throw AppError.badRequest("Kendi kimliğiniz için onay talebi açılmaz — parolanızı kendi hesabınızdan değiştirin.");
      }
      const target = await prisma.user.findUnique({ where: { id: input.targetUserId }, select: { id: true } });
      if (!target) throw AppError.notFound("Kullanıcı bulunamadı");
      const extra = await targetExceedsActor(actorUserId, input.targetUserId);
      if (extra.length === 0) {
        throw AppError.conflict("Bu hesap için onay gerekmiyor — işlemi doğrudan yapabilirsiniz.", {
          code: "APPROVAL_NOT_REQUIRED",
        });
      }
      const pending = await prisma.credentialResetRequest.findFirst({
        where: { targetUserId: input.targetUserId, kind: input.kind, status: "PENDING", createdAt: { gte: new Date(Date.now() - CREDENTIAL_RESET_TTL_MS) } },
        select: { id: true },
      });
      if (pending) {
        throw AppError.conflict("Bu hesap için aynı türde bekleyen bir talep zaten var.", {
          code: "REQUEST_ALREADY_PENDING",
          requestId: pending.id,
        });
      }
      const row = await prisma.credentialResetRequest.create({
        data: {
          clientToken: input.clientToken ?? null,
          targetUserId: input.targetUserId,
          kind: input.kind,
          reason: input.reason?.trim() || null,
          requestedById: actorUserId,
        },
        select: { id: true },
      });
      await AuditService.log({
        userId: actorUserId,
        action: "CREATE",
        tableName: "CREDENTIAL_RESET_REQUEST",
        recordId: row.id,
        newData: { targetUserId: input.targetUserId, kind: input.kind, exceedingCodes: extra },
      });
      return requestView(row.id);
    });
  }

  static async list(viewerId: string, status?: CredentialResetStatus) {
    const rows = await prisma.credentialResetRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: VIEW_SELECT,
    });
    const now = Date.now();
    const viewer = await AuthService.getEffectivePermissions(viewerId);
    const out = [];
    for (const r of rows) {
      const expired = r.status === "PENDING" && now - r.createdAt.getTime() > CREDENTIAL_RESET_TTL_MS;
      let canApprove = false;
      if (r.status === "PENDING" && !expired && r.requestedBy.id !== viewerId && r.targetUser.id !== viewerId) {
        const target = await AuthService.getEffectivePermissions(r.targetUser.id);
        canApprove = uncoveredCodes(viewer, target).length === 0;
      }
      out.push({ ...r, expiresAt: new Date(r.createdAt.getTime() + CREDENTIAL_RESET_TTL_MS), expired, canApprove });
    }
    return out;
  }

  /**
   * Onay = uygulama. Onaylayan: talep eden ve hedef DEĞİL, hedefi kapsar (doğrudan yapabilecek kişi).
   * Claim önce (çifte onay sırrı iki kez üretmesin); uygulama düşerse claim geri bırakılır.
   */
  static async approve(
    id: string,
    approverId: string,
    payload: { password?: string },
  ): Promise<{ request: CredentialResetRequestView; result: unknown }> {
    const req = await prisma.credentialResetRequest.findUnique({
      where: { id },
      select: { id: true, kind: true, status: true, targetUserId: true, requestedById: true, createdAt: true },
    });
    if (!req) throw AppError.notFound("Onay talebi bulunamadı");
    if (req.status !== "PENDING") throw AppError.conflict("Bu talep zaten karara bağlanmış.", { code: "REQUEST_NOT_PENDING", status: req.status });
    if (Date.now() - req.createdAt.getTime() > CREDENTIAL_RESET_TTL_MS) {
      throw AppError.conflict("Talebin süresi doldu (24 saat) — reddedip yeniden açın.", { code: "REQUEST_EXPIRED" });
    }
    if (req.requestedById === approverId) {
      throw AppError.forbidden("Kendi açtığınız talebi onaylayamazsınız — onay ikinci bir yöneticinindir.", { code: "APPROVER_IS_REQUESTER" });
    }
    if (req.targetUserId === approverId) {
      throw AppError.forbidden("Kendi kimliğinizle ilgili talebi onaylayamazsınız.", { code: "APPROVER_IS_TARGET" });
    }
    const extra = await targetExceedsActor(approverId, req.targetUserId);
    if (extra.length > 0) {
      throw AppError.forbidden("Onaylamak için hedef hesabın yetkilerini kapsayan bir yönetici olmalısınız.", {
        code: "APPROVER_NOT_SUFFICIENT",
        exceedingCodes: extra,
      });
    }
    const kind = req.kind as CredentialResetKind;
    if (kind === "PASSWORD" && !payload.password) throw AppError.badRequest("Geçici parola zorunlu");

    const claimed = await prisma.credentialResetRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPLIED", decidedById: approverId, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw AppError.conflict("Bu talep az önce karara bağlandı.", { code: "REQUEST_NOT_PENDING" });

    let result: unknown = null;
    try {
      // İki kişilik onay yolunda parola HEP geçicidir: onaylayan, daha yetkili hedefin parolasını bilmemeli.
      if (kind === "PASSWORD") await PermissionManagementService.resetUserPassword(req.targetUserId, payload.password!, approverId);
      else if (kind === "TOTP") await TotpAccountService.reset({ userId: req.targetUserId, byId: approverId });
      else if (kind === "QUICK_PIN") result = await AuthService.setQuickPin(req.targetUserId, {}, approverId);
      else result = await AuthService.rotateCardToken(req.targetUserId, approverId);
    } catch (e) {
      await prisma.credentialResetRequest.updateMany({
        where: { id, status: "APPLIED", decidedById: approverId },
        data: { status: "PENDING", decidedById: null, decidedAt: null },
      });
      throw e;
    }
    await AuditService.log({
      userId: approverId,
      action: "UPDATE",
      tableName: "CREDENTIAL_RESET_REQUEST",
      recordId: id,
      newData: { status: "APPLIED", kind, targetUserId: req.targetUserId, requestedById: req.requestedById },
    });
    return { request: await requestView(id), result };
  }

  /** Talep eden geri çeker (CANCELLED) ya da başka bir yönetici reddeder (REJECTED). */
  static async reject(id: string, actorId: string): Promise<CredentialResetRequestView> {
    const req = await prisma.credentialResetRequest.findUnique({ where: { id }, select: { requestedById: true, targetUserId: true } });
    if (!req) throw AppError.notFound("Onay talebi bulunamadı");
    const status: CredentialResetStatus = req.requestedById === actorId ? "CANCELLED" : "REJECTED";
    const claimed = await prisma.credentialResetRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status, decidedById: actorId, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw AppError.conflict("Bu talep zaten karara bağlanmış.", { code: "REQUEST_NOT_PENDING" });
    await AuditService.log({
      userId: actorId,
      action: "UPDATE",
      tableName: "CREDENTIAL_RESET_REQUEST",
      recordId: id,
      newData: { status, targetUserId: req.targetUserId, requestedById: req.requestedById },
    });
    return requestView(id);
  }
}
