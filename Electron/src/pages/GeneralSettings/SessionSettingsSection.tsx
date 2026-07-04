import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService, type LoginMethod } from "@/services/featureFlagService";
import type { SameTypeSessionPolicy } from "@/types/auth";
import {
  SAME_TYPE_SESSION_POLICY_OPTIONS,
  DEFAULT_SAME_TYPE_SESSION_POLICY,
  isSameTypeSessionPolicy,
} from "@/lib/session-auth";
import { FlagToggle, NumberField } from "./SettingRow";
import { LoginMethodsField } from "./LoginMethodsField";
import { SessionSettingsReadOnly } from "./SessionSettingsReadOnly";

const DEFAULT_SESSION_HOURS = 8;
const MAX_SESSION_HOURS = 720; // 30 gün
const MAX_IDLE_MINUTES = 1440; // 24 saat
const DEFAULT_WORK_SESSION_IDLE = 20; // dakika (eski 600 → 20)
const DEFAULT_MOBILE_IDLE_LOCK_MIN = 10;
const MIN_MOBILE_IDLE_LOCK_MIN = 1;
const MAX_MOBILE_IDLE_LOCK_MIN = 120;
const DEFAULT_LOGIN_METHODS: { enabled: LoginMethod[]; primary: LoginMethod } = {
  enabled: ["list"],
  primary: "list",
};

/**
 * Oturum & Güvenlik paneli — oturum/eşzamanlılık ayarları tek Kaydet ile:
 *  1) Oturum (JWT) ömrü (saat) — backend ENFORCE.
 *  2) Hareketsizlik zaman aşımı (dakika) — Electron paneli, useIdleLogout.
 *  3) Token dolunca otomatik çıkış (switch) — client ENFORCE (mobil+electron).
 *  4) Same-type oturum politikası (select) — backend (login) ENFORCE.
 *  5) Çalışma oturumu (saha) idle zaman aşımı (dakika) — backend TEMBEL enforce.
 *  6) Mobil hareketsizlik kilidi (switch + dakika) — client ENFORCE (mobil).
 *  7) Mobil giriş yöntemleri.
 * Hepsi admin:settings yetkisi ister.
 */
export function SessionSettingsSection() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const f = flagsQ.data?.data;
  const currentSession = f?.sessionDurationHours ?? DEFAULT_SESSION_HOURS;
  const currentIdle = f?.idleTimeoutMinutes ?? 0;
  const currentWorkIdle = f?.workSessionIdleTimeoutMinutes ?? DEFAULT_WORK_SESSION_IDLE;
  const currentMethods = f?.loginMethods ?? DEFAULT_LOGIN_METHODS;
  const currentAutoLogout = f?.autoLogoutOnExpiry ?? true;
  const currentMobileLock = f?.mobileIdleLockEnabled ?? true;
  const currentMobileLockMin = f?.mobileIdleLockMinutes ?? DEFAULT_MOBILE_IDLE_LOCK_MIN;
  const currentPolicy = isSameTypeSessionPolicy(f?.sameTypeSessionPolicy)
    ? f!.sameTypeSessionPolicy
    : DEFAULT_SAME_TYPE_SESSION_POLICY;

  // String tutulur — input'ta geçici boş değere izin vermek için (kaydederken parse edilir).
  const [session, setSession] = useState(String(currentSession));
  const [idle, setIdle] = useState(String(currentIdle));
  const [workIdle, setWorkIdle] = useState(String(currentWorkIdle));
  const [mobileLockMin, setMobileLockMin] = useState(String(currentMobileLockMin));
  const [autoLogout, setAutoLogout] = useState(currentAutoLogout);
  const [mobileLock, setMobileLock] = useState(currentMobileLock);
  const [policy, setPolicy] = useState<SameTypeSessionPolicy>(currentPolicy);
  const [enabledMethods, setEnabledMethods] = useState<LoginMethod[]>(currentMethods.enabled);
  const [primaryMethod, setPrimaryMethod] = useState<LoginMethod>(currentMethods.primary);
  const methodsKey = JSON.stringify(currentMethods);
  useEffect(() => {
    setSession(String(currentSession));
    setIdle(String(currentIdle));
    setWorkIdle(String(currentWorkIdle));
    setMobileLockMin(String(currentMobileLockMin));
    setAutoLogout(currentAutoLogout);
    setMobileLock(currentMobileLock);
    setPolicy(currentPolicy);
    setEnabledMethods(currentMethods.enabled);
    setPrimaryMethod(currentMethods.primary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentSession,
    currentIdle,
    currentWorkIdle,
    currentMobileLockMin,
    currentAutoLogout,
    currentMobileLock,
    currentPolicy,
    methodsKey,
  ]);

  const mut = useMutation({
    mutationFn: (payload: {
      sessionDurationHours: number;
      idleTimeoutMinutes: number;
      workSessionIdleTimeoutMinutes: number;
      mobileIdleLockMinutes: number;
      autoLogoutOnExpiry: boolean;
      mobileIdleLockEnabled: boolean;
      sameTypeSessionPolicy: SameTypeSessionPolicy;
      loginMethods: { enabled: LoginMethod[]; primary: LoginMethod };
    }) => featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Oturum ayarları kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) return <Skeleton className="h-48 w-full" />;

  const sessionNum = Number(session);
  const idleNum = Number(idle);
  const workIdleNum = Number(workIdle);
  const mobileLockMinNum = Number(mobileLockMin);
  const sessionValid =
    Number.isInteger(sessionNum) && sessionNum >= 1 && sessionNum <= MAX_SESSION_HOURS;
  const idleValid = Number.isInteger(idleNum) && idleNum >= 0 && idleNum <= MAX_IDLE_MINUTES;
  const workIdleValid =
    Number.isInteger(workIdleNum) && workIdleNum >= 0 && workIdleNum <= MAX_IDLE_MINUTES;
  const mobileLockMinValid =
    Number.isInteger(mobileLockMinNum) &&
    mobileLockMinNum >= MIN_MOBILE_IDLE_LOCK_MIN &&
    mobileLockMinNum <= MAX_MOBILE_IDLE_LOCK_MIN;
  const methodsValid = enabledMethods.length > 0 && enabledMethods.includes(primaryMethod);
  const dirty =
    sessionNum !== currentSession ||
    idleNum !== currentIdle ||
    workIdleNum !== currentWorkIdle ||
    mobileLockMinNum !== currentMobileLockMin ||
    autoLogout !== currentAutoLogout ||
    mobileLock !== currentMobileLock ||
    policy !== currentPolicy ||
    JSON.stringify([...enabledMethods].sort()) !== JSON.stringify([...currentMethods.enabled].sort()) ||
    primaryMethod !== currentMethods.primary;
  const allValid = sessionValid && idleValid && workIdleValid && mobileLockMinValid && methodsValid;

  const toggleMethod = (m: LoginMethod, on: boolean) => {
    setEnabledMethods((prev) => {
      const next = on ? [...new Set([...prev, m])] : prev.filter((x) => x !== m);
      // Öncelikli yöntem kapatıldıysa kalan ilk yönteme kaydır.
      const fallback = next[0];
      if (!on && primaryMethod === m && fallback) setPrimaryMethod(fallback);
      return next;
    });
  };

  return (
    <PermissionGate
      permission="admin:settings"
      fallback={
        <SessionSettingsReadOnly
          sessionHours={currentSession}
          idleMinutes={currentIdle}
          autoLogout={currentAutoLogout}
          policy={currentPolicy}
          workIdleMinutes={currentWorkIdle}
          mobileLock={currentMobileLock}
          mobileLockMinutes={currentMobileLockMin}
          methods={currentMethods}
        />
      }
    >
      <div className="space-y-5">
        <NumberField
          id="session-hours"
          label="Oturum süresi (saat)"
          desc="Giriş yaptıktan sonra oturum bu kadar saat geçerli kalır; süre dolunca — aktif kullanırken bile — yeniden giriş gerekir. Değişiklik yalnızca bundan sonraki girişlere uygulanır; şu an açık olan oturumlar mevcut süreleriyle devam eder."
          value={session}
          min={1}
          max={MAX_SESSION_HOURS}
          onChange={setSession}
          error={!sessionValid ? `1–${MAX_SESSION_HOURS} arası bir saat girin.` : undefined}
        />

        <div className="border-t pt-4">
          <NumberField
            id="idle-minutes"
            label="Hareketsizlik zaman aşımı (dakika)"
            desc="Panelde bu kadar dakika boyunca hiçbir işlem (fare/klavye) olmazsa oturum otomatik kapanır. Aktif kullanımda sayaç sürekli sıfırlanır. 0 = kapalı (hareketsizlikle otomatik çıkış yok)."
            value={idle}
            min={0}
            max={MAX_IDLE_MINUTES}
            onChange={setIdle}
            error={!idleValid ? `0–${MAX_IDLE_MINUTES} arası bir dakika girin (0 = kapalı).` : undefined}
          />
          {idleValid && idleNum === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Şu an kapalı: oturum yalnızca yukarıdaki süre dolunca veya elle çıkışta sona erer.
            </p>
          )}
        </div>

        <div className="border-t pt-4">
          <FlagToggle
            title="Token süresi dolunca otomatik çıkış yap"
            desc="Açıkken (varsayılan) oturum süresi (yukarıdaki saat) dolduğu anda — hiç işlem yapılmasa bile — cihaz otomatik olarak çıkış yapıp giriş ekranına döner (mobil + bu bilgisayar). Kapalıyken çıkış ancak bir sonraki sunucu isteğinde fark edilir."
            checked={autoLogout}
            disabled={false}
            onChange={setAutoLogout}
          />
        </div>

        <div className="border-t pt-4">
          <label htmlFor="same-type-policy" className="text-sm font-medium">
            Aynı hesap aynı cihaz tipinde ikinci kez açılırsa
          </label>
          <p className="text-xs text-muted-foreground">
            Aynı kullanıcı aynı tip cihazda (ör. iki bilgisayar ya da iki telefon) ikinci
            kez giriş yaptığında ne olacağı. Farklı tipler (1 bilgisayar + 1 telefon) her
            zaman serbesttir.
          </p>
          <select
            id="same-type-policy"
            className="mt-2 flex h-9 w-80 max-w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            value={policy}
            onChange={(e) => setPolicy(e.target.value as SameTypeSessionPolicy)}
          >
            {SAME_TYPE_SESSION_POLICY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="border-t pt-4">
          <NumberField
            id="work-session-idle-minutes"
            label="Çalışma oturumu zaman aşımı — saha (dakika)"
            desc="Bir tablet bu kadar dakika hiç kullanılmazsa oradaki iş oturumu otomatik kapanır ve makine yeniden boşa düşer. Operatör bir sonraki işlemde yeniden yer onayı verir. 0 = kapalı."
            value={workIdle}
            min={0}
            max={MAX_IDLE_MINUTES}
            onChange={setWorkIdle}
            error={!workIdleValid ? `0–${MAX_IDLE_MINUTES} arası bir dakika girin (0 = kapalı).` : undefined}
          />
        </div>

        <div className="border-t pt-4 space-y-3">
          <FlagToggle
            title="Mobil hareketsizlik kilidi"
            desc="Açıkken (varsayılan) tablet/telefon bu kadar dakika kullanılmazsa kilit ekranı gelir; iş oturumu açık kalır, operatör kart/PIN ile hızlıca devam eder. Kapalıyken mobilde hareketsizlik kilidi hiç devreye girmez."
            checked={mobileLock}
            disabled={false}
            onChange={setMobileLock}
          />
          {mobileLock && (
            <NumberField
              id="mobile-idle-lock-minutes"
              label="Mobil kilit süresi (dakika)"
              desc="Mobil cihaz bu kadar dakika dokunulmadan kalınca kilitlenir (1–120)."
              value={mobileLockMin}
              min={MIN_MOBILE_IDLE_LOCK_MIN}
              max={MAX_MOBILE_IDLE_LOCK_MIN}
              onChange={setMobileLockMin}
              error={
                !mobileLockMinValid
                  ? `${MIN_MOBILE_IDLE_LOCK_MIN}–${MAX_MOBILE_IDLE_LOCK_MIN} arası bir dakika girin.`
                  : undefined
              }
            />
          )}
        </div>

        <LoginMethodsField
          enabled={enabledMethods}
          primary={primaryMethod}
          valid={methodsValid}
          onToggle={toggleMethod}
          onPrimaryChange={setPrimaryMethod}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!dirty || !allValid || mut.isPending}
            onClick={() =>
              mut.mutate({
                sessionDurationHours: sessionNum,
                idleTimeoutMinutes: idleNum,
                workSessionIdleTimeoutMinutes: workIdleNum,
                mobileIdleLockMinutes: mobileLockMinNum,
                autoLogoutOnExpiry: autoLogout,
                mobileIdleLockEnabled: mobileLock,
                sameTypeSessionPolicy: policy,
                loginMethods: { enabled: enabledMethods, primary: primaryMethod },
              })
            }
          >
            {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Oturum süresi + same-type politikası backend tarafından uygulanır; hareketsizlik
            zaman aşımı bu bilgisayarda, mobil kilit sahadaki cihazlarda geçerlidir. Çalışma
            oturumu zaman aşımı tüm saha cihazları için backend tarafından uygulanır.
          </span>
        </div>
      </div>
    </PermissionGate>
  );
}
