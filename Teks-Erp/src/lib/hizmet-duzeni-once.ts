// dotenv'den ÖNCE yüklenir (server.ts ilk import): hizmet düzeninde `.env` sürüm dizininde değil
// `<Kök>/yapilandirma/`dadır ve dotenv yolu `DOTENV_CONFIG_PATH`ten okur. pm2/geliştirmede no-op.
import { resolveEnvFilePath, resolveServiceRoot } from "./hizmet-duzeni";
import { hata } from "./logger";

const layout = resolveServiceRoot(process.env);
if (layout.error) {
  // Düzen belirsizken yanlış dizine yazmaktansa açılmamak (fail-closed).
  hata("hizmet-duzeni", layout.error);
  process.exit(1);
}
if (layout.root && !process.env.DOTENV_CONFIG_PATH?.trim()) {
  process.env.DOTENV_CONFIG_PATH = resolveEnvFilePath(process.env, process.cwd());
}

/** Node `NODE_USE_SYSTEM_CA`yı yalnız açılışta okur: `.env`den gelen değer etkisizdir. */
export const SYSTEM_CA_AT_STARTUP = process.env.NODE_USE_SYSTEM_CA === "1";
