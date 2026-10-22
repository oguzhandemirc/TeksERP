// Değişim akışı rotası (patron v2 K1) — hesap API'si tablosunun parçası (`API_ROUTES`e yayılır).
// Uzun yoklama içerik taşımaz, ≤ 25 sn bekler; istemci koparsa bekleme hemen bırakılır (hub sızmaz).
import { MAX_WAIT_SECONDS, pollChanges } from "../services/change-feed";
import { nonNegativeInt, s, type ApiRouteDef } from "./api-route-kit";

export const CHANGE_ROUTES: readonly ApiRouteDef[] = [
  {
    method: "get",
    path: "/degisim",
    auth: "OTURUM",
    kimlik: "OKUMA",
    handler: async (c) => {
      const since = nonNegativeInt(c, "since", 0);
      const waitSeconds = Math.min(nonNegativeInt(c, "bekle", MAX_WAIT_SECONDS), MAX_WAIT_SECONDS);
      const gone = new AbortController();
      const onClose = (): void => gone.abort();
      c.req.res?.once("close", onClose);
      try {
        return { data: await pollChanges(c.ctx, s(c), { since, waitMs: waitSeconds * 1000, signal: gone.signal }) };
      } finally {
        c.req.res?.off("close", onClose);
      }
    },
  },
];
