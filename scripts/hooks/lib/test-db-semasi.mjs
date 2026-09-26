#!/usr/bin/env node
// =============================================================================
// TEST DB'Sİ ŞEMANIN GERİSİNDE Mİ — kapı DURMAZ, sesli söyler (üç sonuç + fabrika yedeği kapısı)
// =============================================================================
// ⭐ NEDEN VAR (2026-09-14, 1e hükmü): izole ağaçta rebase şemayı ve migration'ları getirir,
//    oturumun KENDİ test DB'sini getirmez. Sonra bekçiler P2022 ("column does not exist") ile
//    düşer — bu bir ÜRÜN kırmızısı değil, "ölçülemedi, deploy koş"tur (d5wt: 6 bekçi yanlış
//    kırmızı). Ölçüm (`npx prisma migrate status`, ~1 sn): rc tek başına GERİDE ile DB-YOK'u
//    ayırmaz; METİN ayırır.
//
// ÜÇ SONUÇ (+ iki kapı), HEPSİ ÇIKIŞ 0 — kapı durmaz, beyan ⏭ satırıyla yüzeye çıkar ve
//    kapı defterine düşer (pre-commit yeşil adımın ⏭ satırlarını basar ve yazar):
//    GÜNCEL       ✅ "Database schema is up to date!"
//    GERİDE       ⏭ "Following migrations have not yet been applied:" — N satır + çare
//    ÖLÇÜLEMEDİ   ⏭ P1000/P1001/erişim yok · DATABASE_URL yok
//    ARIZA        ⏭ "ölçülemedi: beklenmeyen çıktı" — üç sonuç dışı dördüncü bir SESSİZLİK olmasın
//    FABRİKA      ⏭ hedef fabrika verisiyse (`FABRIKA_ONEKI` ile başlayan HER ad) status BİLE koşmaz
//
// Neden durmaz: kapının adımları DB'siz; geride DB yalnız oturumun kendi bekçi koşumlarını
//    yanıltır — sert kapı doğru davranışı (docs commit'i) DB şartına bağlardı.
// Salt okur: `.env` okunur, YAZILMAZ; `migrate status` `_prisma_migrations`i SELECT eder.
//
// Çalıştır: node scripts/hooks/lib/test-db-semasi.mjs [--url=<DATABASE_URL>] [--env=<.env yolu>]
//    (argümanlar yalnız sonda için; kapı argümansız çağırır, .env'den okur)
// =============================================================================
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BACKEND = join(REPO, "Teks-Erp");
export const FABRIKA_YEDEGI = "tekserp_fabrika_dev";
/** Fabrika verisi taşıyan DB'lerin SINIFI — ad değişse de (kopya, yeni döküm) kural aynı. */
export const FABRIKA_ONEKI = "tekserp_fabrika_";

/** Hedef fabrika verisi mi — o DB'ye status bile bağlanmaz. */
export function fabrikaMi(ad) {
  return typeof ad === "string" && ad.startsWith(FABRIKA_ONEKI);
}

/**
 * `.env` metnindeki bir anahtarın değeri — backend'in okuduğu `dotenv` ile AYNI sonuç: çift, tek
 * ya da ters tırnaklı değer tırnaksız döner; tırnaksız değer `#`ten önce biter; `export` öneki
 * serbest; aynı anahtar iki kez varsa SONUNCUSU. Bulunamazsa ya da boşsa null.
 * (Kapı sıfır bağımlılıklıdır; `dotenv` eşdeğerliğini `test_hook_config` §10f ölçer.)
 */
export function envDegeri(metin, anahtar) {
  const satir = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${anahtar}[ \\t]*=[ \\t]*(.*)$`, "gm");
  let deger = null;
  for (const m of metin.matchAll(satir)) {
    const ham = m[1].trim();
    const q = ham[0];
    const son = q === '"' || q === "'" || q === "`" ? ham.indexOf(q, 1) : -1;
    deger = son > 0 ? ham.slice(1, son) : ham.split("#")[0].trim();
  }
  return deger ? deger : null;
}

/** `.env`den DATABASE_URL (salt okur); yoksa null. */
export function envUrl(envYolu = join(BACKEND, ".env")) {
  if (!existsSync(envYolu)) return null;
  return envDegeri(readFileSync(envYolu, "utf8"), "DATABASE_URL");
}

/** URL'deki veritabanı adı (yol bileşeni, `?` öncesi). */
export function dbAdi(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "").split("?")[0]);
  } catch {
    return null;
  }
}

/** `migrate status` çıktısını sınıflandırır — saf yüklem, bekçi gerçek çıktı örnekleriyle ölçer. */
export function siniflandir(cikti) {
  if (/Database schema is up to date/i.test(cikti)) return { durum: "GUNCEL", n: 0 };
  if (/have not yet been applied|has not yet been applied/i.test(cikti)) {
    const n = (cikti.match(/^\s*\d{14}_\S+/gm) ?? []).length;
    return { durum: "GERIDE", n };
  }
  if (/P1000|P1001|P1002|P1003|P1010|P1011|Can't reach database|Authentication failed|does not exist on the database server/i.test(cikti)) {
    return { durum: "OLCULEMEDI", n: 0 };
  }
  return { durum: "ARIZA", n: 0 };
}

function main() {
  const arg = (ad) => process.argv.slice(2).find((a) => a.startsWith(`--${ad}=`))?.split("=").slice(1).join("=");
  const url = arg("url") ?? envUrl(arg("env"));
  if (!url) {
    console.log("⏭ test DB'si şeması ÖLÇÜLEMEDİ — DATABASE_URL yok (.env okunamadı); kapı durmaz");
    process.exit(0);
  }
  const ad = dbAdi(url);
  if (fabrikaMi(ad)) {
    console.log(`⏭ test DB'si şeması ÖLÇÜLMEZ — hedef ${ad} FABRİKA YEDEĞİDİR, status bile bağlanmaz`);
    process.exit(0);
  }
  const r = spawnSync("npx", ["prisma", "migrate", "status"], {
    cwd: BACKEND,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: url },
    timeout: 60_000,
  });
  const cikti = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const { durum, n } = siniflandir(r.error ? `${cikti}\n${r.error.message}` : cikti);
  if (durum === "GUNCEL") {
    console.log(`✅ test DB'si şemayla güncel (${ad})`);
  } else if (durum === "GERIDE") {
    console.log(
      `⏭ test DB'si (${ad}) şemanın ${n} migration GERİSİNDE — bekçiler P2022 ile YANLIŞ kırmızı düşer ⇒ cd Teks-Erp && npx prisma migrate deploy   (kapı durmaz)`,
    );
  } else if (durum === "OLCULEMEDI") {
    console.log(`⏭ test DB'si şeması ÖLÇÜLEMEDİ — ${ad}: veritabanına ulaşılamadı (P1001 sınıfı); kapı durmaz`);
  } else {
    console.log(`⏭ test DB'si şeması ölçülemedi: beklenmeyen çıktı (ARIZA, çıkış ${r.status ?? r.error?.code}) — ${cikti.trim().split("\n").slice(-2).join(" | ").slice(0, 160)}`);
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
