// =============================================================================
// TeksERP - Mobil güncelleme deposu servisi (SALT DOSYA SERVİSİ)
// =============================================================================
// Bu servis manifest ÜRETMEZ. Yayın script'i (`mobil/scripts/lib/manifest.mjs`)
// manifest'i üretir, imzalar ve dondurur; buradaki iş yalnız o baytları güvenle
// diskten okumaktır.
//
// ⚠️ NEDEN BÖYLE — kod imzalama: `expo-updates` imzayı gövdenin HAM baytları
// üzerinden doğrular (`codesigning/CodeSigningConfiguration.kt:93-96`). Sunucu
// manifest'i yeniden üretseydi (alan sırası, boşluk, tarih biçimi) baytlar
// değişir, imza tutmaz ve tablet paketi REDDEDERDİ. Bu kısıt, "iki ayrı
// protokol implementasyonu" riskini de kendiliğinden kapatır.
// =============================================================================

import fs from "fs";
import fsp from "fs/promises";
import path from "path";

import { MOBILE_UPDATE_ROOT } from "../config/mobile-update";
import { AppError } from "../utils/app-error";

/* ------------------------------------------------------------------ *
 * MIME — küçük ve AÇIK harita
 * ------------------------------------------------------------------ */
// Yeni bağımlılık (`mime`) yerine harita: `expo export` çıktısındaki uzantı
// kümesi dar (bugün png/ttf/wav) ve bilinmeyen uzantı yanlış tipe değil nötr
// `application/octet-stream`e düşer — istemci varlığı yine doğru indirir.
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  json: "application/json",
  txt: "text/plain",
  apk: "application/vnd.android.package-archive",
  hbc: "application/javascript",
  js: "application/javascript",
};

export function mimeCoz(ext: string): string {
  return MIME[ext.replace(/^\./, "").toLowerCase()] ?? "application/octet-stream";
}

/* ------------------------------------------------------------------ *
 * Yol çözümü — DEPO DIŞINA ÇIKIŞ YOK
 * ------------------------------------------------------------------ */

/**
 * Depo içindeki göreli yolu mutlak yola çevirir.
 *
 * ⚠️ Yol İSTEMCİDEN gelir. `..` ile sunucunun herhangi bir dosyası
 * istenebilirdi; bu yüzden çözülen yolun kökün ALTINDA kaldığı doğrulanır ve
 * doğrulama `path.resolve` SONRASINDA yapılır (öncesinde yapılan bir kontrol
 * kodlanmış/karışık ayırıcılı yolları kaçırır).
 */
export function dosyaYolu(gorelYol: string): string {
  const temiz = String(gorelYol ?? "").replace(/^\/+/, "");
  if (!temiz) throw AppError.badRequest("Yol gerekli");

  const kok = path.resolve(MOBILE_UPDATE_ROOT);
  const istenen = path.resolve(kok, temiz);
  if (istenen !== kok && !istenen.startsWith(kok + path.sep)) {
    throw AppError.badRequest("Geçersiz yol");
  }
  return istenen;
}

export interface DosyaBilgi {
  yol: string;
  contentType: string;
  boyut: number;
}

/** Dosyayı çözer; yoksa 404. Dizin istenirse de 404 (listeleme YOK). */
export async function dosyaBilgi(gorelYol: string): Promise<DosyaBilgi> {
  const yol = dosyaYolu(gorelYol);
  let st: fs.Stats;
  try {
    st = await fsp.stat(yol);
  } catch {
    throw AppError.notFound("Dosya bulunamadı");
  }
  if (!st.isFile()) throw AppError.notFound("Dosya bulunamadı");
  return {
    yol,
    contentType: mimeCoz(path.extname(yol)),
    boyut: st.size,
  };
}

/** `ota/<runtimeVersion>/manifest` — yayındaki donmuş manifest. */
export function manifestGorelYolu(runtimeVersion: string): string {
  const rv = String(runtimeVersion ?? "").trim();
  if (!rv || !/^[A-Za-z0-9._-]+$/.test(rv) || rv === "." || rv === "..") {
    throw AppError.badRequest("Geçersiz runtimeVersion");
  }
  return `ota/${rv}/manifest`;
}

/* ------------------------------------------------------------------ *
 * Yönetim görünümü (panel için)
 * ------------------------------------------------------------------ */

export interface DepoDurumu {
  kok: string;
  varMi: boolean;
  surumler: { runtimeVersion: string; yayinda: boolean; damgalar: string[] }[];
  apk: { versionCode?: number; versionName?: string; dosya?: string } | null;
}

export async function depoDurumu(): Promise<DepoDurumu> {
  const kok = MOBILE_UPDATE_ROOT;
  const otaKok = path.join(kok, "ota");
  const surumler: DepoDurumu["surumler"] = [];

  if (fs.existsSync(otaKok)) {
    for (const d of await fsp.readdir(otaKok, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(otaKok, d.name);
      const icerik = await fsp.readdir(dir, { withFileTypes: true });
      surumler.push({
        runtimeVersion: d.name,
        yayinda: fs.existsSync(path.join(dir, "manifest")),
        damgalar: icerik
          .filter((x) => x.isDirectory())
          .map((x) => x.name)
          // Damgalar epoch-ms → SAYISAL sırala. Sözlüksel sıra uzunluk
          // değiştiğinde yanlış cevap verir (parti numarası dersi).
          .sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0)),
      });
    }
  }

  let apk: DepoDurumu["apk"] = null;
  try {
    apk = JSON.parse(await fsp.readFile(path.join(kok, "apk", "surum.json"), "utf8"));
  } catch {
    /* künye yoksa null */
  }

  return { kok, varMi: fs.existsSync(kok), surumler, apk };
}
