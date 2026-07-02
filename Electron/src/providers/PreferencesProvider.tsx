import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth";
import { fetchPreferences, savePreferences } from "@/services/preferencesService";
import { DEFAULT_PREFERENCES, type AppPreferences } from "@/types/preferences";

const SAVE_DEBOUNCE_MS = 600;

interface PreferencesContextValue {
  prefs: AppPreferences;
  setPreference: (patch: Partial<AppPreferences>) => void;
  resetPreferences: () => void;
  ready: boolean;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/** Accent rengini :root CSS değişkenlerine yazar (null = token varsayılanı). */
function applyAccent(accent: string | null | undefined): void {
  const root = document.documentElement;
  const vars = ["--primary", "--brand", "--ring"];
  if (accent) {
    for (const v of vars) root.style.setProperty(v, accent);
  } else {
    for (const v of vars) root.style.removeProperty(v);
  }
}

/** Yoğunluğu <html data-density> ile işaretler — index.css ölçeği uygular. */
function applyDensity(density: AppPreferences["density"]): void {
  document.documentElement.dataset.density = density ?? "comfortable";
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.isHydrated);
  const { setTheme } = useTheme();

  const enabled = hydrated && !!user;
  const queryKey = useMemo(() => ["preferences", user?.userId] as const, [user?.userId]);

  // Oturum başına TEK fetch: staleTime Infinity → otomatik refetch yok (navigasyon/
  // focus/istek başına tekrar çekmez). gcTime Infinity → önbellek hiç atılmaz.
  // Değişiklikler bellekteki kopyaya yazılır + debounce'lu tek PUT ile kaydedilir.
  const { data, isFetched } = useQuery({
    queryKey,
    queryFn: fetchPreferences,
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Oturum kapalıyken her zaman varsayılan (önceki kullanıcının değerleri sızmaz).
  const prefs = (enabled ? data : undefined) ?? DEFAULT_PREFERENCES;
  const ready = !enabled || isFetched;

  // Accent + yoğunluğu DOM'a uygula.
  useEffect(() => {
    applyAccent(prefs.accent);
    applyDensity(prefs.density);
  }, [prefs.accent, prefs.density]);

  // Tema senkronu — yalnız oturum açık ve tercih yüklendiğinde.
  useEffect(() => {
    if (enabled && isFetched && prefs.theme) setTheme(prefs.theme);
  }, [enabled, isFetched, prefs.theme, setTheme]);

  // Debounce'lu backend kaydı.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<AppPreferences | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const setPreference = useCallback(
    (patch: Partial<AppPreferences>) => {
      const current = queryClient.getQueryData<AppPreferences>(queryKey) ?? DEFAULT_PREFERENCES;
      const next = { ...current, ...patch };
      queryClient.setQueryData(queryKey, next); // anında UI + DOM (effect)
      if (!user) return;
      pendingRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const toSave = pendingRef.current;
        if (toSave)
          void savePreferences(toSave).catch(() =>
            // Sabit id → arka arkaya başarısız kayıtlarda toast yığılmaz, tek satır güncellenir.
            toast.error("Tercihlerin kaydedilemedi. Bağlantını kontrol et.", {
              id: "prefs-save-error",
            }),
          );
      }, SAVE_DEBOUNCE_MS);
    },
    [queryClient, queryKey, user],
  );

  const resetPreferences = useCallback(() => {
    queryClient.setQueryData(queryKey, DEFAULT_PREFERENCES);
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = DEFAULT_PREFERENCES;
    if (user)
      void savePreferences(DEFAULT_PREFERENCES).catch(() =>
        toast.error("Tercihler sıfırlanamadı. Bağlantını kontrol et.", {
          id: "prefs-save-error",
        }),
      );
    // Lokal saklanan tercihler de sıfırlansın.
    try {
      localStorage.removeItem("sidebar.collapsed");
      localStorage.removeItem("dashboard.layout.v2");
      localStorage.removeItem("notifications.lastSeen");
    } catch {
      /* sessiz geç */
    }
  }, [queryClient, queryKey, user]);

  const value = useMemo<PreferencesContextValue>(
    () => ({ prefs, setPreference, resetPreferences, ready }),
    [prefs, setPreference, resetPreferences, ready],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}

/** Provider dışında (test/izole render) THROW etmeyen varyant — null döner.
 *  Tercihe "varsa kullan" diye bakan hook'lar için (örn. useMachineScale yerel kantar). */
export function usePreferencesOptional(): PreferencesContextValue | null {
  return useContext(PreferencesContext);
}
