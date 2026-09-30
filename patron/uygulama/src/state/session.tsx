// Oturum bağlamı: belirteç (gizli depo) + tesis durumu (`GET /oturum`) + izinler. Çevrimdışıyken son
// oturum görüntüsü önbellekten gelir ve YAZMA kapalıdır. 401 → belirteç silinir, giriş ekranı.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, createClient } from "../api/client";
import { createApi, type Api } from "../api/endpoints";
import type { FacilityStatus } from "../api/wire";
import { apiBaseUrl } from "../lib/config";
import { clearCache, createCache, type Cache } from "./cache";
import { plainStore, secretStore } from "./store";
import { setFactoryTimezone } from "../lib/factory-time";

const TOKEN_KEY = "patron.belirtec";
const SCOPE_KEY = "patron.kapsam";

export type Phase = "yukleniyor" | "giris" | "hazir";

export interface SessionValue {
  readonly phase: Phase;
  readonly api: Api;
  readonly cache: Cache | null;
  readonly facility: FacilityStatus | null;
  readonly permissions: readonly string[];
  readonly offline: boolean;
  readonly offlineSince: string | null;
  readonly configured: boolean;
  markOnline(online: boolean, savedAt?: string): void;
  login(b: { eposta: string; parola: string; totp: string }): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

/**
 * Tesisin saat dilimi (ANLIK `tesis` → `saatDilimi`): bütün tarih/saat gösterimi fabrikanın diliminden yapılır,
 * telefonun diliminden değil. Best-effort — projeksiyon henüz yoksa (eski fabrika sürümü) varsayılan dilim kalır.
 */
async function loadFacilityTimezone(c: Cache, api: Api): Promise<void> {
  try {
    const r = await c.load("anlik:tesis", () => api.snapshot("tesis"));
    const veri = r.data.veri as { saatDilimi?: unknown } | null;
    setFactoryTimezone(veri?.saatDilimi);
  } catch {
    // Dilim okunamadı: son geçerli (ya da varsayılan) dilimle devam.
  }
}

export function SessionProvider({ children, platform = "mobil" }: { children: ReactNode; platform?: "mobil" | "web" }) {
  const token = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("yukleniyor");
  const [facility, setFacility] = useState<FacilityStatus | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const base = apiBaseUrl();

  const reset = useCallback(async () => {
    token.current = null;
    await secretStore.remove(TOKEN_KEY).catch(() => undefined);
    await secretStore.remove(SCOPE_KEY).catch(() => undefined);
    await clearCache(plainStore);
    setFacility(null);
    setScope(null);
    setPhase("giris");
  }, []);

  const api = useMemo(
    () => createApi(createClient({ baseUrl: base ?? "http://yapilandirilmamis.invalid", getToken: () => token.current, onUnauthorized: () => { if (token.current) void reset(); } })),
    [base, reset],
  );
  const cache = useMemo(() => (scope ? createCache(plainStore, scope) : null), [scope]);

  const markOnline = useCallback((online: boolean, savedAt?: string) => {
    setOffline(!online);
    setOfflineSince(online ? null : (savedAt ?? null));
  }, []);

  const loadFacility = useCallback(
    async (c: Cache) => {
      const r = await c.load("oturum", () => api.session());
      await loadFacilityTimezone(c, api);
      setFacility(r.data);
      markOnline(!r.offline, r.savedAt);
    },
    [api, markOnline],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [t, s] = await Promise.all([secretStore.get(TOKEN_KEY).catch(() => null), secretStore.get(SCOPE_KEY).catch(() => null)]);
      if (!alive) return;
      if (!t || !s) return setPhase("giris");
      token.current = t;
      setScope(s);
      try {
        await loadFacility(createCache(plainStore, s));
        if (alive) setPhase("hazir");
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.kind === "OTURUM") return; // reset zaten koştu
        setPhase("giris");
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadFacility]);

  const login = useCallback(
    async (b: { eposta: string; parola: string; totp: string }) => {
      const r = await api.login({ ...b, istemci: platform });
      await clearCache(plainStore);
      token.current = r.belirtec;
      const s = `${r.tesisId}:${r.hesap.id}`;
      await secretStore.set(TOKEN_KEY, r.belirtec).catch(() => undefined);
      await secretStore.set(SCOPE_KEY, s).catch(() => undefined);
      setScope(s);
      await loadFacility(createCache(plainStore, s));
      setPhase("hazir");
    },
    [api, loadFacility, platform],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    await reset();
  }, [api, reset]);

  const refresh = useCallback(async () => {
    if (cache) await loadFacility(cache);
  }, [cache, loadFacility]);

  const value: SessionValue = {
    phase,
    api,
    cache,
    facility,
    permissions: facility?.hesap.izinler ?? [],
    offline,
    offlineSince,
    configured: base !== null,
    markOnline,
    login,
    logout,
    refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("SessionProvider eksik");
  return v;
}
