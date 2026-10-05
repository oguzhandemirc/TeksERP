// LAN TLS kipi `.env`den açılışta okunur (docs/design/LAN-TLS.md §5). Varsayılan `off` = bugünkü davranış:
// yalnız HTTP. Tanınmayan değer uyarı basar ve `off`a düşer — yazım hatası fabrikayı kilitlemesin.
import path from "node:path";
import { resolveLicenseDir } from "../license/store";

export type LanTlsMode = "off" | "dual" | "required";

export const LAN_TLS_DEFAULT_PORT = 4443;
const LOOPBACK = "127.0.0.1";

export interface LanTlsConfig {
  mode: LanTlsMode;
  /** HTTPS dinleyici portu (`off`ta da çözülür, kullanılmaz). */
  port: number;
  /** HTTP dinleyicinin bağlanacağı adres: `required`da yalnız döngü adresi. */
  httpHost: string;
  /** Sertifika deposu; çözülemediyse null + `dirProblem`. */
  dir: string | null;
  dirProblem: string | null;
}

const MODES: Record<string, LanTlsMode> = {
  off: "off", kapali: "off", "kapalı": "off",
  dual: "dual", ikili: "dual",
  required: "required", zorunlu: "required",
};

export function readLanTlsConfig(
  env: NodeJS.ProcessEnv,
  baseHttpHost: string,
  onWarn: (message: string) => void,
): LanTlsConfig {
  const rawMode = (env.LAN_TLS_MODE ?? "").trim().toLowerCase();
  let mode: LanTlsMode = "off";
  if (rawMode) {
    const m = MODES[rawMode];
    if (m) mode = m;
    else onWarn(`[lan-tls] LAN_TLS_MODE="${env.LAN_TLS_MODE}" anlaşılmadı — off sayıldı (yalnız HTTP).`);
  }

  let port = LAN_TLS_DEFAULT_PORT;
  const rawPort = (env.LAN_TLS_PORT ?? "").trim();
  if (rawPort) {
    const n = Number(rawPort);
    if (Number.isInteger(n) && n > 0 && n < 65536) port = n;
    else onWarn(`[lan-tls] LAN_TLS_PORT="${rawPort}" geçersiz — ${LAN_TLS_DEFAULT_PORT} kullanıldı.`);
  }
  if (mode !== "off" && String(port) === String(env.PORT ?? "4000").trim()) {
    onWarn(`[lan-tls] LAN_TLS_PORT HTTP portuyla aynı (${port}) — off sayıldı.`);
    mode = "off";
  }

  let dir: string | null = null;
  let dirProblem: string | null = null;
  const configured = env.LAN_TLS_DIR?.trim();
  if (configured) {
    dir = path.resolve(configured);
  } else {
    // Lisans deposu program/yedek dizinindeyse (güncelleyici siler) TLS deposu da kurulmaz.
    const lic = resolveLicenseDir(env);
    if (lic.problem) dirProblem = `lisans dizini kullanılamaz (${lic.problem})`;
    else dir = path.join(lic.dir, "lan-tls");
  }

  return { mode, port, httpHost: mode === "required" ? LOOPBACK : baseHttpHost, dir, dirProblem };
}
