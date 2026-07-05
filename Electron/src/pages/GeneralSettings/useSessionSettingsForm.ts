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
// Mutlak oturum tavanı — gün (0 = süresiz).
export const DEFAULT_ABSOLUTE_CAP_DAYS = 30;
export const MAX_ABSOLUTE_CAP_DAYS = 365;
// Hızlı PIN/kart deneme kilidi — aralıklar (backend ile birebir).
export const DEFAULT_PIN_LOCKOUT_ATTEMPTS = 5;
export const MIN_PIN_LOCKOUT_ATTEMPTS = 1;
export const MAX_PIN_LOCKOUT_ATTEMPTS = 20;
export const DEFAULT_PIN_LOCKOUT_PENALTY_SEC = 60;
export const MIN_PIN_LOCKOUT_PENALTY_SEC = 5;
export const MAX_PIN_LOCKOUT_PENALTY_SEC = 3600;
export const DEFAULT_PIN_LOCKOUT_ESCALATE_AFTER = 3;
export const MIN_PIN_LOCKOUT_ESCALATE_AFTER = 1;
export const MAX_PIN_LOCKOUT_ESCALATE_AFTER = 20;
export const DEFAULT_PIN_LOCKOUT_LONG_PENALTY_MIN = 15;
export const MIN_PIN_LOCKOUT_LONG_PENALTY_MIN = 1;
export const MAX_PIN_LOCKOUT_LONG_PENALTY_MIN = 1440;
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
  const currentCapDays = f?.absoluteSessionCapDays ?? DEFAULT_ABSOLUTE_CAP_DAYS;
  const currentPinEnabled = f?.pinLockoutEnabled ?? true;
  const currentPinAttempts = f?.pinLockoutAttempts ?? DEFAULT_PIN_LOCKOUT_ATTEMPTS;
  const currentPinPenaltySec = f?.pinLockoutPenaltySec ?? DEFAULT_PIN_LOCKOUT_PENALTY_SEC;
  const currentPinEscalate = f?.pinLockoutEscalateAfter ?? DEFAULT_PIN_LOCKOUT_ESCALATE_AFTER;
  const currentPinLongMin = f?.pinLockoutLongPenaltyMin ?? DEFAULT_PIN_LOCKOUT_LONG_PENALTY_MIN;

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
  // Birim dakika DEĞİL (gün/sn/tur/dk) → NumberField (string) ile tutulur; geçici boş girişe izin.
  const [capDays, setCapDays] = useState(String(currentCapDays));
  const [pinEnabled, setPinEnabled] = useState(currentPinEnabled);
  const [pinAttempts, setPinAttempts] = useState(String(currentPinAttempts));
  const [pinPenaltySec, setPinPenaltySec] = useState(String(currentPinPenaltySec));
  const [pinEscalate, setPinEscalate] = useState(String(currentPinEscalate));
  const [pinLongMin, setPinLongMin] = useState(String(currentPinLongMin));
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
    setCapDays(String(currentCapDays));
    setPinEnabled(currentPinEnabled);
    setPinAttempts(String(currentPinAttempts));
    setPinPenaltySec(String(currentPinPenaltySec));
    setPinEscalate(String(currentPinEscalate));
    setPinLongMin(String(currentPinLongMin));
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
    currentCapDays,
    currentPinEnabled,
    currentPinAttempts,
    currentPinPenaltySec,
    currentPinEscalate,
    currentPinLongMin,
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
      absoluteSessionCapDays: number;
      pinLockoutEnabled: boolean;
      pinLockoutAttempts: number;
      pinLockoutPenaltySec: number;
      pinLockoutEscalateAfter: number;
      pinLockoutLongPenaltyMin: number;
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

  // Gün/sn/tur/dk — string state → int parse + aralık doğrulama.
  const capDaysNum = Number(capDays);
  const capDaysValid =
    capDays.trim() !== "" &&
    Number.isInteger(capDaysNum) &&
    capDaysNum >= 0 &&
    capDaysNum <= MAX_ABSOLUTE_CAP_DAYS;
  const inRangeInt = (raw: string, min: number, max: number) => {
    const n = Number(raw);
    return raw.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
  };
  const pinAttemptsValid = inRangeInt(pinAttempts, MIN_PIN_LOCKOUT_ATTEMPTS, MAX_PIN_LOCKOUT_ATTEMPTS);
  const pinPenaltyValid = inRangeInt(
    pinPenaltySec,
    MIN_PIN_LOCKOUT_PENALTY_SEC,
    MAX_PIN_LOCKOUT_PENALTY_SEC,
  );
  const pinEscalateValid = inRangeInt(
    pinEscalate,
    MIN_PIN_LOCKOUT_ESCALATE_AFTER,
    MAX_PIN_LOCKOUT_ESCALATE_AFTER,
  );
  const pinLongValid = inRangeInt(
    pinLongMin,
    MIN_PIN_LOCKOUT_LONG_PENALTY_MIN,
    MAX_PIN_LOCKOUT_LONG_PENALTY_MIN,
  );
  // Kilit kapalıyken alt-alan geçerliliği zorunlu değil (input pasif; kayıtlı değer korunur).
  const pinValid =
    !pinEnabled || (pinAttemptsValid && pinPenaltyValid && pinEscalateValid && pinLongValid);

  const allValid =
    sessionValid &&
    idleValid &&
    workValid &&
    mobileLockMinValid &&
    methodsValid &&
    capDaysValid &&
    pinValid;

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
    methodsDirty ||
    capDaysNum !== currentCapDays ||
    pinEnabled !== currentPinEnabled ||
    Number(pinAttempts) !== currentPinAttempts ||
    Number(pinPenaltySec) !== currentPinPenaltySec ||
    Number(pinEscalate) !== currentPinEscalate ||
    Number(pinLongMin) !== currentPinLongMin;

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

  // Kilit kapalıyken alt-alan boş/geçersiz kalabilir → payload'da kayıtlı değere düş
  // (backend her alanı int + aralık ister; NaN göndermeyelim).
  const safeInt = (raw: string, fallback: number) => {
    const n = Number(raw);
    return Number.isInteger(n) ? n : fallback;
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
      absoluteSessionCapDays: capDaysNum,
      pinLockoutEnabled: pinEnabled,
      pinLockoutAttempts: safeInt(pinAttempts, currentPinAttempts),
      pinLockoutPenaltySec: safeInt(pinPenaltySec, currentPinPenaltySec),
      pinLockoutEscalateAfter: safeInt(pinEscalate, currentPinEscalate),
      pinLockoutLongPenaltyMin: safeInt(pinLongMin, currentPinLongMin),
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
    capDays, setCapDays,
    pinEnabled, setPinEnabled,
    pinAttempts, setPinAttempts,
    pinPenaltySec, setPinPenaltySec,
    pinEscalate, setPinEscalate,
    pinLongMin, setPinLongMin,
    // doğrulama
    sessionValid, idleValid, workValid, mobileLockMinValid, methodsValid, allValid, dirty,
    capDaysValid, pinAttemptsValid, pinPenaltyValid, pinEscalateValid, pinLongValid,
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
      capDays: currentCapDays,
      pinEnabled: currentPinEnabled,
      pinAttempts: currentPinAttempts,
      pinPenaltySec: currentPinPenaltySec,
      pinEscalate: currentPinEscalate,
      pinLongMin: currentPinLongMin,
    },
  };
}
