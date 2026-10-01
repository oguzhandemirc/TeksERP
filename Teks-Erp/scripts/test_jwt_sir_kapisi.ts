// =============================================================================
// Bekçi: JWT sırrı kapısı (G20 — FAB-4 · SIR-3)
// =============================================================================
// Ölçer:
//   §1 Ret listesi biçimi (64 küçük hex, tekil) — değer değil ÖZET.
//   §2 Yüklem sınıfları: yok/kısa/zayıf/bilinen/temiz.
//   §3 İzlenen dosyalardaki her uzun JWT_SECRET değeri ret listesinde ya da zayıf
//      (yeni örnek değer eklenince kırmızı). Sentetik kontrol grubu her koşumda ısırır.
//   §4 Depo GEÇMİŞİNDEKİ her uzun değer reddediliyor (sığ klonda "ölçülemedi" beyanı).
//   §5 AÇILIŞ: bilinen/zayıf sır mevcut kurulumu DURDURMAZ (backend yüklenir, uyarı +
//      sağlık bayrağı); yok/kısa sır açılışı durdurur (bugünkü davranış).
//   §6 Yeni kurulum yolu (seed, geliştirme dışı) bilinen/zayıf sırrı reddeder.
//   §7 Paket aracı (`scripts/jwt-sir.ts`) aynı yüklemi kullanır; .env yenilemesi
//      satır sonunu korur, bütün satırları değiştirir, yeni sır kabul edilir.
// Sır değeri hiçbir çıktıya basılmaz — yalnız konum ve özet ön eki.
// DB'siz (açılış sondası sahte, bağlanılmayan bir DATABASE_URL ile alt süreçte koşar).
// =============================================================================

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  KNOWN_JWT_SECRET_DIGESTS,
  checkJwtSecret,
  jwtSecretDigest,
} from "../src/lib/jwt-secret";
import { envMetniniDenetle, envMetnindeSirriYenile, yeniJwtSirri } from "./jwt-sir";
import { git } from "./lib/git";
import { atlamaDefteri } from "./lib/atlama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));
const kisaOzet = (v: string): string => jwtSecretDigest(v).slice(0, 8);

const KOK = git(["rev-parse", "--show-toplevel"]).trim();
const BACKEND = join(KOK, "Teks-Erp");

// -----------------------------------------------------------------------------
// §1 Ret listesi biçimi
// -----------------------------------------------------------------------------
const ozetler = [...KNOWN_JWT_SECRET_DIGESTS];
check("§1a ret listesi en az 4 özet taşıyor", ozetler.length >= 4, `${ozetler.length}`);
check(
  "§1b her giriş 64 karakter küçük hex (DEĞER değil özet)",
  ozetler.every((o) => /^[0-9a-f]{64}$/.test(o)),
);
const kaynak = readFileSync(join(BACKEND, "src/lib/jwt-secret.ts"), "utf8");
check(
  "§1c kaynakta mükerrer özet yok",
  new Set(kaynak.match(/"[0-9a-f]{64}"/g) ?? []).size === (kaynak.match(/"[0-9a-f]{64}"/g) ?? []).length,
);

// -----------------------------------------------------------------------------
// §2 Yüklem sınıfları
// -----------------------------------------------------------------------------
const temiz = randomBytes(32).toString("hex");
const karar = (v: string | undefined, set?: ReadonlySet<string>) => {
  const k = checkJwtSecret(v, set);
  return k.ok ? "OK" : k.kod;
};
check("§2a rastgele 64-hex → kabul", karar(temiz) === "OK");
check("§2b yok → EKSIK", karar(undefined) === "EKSIK" && karar("") === "EKSIK");
check("§2c 31 karakter → KISA", karar(temiz.slice(0, 31)) === "KISA");
check("§2d az farklı karakter → ZAYIF", karar("ab".repeat(20)) === "ZAYIF");
const sentetik = randomBytes(24).toString("hex");
check(
  "§2e özeti listede olan değer → BILINEN (enjekte küme)",
  karar(sentetik, new Set([jwtSecretDigest(sentetik)])) === "BILINEN",
);
check(
  "§2f baştaki/sondaki boşluk özeti kaçırmaz",
  karar(` ${sentetik} `, new Set([jwtSecretDigest(sentetik)])) === "BILINEN",
);
const ret = checkJwtSecret("ab".repeat(20));
check("§2g ret mesajı değeri içermez", !ret.ok && !ret.mesaj.includes("abab"));

// -----------------------------------------------------------------------------
// §3 İzlenen dosyalardaki uzun JWT_SECRET değerleri
// -----------------------------------------------------------------------------
const LITERAL = /JWT_SECRET\s*[:=]\s*["']?([^"'\s`$<>{}()]+)/g;
type Dosya = { yol: string; icerik: string };
/** Reddedilmeyen (kabul edilen) uzun değerlerin KONUMLARI — değer dönmez. */
function kabulEdilenUzunDegerler(dosyalar: Dosya[]): string[] {
  const out: string[] = [];
  for (const d of dosyalar) {
    d.icerik.split("\n").forEach((satir, i) => {
      for (const m of satir.matchAll(LITERAL)) {
        const v = m[1];
        if (v.length < 32) continue;
        if (checkJwtSecret(v).ok) out.push(`${d.yol}:${i + 1} (sha ${kisaOzet(v)})`);
      }
    });
  }
  return out;
}
// Kontrol grubu: yeni bir rastgele örnek değer → tarayıcı ısırmalı.
const sondaDegeri = randomBytes(20).toString("hex");
const sonda = kabulEdilenUzunDegerler([{ yol: "SONDA/.env.example", icerik: `JWT_SECRET="${sondaDegeri}"\n` }]);
check("§3a kontrol grubu: yeni örnek değer yakalanıyor (tarayıcı kör değil)", sonda.length === 1);

const izlenen = git(["grep", "-l", "-I", "-E", "JWT_SECRET[[:space:]]*[:=]"], { cwd: KOK })
  .split("\n")
  .filter(Boolean);
const dosyalar: Dosya[] = izlenen.map((yol) => ({ yol, icerik: readFileSync(join(KOK, yol), "utf8") }));
const uzunSayisi = dosyalar.reduce(
  (n, d) => n + [...d.icerik.matchAll(LITERAL)].filter((m) => m[1].length >= 32).length,
  0,
);
const kabul = kabulEdilenUzunDegerler(dosyalar);
check(
  "§3b izlenen dosyalardaki her uzun JWT_SECRET değeri ret listesinde ya da zayıf",
  kabul.length === 0,
  kabul.length ? `yeni değer: ${kabul.join(" · ")} → özetini KNOWN_JWT_SECRET_DIGESTS'ne ekle ya da yer tutucuya çevir` : `${uzunSayisi} uzun değer, ${izlenen.length} dosya`,
);
for (const ornek of ["Teks-Erp/example-env.txt", "Teks-Erp/.env.docker.example", "Teks-Erp/.env.example"]) {
  const metin = readFileSync(join(KOK, ornek), "utf8");
  check(`§3c ${ornek} çalışan bir JWT_SECRET taşımıyor`, !envMetniniDenetle(metin).ok);
}

// -----------------------------------------------------------------------------
// §4 Depo geçmişi
// -----------------------------------------------------------------------------
let gecmis = "";
try {
  gecmis = git(["log", "--all", "-p", "-G", "JWT_SECRET[[:space:]]*[:=]", "--format=@@C %h"], { cwd: KOK, stdio: "yut" });
} catch {
  gecmis = "";
}
const gecmisDegerler = new Map<string, string>();
let commit = "";
for (const satir of gecmis.split("\n")) {
  if (satir.startsWith("@@C ")) {
    commit = satir.slice(4);
    continue;
  }
  if (!satir.startsWith("+") || satir.startsWith("+++")) continue;
  for (const m of satir.matchAll(LITERAL)) {
    if (m[1].length >= 32 && !gecmisDegerler.has(m[1])) gecmisDegerler.set(m[1], commit);
  }
}
if (gecmisDegerler.size === 0) {
  ATLAMA.atla("§4 depo geçmişi", "geçmiş okunamadı ya da sığ klon (uzun değer bulunamadı)");
} else {
  const kacan = [...gecmisDegerler].filter(([v]) => checkJwtSecret(v).ok).map(([v, c]) => `${c} (sha ${kisaOzet(v)})`);
  check(
    "§4 depo geçmişindeki her uzun JWT_SECRET değeri reddediliyor",
    kacan.length === 0,
    kacan.length ? `kabul edilen: ${kacan.join(" · ")}` : `${gecmisDegerler.size} farklı değer`,
  );
}

// -----------------------------------------------------------------------------
// §5 Açılış davranışı — alt süreçte auth.service yüklenir
// -----------------------------------------------------------------------------
const ACILIS_KODU =
  'const s=require("./src/lib/jwt-secret");require("./src/services/auth.service");' +
  'process.stdout.write("SAGLIK="+JSON.stringify(s.jwtSecretHealth())+"\\n");process.exit(0);';
function acilis(sir: string): { kod: number | null; cikti: string; saglik: { status?: string; rotationRequired?: boolean } | null } {
  const r = spawnSync("npx", ["tsx", "-e", ACILIS_KODU], {
    cwd: BACKEND,
    encoding: "utf8",
    timeout: 90_000,
    env: {
      ...process.env,
      JWT_SECRET: sir,
      DATABASE_URL: "postgresql://bekci:bekci@127.0.0.1:1/jwt_sir_sondasi_test?schema=public",
      DOTENV_CONFIG_PATH: "/nonexistent/.env",
    },
  });
  const cikti = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = /SAGLIK=(\{.*\})/.exec(cikti);
  return { kod: r.status, cikti, saglik: m ? JSON.parse(m[1]) : null };
}
const zayif = acilis("ab".repeat(20));
check(
  "§5a ZAYIF sır: backend YÜKLENİR (mevcut kurulum durmaz)",
  zayif.kod === 0 && zayif.saglik !== null,
  zayif.kod === 0 ? "" : `çıkış ${zayif.kod}: ${zayif.cikti.split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 200)}`,
);
check(
  "§5b ZAYIF sır: sağlık bayrağı rotationRequired + yüksek sesli uyarı",
  zayif.saglik?.status === "ZAYIF" && zayif.saglik?.rotationRequired === true && zayif.cikti.includes("DÖNDÜRÜLMELİ"),
);
const tarihi = [...gecmisDegerler.keys()].find((v) => {
  const k = checkJwtSecret(v);
  return !k.ok && k.kod === "BILINEN";
});
if (tarihi === undefined) {
  ATLAMA.atla("§5c bilinen sırla açılış", "geçmişten bilinen bir değer okunamadı (sığ klon)", 2);
} else {
  const bilinen = acilis(tarihi);
  check(
    "§5c depo geçmişindeki BİLİNEN sırla açılış: ayakta + BILINEN bayrağı",
    bilinen.kod === 0 && bilinen.saglik?.status === "BILINEN" && bilinen.saglik?.rotationRequired === true,
    `sha ${kisaOzet(tarihi)}`,
  );
  check("§5d uyarı/çıktı sır değerini basmıyor", !bilinen.cikti.includes(tarihi));
}
const kisa = acilis(temiz.slice(0, 20));
check("§5e KISA sır: açılış DURUR (bugünkü davranış)", kisa.kod !== 0 && kisa.cikti.includes("en az 32"));
const saglam = acilis(temiz);
check("§5f temiz sır: bayrak yok", saglam.kod === 0 && saglam.saglik?.status === "OK" && saglam.saglik?.rotationRequired === false);
const saglik = readFileSync(join(BACKEND, "src/lib/health-snapshot.ts"), "utf8");
check("§5g /api/admin/health jwtSecret alanını taşıyor", /jwtSecret:\s*jwtSecretHealth\(\)/.test(saglik));

// -----------------------------------------------------------------------------
// §6 Yeni kurulum yolu
// -----------------------------------------------------------------------------
const seed = readFileSync(join(BACKEND, "prisma/seed.ts"), "utf8");
check(
  "§6a seed (geliştirme dışı) JWT sırrını aynı yüklemle denetleyip reddediyor",
  /if\s*\(!gelistirme\)\s*\{\s*const sir = checkJwtSecret\(process\.env\.JWT_SECRET\);\s*if\s*\(!sir\.ok\)\s*throw/.test(seed),
);
const config = readFileSync(join(BACKEND, "prisma.config.ts"), "utf8");
const entry = readFileSync(join(BACKEND, "docker/entrypoint.sh"), "utf8");
check("§6b geliştirme bayrağı yalnız `npm run seed` yolunda", /prisma\/seed\.ts --gelistirme"/.test(config) && !entry.includes("--gelistirme"));

// -----------------------------------------------------------------------------
// §7 Paket aracı
// -----------------------------------------------------------------------------
const yeni = yeniJwtSirri();
const crlf = 'PORT=4000\r\nJWT_SECRET="eski"\r\nX=1\r\nJWT_SECRET=ikinci\r\n';
const yenilenmis = envMetnindeSirriYenile(crlf, yeni);
check(
  "§7a yenileme: CRLF korunur, BÜTÜN JWT_SECRET satırları değişir",
  yenilenmis === `PORT=4000\r\nJWT_SECRET="${yeni}"\r\nX=1\r\nJWT_SECRET="${yeni}"\r\n`,
);
check("§7b yenileme: satır yoksa eklenir", envMetnindeSirriYenile("PORT=1", yeni) === `PORT=1\nJWT_SECRET="${yeni}"\n`);
check("§7c üretilen sır yüklemden geçer", envMetniniDenetle(yenilenmis).ok);
const arac = readFileSync(join(BACKEND, "scripts/jwt-sir.ts"), "utf8");
check("§7d araç kendi kuralını yazmıyor (yalnız checkJwtSecret)", arac.includes("checkJwtSecret(") && !/\.length\s*<\s*32/.test(arac));
const build = readFileSync(join(BACKEND, "scripts/build-araclar.mjs"), "utf8");
check("§7e araç pakete giriyor (dist/tools/jwt-sir.cjs)", build.includes('"dist/tools/jwt-sir.cjs"'));
const auth = readFileSync(join(BACKEND, "src/services/auth.service.ts"), "utf8");
check(
  "§7f backend açılışı aynı kapıdan (loadJwtSecretAtBoot) — ikinci uzunluk kuralı yok",
  auth.includes("loadJwtSecretAtBoot(process.env.JWT_SECRET") && !/JWT_SECRET[^\n]*length\s*<\s*32/.test(auth),
);

// Komut satırı aracı uçtan uca (tsx; dosya yazmaz — yalnız denetle).
try {
  execFileSync("npx", ["tsx", "scripts/jwt-sir.ts", "denetle", "--env", "/nonexistent/.env"], { cwd: BACKEND, stdio: "ignore" });
  check("§7g okunamayan .env → çıkış 1 (ölçülemedi)", false, "çıkış 0 döndü");
} catch (e) {
  check("§7g okunamayan .env → çıkış 1 (ölçülemedi)", (e as { status?: number }).status === 1);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
process.exit(fail > 0 ? 1 : 0);
