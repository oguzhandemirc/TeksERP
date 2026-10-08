import { useEffect, useState } from "react";
import type { TlsPin } from "@shared/lan-tls";
import { DISCOVERY_DEFAULT_PORT } from "@shared/discovery";
import {
  getActiveApiBaseUrl,
  getRecentApiBaseUrls,
  joinApiBaseUrl,
  splitApiBaseUrl,
  type ApiBaseUrlParts,
} from "@/lib/api-config";
import { httpAllowed, partsForMode, serverModeFor, upgradeForNetwork, type ServerMode } from "@/lib/server-mode";

export type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; message: string }
  | { status: "fail"; message: string };

const EMPTY: ApiBaseUrlParts = { protocol: "https", host: "", port: "" };

/** Bir adresin alanları + modu + Bulut'ta port kilidi — açılış, son kullanılan ve keşif seçimi aynı yoldan. */
function stateFor(pins: readonly TlsPin[], url: string) {
  const parts = splitApiBaseUrl(url);
  const mode = serverModeFor(pins, joinApiBaseUrl(parts));
  return { parts, mode, portLocked: mode === "bulut" && !parts.port };
}

/** Sunucu Adresi penceresinin alan durumu. Mod adresten türer (`serverModeFor`); kullanıcı seçimi alanları sadeleştirir. */
export function useServerAddressForm(open: boolean) {
  const [parts, setParts] = useState<ApiBaseUrlParts>(EMPTY);
  const [mode, setMode] = useState<ServerMode>("fabrika");
  const [portLocked, setPortLocked] = useState(false);
  const [pins, setPins] = useState<TlsPin[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const load = (url: string, p: readonly TlsPin[] = pins) => {
    const s = stateFor(p, url);
    setParts(s.parts);
    setMode(s.mode);
    setPortLocked(s.portLocked);
    setTest({ status: "idle" });
  };

  useEffect(() => {
    if (!open) return;
    load(getActiveApiBaseUrl());
    void getRecentApiBaseUrls().then(setRecent);
    const api = window.api?.discovery;
    if (api?.tlsPins) void api.tlsPins().then(setPins).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız açılışta
  }, [open]);

  const changeMode = (m: ServerMode) => {
    setMode(m);
    setParts((p) => partsForMode(m, p));
    setPortLocked(m === "bulut");
    setTest({ status: "idle" });
  };

  /** Yapıştırılan tam adres parçalara dağılır ve modunu kendisi seçer; yazılan ad Fabrika içinde şifreliye yükselir. */
  const changeHost = (raw: string) => {
    setTest({ status: "idle" });
    if (/[:/]/.test(raw)) {
      const p = splitApiBaseUrl(raw);
      const next = /:\/\//.test(raw) ? p : { ...p, protocol: parts.protocol };
      const s = stateFor(pins, joinApiBaseUrl(next));
      setParts(next);
      setMode(s.mode);
      setPortLocked(s.portLocked);
      return;
    }
    const next = { ...parts, host: raw };
    setParts(mode === "fabrika" ? upgradeForNetwork(pins, next, String(DISCOVERY_DEFAULT_PORT)) : next);
  };

  return {
    parts,
    mode,
    portLocked,
    pins,
    recent,
    setRecent,
    test,
    setTest,
    composed: joinApiBaseUrl(parts),
    httpOk: httpAllowed(pins, parts),
    load,
    changeMode,
    changeHost,
    setProtocol: (protocol: "http" | "https") => {
      setParts((p) => ({ ...p, protocol }));
      setTest({ status: "idle" });
    },
    setPort: (port: string) => {
      setParts((p) => ({ ...p, port }));
      setTest({ status: "idle" });
    },
    unlockPort: () => setPortLocked(false),
  };
}
