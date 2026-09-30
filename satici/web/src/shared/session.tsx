// Oturum: çerez httpOnly (JS göremez) — durum sunucudan okunur (GET /oturum). Oturum düşünce
// (401 OTURUM_YOK) ya da çıkışta önbellek TEMİZLENİR: önceki kullanıcının verisi ekranda kalmaz.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createApiClient, type ApiBase, type ApiClient } from "./api";
import type { PortalPermission, PortalRole } from "./permissions";
import { canUse } from "./permissions";

export interface SessionUser {
  readonly id: string;
  readonly kullaniciAdi: string;
  readonly adSoyad: string;
  readonly rol: PortalRole;
  readonly bayiId: string | null;
}

/** Oturumun doğduğu dinleyici: TAILNET (tailnet/geri döngü) · ERISIM (Cloudflare Access arkası genel yol) · GENEL (bayi). */
export type SessionListener = "TAILNET" | "GENEL" | "ERISIM";

export interface SessionInfo {
  readonly kullanici: SessionUser;
  readonly dinleyici: SessionListener;
  readonly bitis: string;
}

export interface LoginInput {
  readonly kullaniciAdi: string;
  readonly parola: string;
  readonly totp: string;
}

type SessionState = { readonly status: "loading" } | { readonly status: "out"; readonly reason?: "expired" } | { readonly status: "in"; readonly session: SessionInfo };

interface SessionContextValue {
  readonly api: ApiClient;
  readonly state: SessionState;
  readonly login: (input: LoginInput) => Promise<void>;
  readonly logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ base, children, fetchImpl }: { base: ApiBase; children: ReactNode; fetchImpl?: typeof fetch }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const api = useMemo(
    () =>
      createApiClient(base, {
        fetchImpl,
        onSessionLost: () => {
          queryClient.clear();
          setState((s) => (s.status === "in" ? { status: "out", reason: "expired" } : s.status === "loading" ? { status: "out" } : s));
        },
      }),
    [base, fetchImpl, queryClient],
  );

  useEffect(() => {
    let alive = true;
    api
      .get<SessionInfo>("/oturum")
      .then((session) => alive && setState({ status: "in", session }))
      .catch(() => alive && setState({ status: "out" }));
    return () => {
      alive = false;
    };
  }, [api]);

  const login = useCallback(
    async (input: LoginInput) => {
      const session = await api.post<SessionInfo>("/oturum/ac", input);
      queryClient.clear();
      setState({ status: "in", session });
    },
    [api, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/oturum/kapat", {});
    } finally {
      queryClient.clear();
      setState({ status: "out" });
    }
  }, [api, queryClient]);

  const value = useMemo(() => ({ api, state, login, logout }), [api, state, login, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("SessionProvider eksik");
  return ctx;
}

export const useSession = useSessionContext;

export function useApi(): ApiClient {
  return useSessionContext().api;
}

/** Oturumdaki kullanıcı (yalnız girişli sayfalarda çağrılır). */
export function useUser(): SessionUser {
  const { state } = useSessionContext();
  if (state.status !== "in") throw new Error("Oturum yok");
  return state.session.kullanici;
}

/** Oturumun dinleyicisi (yalnız girişli sayfalarda çağrılır). */
export function useListener(): SessionListener {
  const { state } = useSessionContext();
  if (state.status !== "in") throw new Error("Oturum yok");
  return state.session.dinleyici;
}

/** Rol izni + dinleyici (ERİŞİM oturumunda hassas izinli ekran yok — permissions.ts `canUse`). */
export function useCan(permission: PortalPermission): boolean {
  const { state } = useSessionContext();
  return state.status === "in" && canUse(state.session.kullanici.rol, permission, state.session.dinleyici);
}
