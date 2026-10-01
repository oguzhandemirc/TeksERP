// =============================================================================
// jwt-sir — JWT sırrı denetimi ve yenilemesi (sunucu paketinde dist/tools/jwt-sir.cjs)
// =============================================================================
// Kullanım:
//   denetle --env <.env yolu>            0 kabul · 2 UYARI (bilinen/zayıf: backend açılır, sır
//                                        döndürülmeli) · 3 RET (yok/kısa: açılmaz) · 1 ölçülemedi
//   yenile  --env <.env yolu> [--apply]  dry-run varsayılan; --apply yeni rastgele sır yazar
// Rotasyon reçetesi (docs/ops/JWT-SIR-ROTASYONU.md) bunu çağırır; karar backend açılışıyla
// AYNI yüklemden (`src/lib/jwt-secret.ts`).
// Sır değeri hiçbir koşulda ekrana basılmaz. Çıktı ASCII (Windows konsol kod sayfası).
// =============================================================================

import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import { checkJwtSecret, type JwtSecretVerdict } from "../src/lib/jwt-secret";

export const CIKIS_KABUL = 0;
export const CIKIS_OLCULEMEDI = 1;
export const CIKIS_UYARI = 2;
export const CIKIS_RET = 3;

const RET_ACIKLAMA: Record<string, string> = {
  EKSIK: "JWT_SECRET tanimli degil",
  KISA: "JWT_SECRET 32 karakterden kisa",
  ZAYIF: "JWT_SECRET tahmin edilebilir (cok az farkli karakter)",
  BILINEN: "JWT_SECRET depoda/ornek dosyalarda yazan BILINEN bir deger (token sahtelenebilir)",
};

/** .env metnindeki JWT_SECRET'ı backend açılışıyla aynı yüklemden geçirir. */
export function envMetniniDenetle(metin: string): JwtSecretVerdict {
  return checkJwtSecret(parse(metin).JWT_SECRET);
}

/** JWT_SECRET satır(lar)ını verilen sırla değiştirir (yoksa ekler); satır sonu biçimini korur. */
export function envMetnindeSirriYenile(metin: string, yeniSir: string): string {
  const eol = metin.includes("\r\n") ? "\r\n" : "\n";
  const satir = `JWT_SECRET="${yeniSir}"`;
  // Bütün satırlar: dotenv aynı anahtarda SONUNCUYU okur, yalnız ilkini değiştirmek yetmez.
  const desen = /^[ \t]*JWT_SECRET[ \t]*=.*$/gm;
  if (desen.test(metin)) return metin.replace(desen, satir);
  const ayrac = metin.length === 0 || metin.endsWith("\n") ? "" : eol;
  return `${metin}${ayrac}${satir}${eol}`;
}

export function yeniJwtSirri(): string {
  return randomBytes(32).toString("hex");
}

function argDegeri(argv: string[], ad: string): string | undefined {
  const i = argv.indexOf(ad);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv: string[]): number {
  const komut = argv[0];
  const envYolu = argDegeri(argv, "--env");
  if ((komut !== "denetle" && komut !== "yenile") || !envYolu) {
    console.error("Kullanim: jwt-sir denetle --env <.env> | jwt-sir yenile --env <.env> [--apply]");
    return CIKIS_OLCULEMEDI;
  }
  let metin: string;
  try {
    metin = fs.readFileSync(envYolu, "utf8");
  } catch {
    console.error(`X .env okunamadi: ${envYolu}`);
    return CIKIS_OLCULEMEDI;
  }
  const karar = envMetniniDenetle(metin);

  if (komut === "denetle") {
    if (karar.ok) {
      console.log("OK JWT_SECRET kabul edildi");
      return CIKIS_KABUL;
    }
    if (karar.kod === "BILINEN" || karar.kod === "ZAYIF") {
      console.log(`UYARI ${karar.kod}: ${RET_ACIKLAMA[karar.kod]} - backend acilir, sir dondurulmeli`);
      return CIKIS_UYARI;
    }
    console.log(`RET ${karar.kod}: ${RET_ACIKLAMA[karar.kod]} - backend ACILMAZ`);
    return CIKIS_RET;
  }

  const durum = karar.ok ? "kabul ediliyor" : `RET (${karar.kod})`;
  if (!argv.includes("--apply")) {
    console.log(`Mevcut JWT_SECRET: ${durum}`);
    console.log("DRY-RUN: --apply ile yeni rastgele sir yazilir. Backend yeniden baslayinca");
    console.log("         BUTUN oturumlar duser (panel + tablet yeniden giris yapar).");
    return CIKIS_KABUL;
  }
  const yeni = yeniJwtSirri();
  const yeniMetin = envMetnindeSirriYenile(metin, yeni);
  if (!envMetniniDenetle(yeniMetin).ok) {
    console.error("X Uretilen sir denetimden gecmedi - dosyaya yazilmadi.");
    return CIKIS_OLCULEMEDI;
  }
  // Yerinde yazım: dosyanın izinleri (Windows ACL / chmod 600) korunur.
  fs.writeFileSync(envYolu, yeniMetin, "utf8");
  console.log(`OK JWT_SECRET yenilendi (onceki: ${durum}). Backend'i yeniden baslatin.`);
  return CIKIS_KABUL;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
