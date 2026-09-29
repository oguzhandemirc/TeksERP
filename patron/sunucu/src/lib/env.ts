// `.env` paket kökünden (src/ ya da dist/ bir üstü) okunur — çalışma dizininden bağımsız.
// Var olan ortam değişkeninin ÜSTÜNE YAZMAZ (bekçi kendi DATABASE_URL'ini verebilsin).
import path from "node:path";
import { config as loadDotenv } from "dotenv";

export const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

let loaded = false;
export function loadEnvFile(): void {
  if (loaded) return;
  loadDotenv({ path: path.join(PACKAGE_ROOT, ".env"), quiet: true });
  loaded = true;
}
