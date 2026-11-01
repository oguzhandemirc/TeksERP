// Giriş kilidi yönetimi (VDS denetimi O4): kilitli kovaları listeler, yönetici audit'li kaldırır.
// Kilit kalıcıdır (DB) ve kapatılamaz; kaldırma yalnız tek kovayı açar, kuralı değiştirmez.
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  isReleasableLoginLabel,
  listBlockedLoginBuckets,
  releaseBlockedLoginBucket,
  type BlockedLoginBucket,
} from "../middlewares/login-lockout";

export type LoginLockoutView = {
  id: string;
  /** "ip|kimlik" okunur etiketi; yeniden başlatma öncesinden kalan kovada null. */
  label: string | null;
  method: "PASSWORD" | "PIN" | "CARD" | "OTHER";
  blockedUntil: string;
  penaltyRounds: number;
  /** Etiketsiz (türü belirsiz) kova kaldırılamaz — kendiliğinden açılmasını bekler. */
  releasable: boolean;
};

function methodOf(label: string | null): LoginLockoutView["method"] {
  if (!label) return "OTHER";
  if (/^pin\||\|pin:/.test(label)) return "PIN";
  if (/^card\||\|card:|^card-user:/.test(label)) return "CARD";
  return "PASSWORD";
}

function toView(b: BlockedLoginBucket): LoginLockoutView {
  return { id: b.id, label: b.label, method: methodOf(b.label), blockedUntil: b.blockedUntil.toISOString(), penaltyRounds: b.penaltyRounds, releasable: isReleasableLoginLabel(b.label) };
}

export class LoginLockoutAdminService {
  static async list(): Promise<LoginLockoutView[]> {
    return (await listBlockedLoginBuckets()).map(toView);
  }

  /** Kilitli değilse 409 (yarışta ikinci kaldıran ya da süresi o an dolan kova). */
  static async release(actorUserId: string, id: string, ipAddress: string | null): Promise<LoginLockoutView> {
    const result = await releaseBlockedLoginBucket(id);
    if (result.status === "NOT_ACTIVE") throw AppError.conflict("Bu giriş kilidi artık etkin değil.", { code: "LOCKOUT_NOT_ACTIVE" });
    if (result.status === "NOT_RELEASABLE") {
      throw AppError.forbidden("Bu kilit yönetici tarafından kaldırılamaz; süresi dolunca kendiliğinden açılır.", {
        code: "LOCKOUT_NOT_RELEASABLE",
      });
    }
    const view = toView(result.bucket);
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
