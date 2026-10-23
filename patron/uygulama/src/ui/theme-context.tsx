// Tema: sistem görünümünü izler; kullanıcı tercihi (Sistem · Açık · Koyu) düz depoda `patron.tema` anahtarında.
// Sağlayıcı yoksa (testler, erken açılış) açık tema döner — bileşenler sağlayıcısız da çizilir.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import type { KeyValue } from "../state/store";
import { light, schemes, type Scheme, type Tokens } from "./tokens";

export type ThemePref = "sistem" | "acik" | "koyu";
export const THEME_PREFS: readonly ThemePref[] = ["sistem", "acik", "koyu"];
export const THEME_PREF_LABEL: Readonly<Record<ThemePref, string>> = { sistem: "Sistem", acik: "Açık", koyu: "Koyu" };
export const THEME_KEY = "patron.tema";

interface ThemeValue {
  readonly tokens: Tokens;
  readonly pref: ThemePref;
  readonly setPref: (p: ThemePref) => void;
}

const ThemeContext = createContext<ThemeValue>({ tokens: light, pref: "sistem", setPref: () => undefined });

export function isThemePref(v: unknown): v is ThemePref {
  return typeof v === "string" && (THEME_PREFS as readonly string[]).includes(v);
}

export function resolveScheme(pref: ThemePref, system: string | null | undefined): Scheme {
  if (pref === "acik") return "light";
  if (pref === "koyu") return "dark";
  return system === "dark" ? "dark" : "light";
}

export function ThemeProvider({ children, store }: { children: ReactNode; store?: Pick<KeyValue, "get" | "set"> }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>("sistem");

  useEffect(() => {
    if (!store) return;
    let live = true;
    store
      .get(THEME_KEY)
      .then((v) => {
        if (live && isThemePref(v)) setPrefState(v);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [store]);

  const setPref = useCallback(
    (p: ThemePref) => {
      setPrefState(p);
      void store?.set(THEME_KEY, p).catch(() => undefined);
    },
    [store],
  );

  const tokens = schemes[resolveScheme(pref, system)];
  const value = useMemo(() => ({ tokens, pref, setPref }), [tokens, pref, setPref]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTokens(): Tokens {
  return useContext(ThemeContext).tokens;
}

/** Profil ekranındaki "Sistem · Açık · Koyu" seçimi için. */
export function useThemePref(): { pref: ThemePref; setPref: (p: ThemePref) => void } {
  const { pref, setPref } = useContext(ThemeContext);
  return { pref, setPref };
}

/** Hareket azaltma açıksa yay yerine kısa solma kullanılır. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (live) setReduced(!!v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduced(!!v));
    return () => {
      live = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

/** Temaya bağlı stil fabrikası: her tema için bir kez kurulur (bileşen başına yeniden hesaplanmaz). */
export function makeStyles<T>(build: (t: Tokens) => T): () => T {
  const cache = new Map<Tokens, T>();
  return function useStyles(): T {
    const t = useTokens();
    let s = cache.get(t);
    if (!s) {
      s = build(t);
      cache.set(t, s);
    }
    return s;
  };
}
