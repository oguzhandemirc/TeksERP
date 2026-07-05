import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService, type LoginMethod } from "@/services/featureFlagService";
import type { SameTypeSessionPolicy } from "@/types/auth";
import { DEFAULT_SAME_TYPE_SESSION_POLICY, isSameTypeSessionPolicy } from "@/lib/session-auth";

export const DEFAULT_SESSION_MINUTES = 480; // 8 saat
export const MAX_SESSION_MINUTES = 43200; // 30 gün
export const MAX_IDLE_MINUTES = 1440; // 24 saat
export const DEFAULT_IDLE_MIN = 15; // panel idle açılınca makul varsayılan
export const DEFAULT_WORK_SESSION_IDLE = 20; // saha idle açılınca makul varsayılan
export const DEFAULT_MOBILE_IDLE_LOCK_MIN = 10;
export const MIN_MOBILE_IDLE_LOCK_MIN = 1;
export const MAX_MOBILE_IDLE_LOCK_MIN = 120; // 2 saat
const DEFAULT_LOGIN_METHODS: { enabled: LoginMethod[]; primary: LoginMethod } = {
  enabled: ["list"],
  primary: "list",
};

/**
 * Oturum & Güvenlik formunun tüm durumu + doğrulama + tek Kaydet mutasyonu.
 * Bileşen (SessionSettingsSection) yalnız render eder — mantık burada tek yerde.
 * Toggle'lı süreler aç/kapa (>0/==0) + hatırlanan dakika değeriyle tutulur.
 */
export function useSessionSettingsForm() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const f = flagsQ.data?.data;

  const currentSessionMin =
    f?.sessionDurationMinutes ??
    (f?.sessionDurationHours != null ? f.sessionDurationHours * 60 : DEFAULT_SESSION_MINUTES);
  const currentIdle = f?.idleTimeoutMinutes ?? 0;
  const currentWorkIdle = f?.workSessionIdleTimeoutMinutes ?? DEFAULT_WORK_SESSION_IDLE;
  const currentMethods = f?.loginMethods ?? DEFAULT_LOGIN_METHODS;
  const currentAutoLogout = f?.autoLogoutOnExpiry ?? true;
  const currentMobileLock = f?.mobileIdleLockEnabled ?? true;
  const currentMobileLockMin = f?.mobileIdleLockMinutes ?? DEFAULT_MOBILE_IDLE_LOCK_MIN;
  const currentPolicy = isSameTypeSessionPolicy(f?.sameTypeSessionPolicy)
    ? f!.sameTypeSessionPolicy
    : DEFAULT_SAME_TYPE_SESSION_POLICY;

  const [sessionMin, setSessionMin] = useState(currentSessionMin);
  const [autoLogout, setAutoLogout] = useState(currentAutoLogout);
  const [idleEnabled, setIdleEnabled] = useState(currentIdle > 0);
  const [idleMin, setIdleMin] = useState(currentIdle > 0 ? currentIdle : DEFAULT_IDLE_MIN);
  const [mobileLock, setMobileLock] = useState(currentMobileLock);
  const [mobileLockMin, setMobileLockMin] = useState(currentMobileLockMin);
  const [workEnabled, setWorkEnabled] = useState(currentWorkIdle > 0);
  const [workMin, setWorkMin] = useState(
    currentWorkIdle > 0 ? currentWorkIdle : DEFAULT_WORK_SESSION_IDLE,
  );
  const [policy, setPolicy] = useState<SameTypeSessionPolicy>(currentPolicy);
  const [enabledMethods, setEnabledMethods] = useState<LoginMethod[]>(currentMethods.enabled);
  const [primaryMethod, setPrimaryMethod] = useState<LoginMethod>(currentMethods.primary);
  const methodsKey = JSON.stringify(currentMethods);
  useEffect(() => {
    setSessionMin(currentSessionMin);
    setAutoLogout(currentAutoLogout);
    setIdleEnabled(currentIdle > 0);
    setIdleMin(currentIdle > 0 ? currentIdle : DEFAULT_IDLE_MIN);
    setMobileLock(currentMobileLock);
    setMobileLockMin(currentMobileLockMin);
    setWorkEnabled(currentWorkIdle > 0);
    setWorkMin(currentWorkIdle > 0 ? currentWorkIdle : DEFAULT_WORK_SESSION_IDLE);
    setPolicy(currentPolicy);
    setEnabledMethods(currentMethods.enabled);
    setPrimaryMethod(currentMethods.primary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentSessionMin,
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
      sessionDurationMinutes: number;
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

  // Kaydedilecek efektif değerler (toggle kapalıysa 0).
  const savedIdle = idleEnabled ? idleMin : 0;
  const savedWork = workEnabled ? workMin : 0;

  const sessionValid =
    Number.isInteger(sessionMin) && sessionMin >= 1 && sessionMin <= MAX_SESSION_MINUTES;
  const idleValid =
    !idleEnabled || (Number.isInteger(idleMin) && idleMin >= 1 && idleMin <= MAX_IDLE_MINUTES);
  const workValid =
    !workEnabled || (Number.isInteger(workMin) && workMin >= 1 && workMin <= MAX_IDLE_MINUTES);
  const mobileLockMinValid =
    Number.isInteger(mobileLockMin) &&
    mobileLockMin >= MIN_MOBILE_IDLE_LOCK_MIN &&
    mobileLockMin <= MAX_MOBILE_IDLE_LOCK_MIN;
  const methodsValid = enabledMethods.length > 0 && enabledMethods.includes(primaryMethod);
  const allValid = sessionValid && idleValid && workValid && mobileLockMinValid && methodsValid;

  const methodsDirty =
    JSON.stringify([...enabledMethods].sort()) !==
      JSON.stringify([...currentMethods.enabled].sort()) ||
    primaryMethod !== currentMethods.primary;
  const dirty =
    sessionMin !== currentSessionMin ||
    savedIdle !== currentIdle ||
    savedWork !== currentWorkIdle ||
    mobileLockMin !== currentMobileLockMin ||
    autoLogout !== currentAutoLogout ||
    mobileLock !== currentMobileLock ||
    policy !== currentPolicy ||
    methodsDirty;

  const toggleIdle = (on: boolean) => {
    setIdleEnabled(on);
    if (on && !(Number.isInteger(idleMin) && idleMin >= 1)) setIdleMin(DEFAULT_IDLE_MIN);
  };
  const toggleWork = (on: boolean) => {
    setWorkEnabled(on);
    if (on && !(Number.isInteger(workMin) && workMin >= 1)) setWorkMin(DEFAULT_WORK_SESSION_IDLE);
  };
  const toggleMethod = (m: LoginMethod, on: boolean) => {
    setEnabledMethods((prev) => {
      const next = on ? [...new Set([...prev, m])] : prev.filter((x) => x !== m);
      const fallback = next[0];
      if (!on && primaryMethod === m && fallback) setPrimaryMethod(fallback);
      return next;
    });
  };

  const save = () =>
    mut.mutate({
      sessionDurationMinutes: sessionMin,
      idleTimeoutMinutes: savedIdle,
      workSessionIdleTimeoutMinutes: savedWork,
      mobileIdleLockMinutes: mobileLockMin,
      autoLogoutOnExpiry: autoLogout,
      mobileIdleLockEnabled: mobileLock,
      sameTypeSessionPolicy: policy,
      loginMethods: { enabled: enabledMethods, primary: primaryMethod },
    });

  return {
    isLoading: flagsQ.isLoading,
    // düzenlenebilir durum + setter/handler
    sessionMin, setSessionMin,
    autoLogout, setAutoLogout,
    idleEnabled, idleMin, setIdleMin, toggleIdle,
    mobileLock, setMobileLock, mobileLockMin, setMobileLockMin,
    workEnabled, workMin, setWorkMin, toggleWork,
    policy, setPolicy,
    enabledMethods, primaryMethod, setPrimaryMethod, toggleMethod,
    // doğrulama
    sessionValid, idleValid, workValid, mobileLockMinValid, methodsValid, allValid, dirty,
    // kaydet
    save, isSaving: mut.isPending,
    // yetkisiz salt-okunur özet için mevcut (kayıtlı) değerler
    current: {
      sessionMin: currentSessionMin,
      idle: currentIdle,
      workIdle: currentWorkIdle,
      autoLogout: currentAutoLogout,
      mobileLock: currentMobileLock,
      mobileLockMin: currentMobileLockMin,
      policy: currentPolicy,
      methods: currentMethods,
    },
  };
}
