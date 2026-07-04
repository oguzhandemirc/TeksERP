import type { LoginMethod } from "@/services/featureFlagService";
import type { SameTypeSessionPolicy } from "@/types/auth";
import { sessionPolicyLabel } from "@/lib/session-auth";
import { ReadOnlyLine } from "./SettingRow";
import { METHOD_LABELS } from "./LoginMethodsField";

/** Oturum & Güvenlik ayarlarının yetkisiz (admin:settings yok) salt-okunur özeti. */
export function SessionSettingsReadOnly({
  sessionHours,
  idleMinutes,
  autoLogout,
  policy,
  workIdleMinutes,
  mobileLock,
  mobileLockMinutes,
  methods,
}: {
  sessionHours: number;
  idleMinutes: number;
  autoLogout: boolean;
  policy: SameTypeSessionPolicy;
  workIdleMinutes: number;
  mobileLock: boolean;
  mobileLockMinutes: number;
  methods: { enabled: LoginMethod[]; primary: LoginMethod };
}) {
  return (
    <div className="space-y-1 text-sm">
      <ReadOnlyLine label="Oturum süresi" value={`${sessionHours} saat`} />
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
        label="Mobil giriş yöntemleri"
        value={`${methods.enabled.map((m) => METHOD_LABELS[m]).join(" · ")} (öncelik: ${METHOD_LABELS[methods.primary]})`}
      />
      <p className="pt-2 text-xs text-muted-foreground">
        Bu ayarları değiştirmek için <code>admin:settings</code> yetkisi gerekir.
      </p>
    </div>
  );
}
