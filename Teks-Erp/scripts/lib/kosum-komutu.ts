// Yayın günü betiği iki yerden koşar: kaynaktan (`npx tsx scripts/<ad>.ts`) ve paketteki
// derlemeden (`node dist/tools/<ad>.cjs`). Bastığı "şunu koşun" satırı ve döküm yeri
// koşulan yola göre seçilir — sunucuda `npx tsx` ipucu çalışmaz. bkz. arşiv 2026-09-27 thinkpad-1 provası
import { resolve } from "node:path";

/** Süreç paketteki derlemeden mi koşuyor (giriş dosyası `.cjs`). */
export function paketlenmisArac(): boolean {
  return /\.cjs$/i.test(process.argv[1] ?? "");
}

/** Operatöre basılacak koşum komutu (argümansız). */
export function kosumKomutu(ad: string): string {
  return paketlenmisArac() ? `node dist/tools/${ad}.cjs` : `npx tsx scripts/${ad}.ts`;
}

/** Döküm dizini: pakette `app\` her sürümde kenara alınır ⇒ kurulum kökünün `logs\yayin-gunu`su (cwd `app\`). */
export function ciktiDizini(): string {
  return paketlenmisArac()
    ? resolve(process.cwd(), "..", "logs", "yayin-gunu")
    : resolve(__dirname, "..", "out");
}
