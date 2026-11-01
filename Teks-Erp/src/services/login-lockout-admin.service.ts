// Giriş kilidi yönetimi (VDS denetimi O4): kilitli kovaları listeler, yönetici audit'li kaldırır.
// Kilit kalıcıdır (DB) ve kapatılamaz; kaldırma yalnız tek kovayı açar, kuralı değiştirmez.
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { listBlockedLoginBuckets, releaseBlockedLoginBucket, type BlockedLoginBucket } from "../middlewares/login-lockout";

export type LoginLockoutView = {
  id: string;
  /** "ip|kimlik" okunur etiketi; yeniden başlatma öncesinden kalan kovada null. */
  label: string | null;
  method: "PASSWORD" | "PIN" | "CARD" | "OTHER";
  blockedUntil: string;
  penaltyRounds: number;
};

function methodOf(label: string | null): LoginLockoutView["method"] {
  if (!label) return "OTHER";
  if (/^pin\||\|pin:/.test(label)) return "PIN";
  if (/^card\||\|card:|^card-user:/.test(label)) return "CARD";
  if (/^(cp|sp|bp|wt):/.test(label)) return "OTHER"; // parola değişimi / ayar / yedek şifresi / web 2FA kapıları
  return "PASSWORD";
}

function toView(b: BlockedLoginBucket): LoginLockoutView {
  return { id: b.id, label: b.label, method: methodOf(b.label), blockedUntil: b.blockedUntil.toISOString(), penaltyRounds: b.penaltyRounds };
}

export class LoginLockoutAdminService {
  static async list(): Promise<LoginLockoutView[]> {
    return (await listBlockedLoginBuckets()).map(toView);
  }

  /** Kilitli değilse 409 (yarışta ikinci kaldıran ya da süresi o an dolan kova). */
  static async release(actorUserId: string, id: string, ipAddress: string | null): Promise<LoginLockoutView> {
    const released = await releaseBlockedLoginBucket(id);
    if (!released) throw AppError.conflict("Bu giriş kilidi artık etkin değil.", { code: "LOCKOUT_NOT_ACTIVE" });
    const view = toView(released);
    await AuditService.logEvent({
      category: "AUTH",
      action: "LOGIN_LOCK_RELEASED",
      userId: actorUserId,
      recordId: id.slice(0, 16),
      ipAddress,
      payload: { label: view.label, method: view.method, blockedUntil: view.blockedUntil, penaltyRounds: view.penaltyRounds },
    });
    return view;
  }
}
