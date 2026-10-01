// Test düzeneği — uygulamayı GERÇEK köküyle (AppRoot: oturum + önbellek + yönlendirici) sahte bir
// sunucuya karşı çizer. Sahte sunucu yalnız tanımlı uçlara yanıt verir; tanımsız uç testi düşürür
// (arayüzün beklenmedik bir uca gitmesi sessiz kalmasın). Her istek kaydedilir (yol + gövde).
import { render } from "@testing-library/react";
import { createMemoryRouter, type RouteObject } from "react-router-dom";
import type { ApiBase } from "../shared/api";
import { AppRoot } from "../shared/AppRoot";
import type { PortalRole } from "../shared/permissions";
import type { SessionInfo } from "../shared/session";

export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | undefined;
}

export type Reply = { readonly status?: number; readonly data?: unknown; readonly code?: string; readonly message?: string; readonly details?: Readonly<Record<string, unknown>> };
export type Handler = (req: Recorded, calls: readonly Recorded[]) => Reply | Promise<Reply>;

export function sessionFor(role: PortalRole, over: Partial<SessionInfo["kullanici"]> = {}): SessionInfo {
  return {
    kullanici: { id: "00000000-0000-4000-8000-00000000000a", kullaniciAdi: "deneme", adSoyad: "Deneme Kullanıcı", rol: role, bayiId: role === "BAYI" ? "00000000-0000-4000-8000-0000000000b1" : null, ...over },
    dinleyici: role === "BAYI" ? "GENEL" : "TAILNET",
    bitis: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

export function fakeServer(base: ApiBase, handlers: Record<string, Handler>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://portal.test");
    if (!url.pathname.startsWith(base)) throw new Error(`Beklenmeyen taban: ${url.pathname}`);
    const path = url.pathname.slice(base.length) + url.search;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    const rec: Recorded = { method, path, body };
    calls.push(rec);
    const key = `${method} ${url.pathname.slice(base.length)}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Sahte sunucuda tanımsız uç: ${key}`);
    const r = await handler(rec, calls);
    const status = r.status ?? 200;
    const payload = status >= 400 ? { success: false, message: r.message ?? "Hata", details: { ...r.details, code: r.code ?? "BILINMEYEN" } } : { success: true, data: r.data ?? null };
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

export function renderApp(opts: { base: ApiBase; routes: RouteObject[]; path?: string; handlers: Record<string, Handler> }) {
  const server = fakeServer(opts.base, opts.handlers);
  const utils = render(
    <AppRoot
      base={opts.base}
      product="Deneme Portalı"
      routes={opts.routes}
      createRouter={(routes) => createMemoryRouter(routes, { initialEntries: [opts.path ?? "/"] })}
      fetchImpl={server.fetchImpl}
    />,
  );
  return { ...utils, calls: server.calls };
}

export const ok = (data: unknown): Handler => () => ({ data });
export const writes = (calls: readonly Recorded[]) => calls.filter((c) => c.method !== "GET");
