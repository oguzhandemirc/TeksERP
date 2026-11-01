import type { LoginMethod } from "@/services/featureFlagService";
import type { SameTypeSessionPolicy } from "@/types/auth";
import { sessionPolicyLabel } from "@/lib/session-auth";
import { minutesToLabel } from "@/lib/duration";
import { ReadOnlyLine } from "./SettingRow";
import { METHOD_LABELS } from "./LoginMethodsField";
import { UNSET_ABSOLUTE_CAP_DAYS } from "./useSessionSettingsForm";

/** Oturum & Güvenlik ayarlarının yetkisiz (admin:settings yok) salt-okunur özeti. */
export function SessionSettingsReadOnly({
  sessionMinutes,
  idleMinutes,
  autoLogout,
  policy,
  workIdleMinutes,
  mobileLock,
  mobileLockMinutes,
  mobileLockBg,
  offlineLockDefer = false,
  methods,
  absoluteCapDays,
  pinLockoutEnabled,
  pinLockoutAttempts,
  pinLockoutPenaltySec,
  pinLockoutEscalateAfter,
  pinLockoutLongPenaltyMin,
  shortCredentialTotpRequired = false,
}: {
  sessionMinutes: number;
  idleMinutes: number;
  autoLogout: boolean;
  policy: SameTypeSessionPolicy;
  workIdleMinutes: number;
  mobileLock: boolean;
  mobileLockMinutes: number;
  mobileLockBg: boolean;
  offlineLockDefer?: boolean;
  methods: { enabled: LoginMethod[]; primary: LoginMethod };
  absoluteCapDays: number;
  pinLockoutEnabled: boolean;
  pinLockoutAttempts: number;
  pinLockoutPenaltySec: number;
  pinLockoutEscalateAfter: number;
  pinLockoutLongPenaltyMin: number;
  shortCredentialTotpRequired?: boolean;
}) {
  return (
    <div className="space-y-1 text-sm">
      <ReadOnlyLine
        label="Oturum süresi"
        value={`${sessionMinutes} dakika (${minutesToLabel(sessionMinutes)})`}
      />
      <ReadOnlyLine label="Hareketsizlik zaman aşımı" value={idleMinutes > 0 ? `${idleMinutes} dakika` : "Kapalı"} />
      <ReadOnlyLine label="Token dolunca otomatik çıkış" value={autoLogout ? "Açık" : "Kapalı"} />
      <ReadOnlyLine label="Aynı hesap aynı cihaz tipinde" value={sessionPolicyLabel(policy)} />
      <ReadOnlyLine
        label="Çalışma oturumu zaman aşımı (saha)"
        value={workIdleMinutes > 0 ? `${workIdleMinutes} dakika` : "Kapalı"}
      />
      <ReadOnlyLine label="Mobil hareketsizlik kilidi" value={mobileLock ? `${mobileLockMinutes} dakika` : "Kapalı"} />
      <ReadOnlyLine label="Uygulamadan çıkınca kilitle (mobil)" value={mobileLockBg ? "Açık" : "Kapalı"} />
      <ReadOnlyLine label="İnternet yokken tablet kilitlenmesin" value={offlineLockDefer ? "Açık" : "Kapalı"} />
      <ReadOnlyLine
        label="Mutlak oturum tavanı"
        value={absoluteCapDays > 0 ? `${absoluteCapDays} gün` : `${UNSET_ABSOLUTE_CAP_DAYS} gün (sert tavan)`}
      />
      <ReadOnlyLine
        label="Giriş deneme kilidi"
        value={
          pinLockoutEnabled
            ? `${pinLockoutAttempts} deneme · ${pinLockoutPenaltySec} sn ceza · ${pinLockoutEscalateAfter} turda ${pinLockoutLongPenaltyMin} dk`
            : "Kapalı"
        }
      />
      <ReadOnlyLine
        label="Mobil giriş yöntemleri"
        value={`${methods.enabled.map((m) => METHOD_LABELS[m]).join(" · ")} (öncelik: ${METHOD_LABELS[methods.primary]})`}
      />
      <ReadOnlyLine
        label="PIN ve kart girişinde doğrulama kodu"
        value={shortCredentialTotpRequired ? "Açık (2FA'lı hesaplarda)" : "Kapalı (süperadminde her zaman)"}
      />
      <p className="pt-2 text-xs text-muted-foreground">
        Bu ayarları değiştirmek için <code>admin:settings</code> yetkisi gerekir.
      </p>
    </div>
  );
}
