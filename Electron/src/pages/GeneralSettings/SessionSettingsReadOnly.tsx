import type { LoginMethod } from "@/services/featureFlagService";
import type { SameTypeSessionPolicy } from "@/types/auth";
import { sessionPolicyLabel } from "@/lib/session-auth";
import { minutesToLabel } from "@/lib/duration";
import { ReadOnlyLine } from "./SettingRow";
import { METHOD_LABELS } from "./LoginMethodsField";

/** Oturum & Güvenlik ayarlarının yetkisiz (admin:settings yok) salt-okunur özeti. */
export function SessionSettingsReadOnly({
  sessionMinutes,
  idleMinutes,
  autoLogout,
  policy,
  workIdleMinutes,
  mobileLock,
  mobileLockMinutes,
  methods,
  absoluteCapDays,
  pinLockoutEnabled,
  pinLockoutAttempts,
  pinLockoutPenaltySec,
  pinLockoutEscalateAfter,
  pinLockoutLongPenaltyMin,
}: {
  sessionMinutes: number;
  idleMinutes: number;
  autoLogout: boolean;
  policy: SameTypeSessionPolicy;
  workIdleMinutes: number;
  mobileLock: boolean;
  mobileLockMinutes: number;
  methods: { enabled: LoginMethod[]; primary: LoginMethod };
  absoluteCapDays: number;
  pinLockoutEnabled: boolean;
  pinLockoutAttempts: number;
  pinLockoutPenaltySec: number;
  pinLockoutEscalateAfter: number;
  pinLockoutLongPenaltyMin: number;
}) {
  return (
    <div className="space-y-1 text-sm">
      <ReadOnlyLine
        label="Oturum süresi"
        value={`${sessionMinutes} dakika (${minutesToLabel(sessionMinutes)})`}
      />
      <ReadOnlyLine
        label="Hareketsizlik zaman aşımı"
        value={idleMinutes > 0 ? `${idleMinutes} dakika` : "Kapalı"}
      />
      <ReadOnlyLine label="Token dolunca otomatik çıkış" value={autoLogout ? "Açık" : "Kapalı"} />
      <ReadOnlyLine label="Aynı hesap aynı cihaz tipinde" value={sessionPolicyLabel(policy)} />
      <ReadOnlyLine
        label="Çalışma oturumu zaman aşımı (saha)"
        value={workIdleMinutes > 0 ? `${workIdleMinutes} dakika` : "Kapalı"}
      />
      <ReadOnlyLine
        label="Mobil hareketsizlik kilidi"
        value={mobileLock ? `${mobileLockMinutes} dakika` : "Kapalı"}
      />
      <ReadOnlyLine
        label="Mutlak oturum tavanı"
        value={absoluteCapDays > 0 ? `${absoluteCapDays} gün` : "Süresiz"}
      />
      <ReadOnlyLine
        label="Hızlı PIN / kart deneme kilidi"
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
      <p className="pt-2 text-xs text-muted-foreground">
        Bu ayarları değiştirmek için <code>admin:settings</code> yetkisi gerekir.
      </p>
    </div>
  );
}
