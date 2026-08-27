/**
 * Uygulama sürümü (package.json).
 *
 * pm2 derlenmiş `server.js`'i doğrudan çalıştırır (npm script üzerinden değil) →
 * `npm_package_version` env'i ÜRETİMDE TANIMSIZDIR; bu yüzden dosyadan okunur.
 *
 * `app.ts` içinde yerel bir `let` idi; servis keşfi kimlik ucu da aynı sürümü
 * basmak zorunda olduğu için buraya alındı — `app.ts`'ten import etmek döngü
 * yaratırdı (app → routes → discovery.service → app).
 */
import fs from "fs";
import path from "path";

function readVersion(): string {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
        if (pkg?.version) return String(pkg.version);
    } catch {
        /* package.json okunamazsa varsayılan sürümle devam */
    }
    return "1.0.0";
}

/** Modül yükünde bir kez okunur — sürüm süreç ömrü boyunca değişmez. */
export const APP_VERSION = readVersion();
