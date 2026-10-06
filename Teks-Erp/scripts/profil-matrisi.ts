// =============================================================================
// PROFİL MATRİSİ KOŞUCUSU — her test profilinde P-takımı (TEK-ORTAK-PAKET §6.3, K-9)
// =============================================================================
// Bütün `npm test` yalnız `kapali` profilde koşar; bu koşucu HER profilde profile
// duyarsız P-takımını koşar. Her profil KENDİ taze DB'sinde (tekserp_pm_<profil>_test):
//   1 DB aç → 2 `migrate deploy` → 3 seed + fixtures → 4 profil ayarları (servis katmanı)
//   → 5 sunucu (127.0.0.1) → 6 P-takımı (açılış · uç kapıları · belge önizleme)
//   → 7 `test_db_invariants` (veri tutarlılığı) → 8 `test_e2e_full_flow` (üretim akışı).
//
// Koşum (Teks-Erp/ içinden; ana ağacın .env'ine karşı DEĞİL):
//   PM_PG_URL='postgresql://<kul>:<parola>@localhost:55433' \
//     node ../scripts/agir-is.mjs -- npx tsx scripts/profil-matrisi.ts [--profil kapali,acik]
//   --profil <a,b>     yalnız bu profiller (varsayılan: test-profilleri/ altındaki hepsi)
//   --rapor-yolu <yol> raporu buraya yaz (varsayılan ~/.tekserp/derleme-kayitlari/profil-matrisi-<commit>.json)
// Rapor `agacTemiz` taşır; yayın kapısı (`scripts/profil-matrisi-kapisi.mjs`) yalnız temiz ağaçta,
// bütün profilleri yeşil raporu kabul eder.
//   --sonda            negatif sonda: P-takımı bir kapı beklentisi BİLEREK bozulur, koşucunun
//                      KIRMIZI vermesi beklenir (verirse çıkış 0, vermezse 1); rapor yazılmaz
//   --acik-yaz         `acik.json`u `lib/hepsi-acik.ts`ten yeniden üret ve çık
// Çıkış: 0 hepsi yeşil · 1 kırmızı · 2 hedef/kullanım reddi.
// ⚠️ DROP yalnız bu koşucunun kendi adlandırdığı `tekserp_pm_<profil>_test` DB'lerine gider
//    (ad deseni ölçülür); başka hiçbir DB'ye dokunulmaz.
// =============================================================================
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { hepsiAcikAyarlar } from "./lib/hepsi-acik";
import { PROFIL_DIZINI, profilAdlari, profilHatalari, profilOku } from "./lib/profil";
import { sunucuAc } from "./lib/test-sunucusu";
import { profilOzeti, raporYolu } from "../../scripts/lib/profil-raporu.mjs";

const TEKS = join(__dirname, "..");
const BIN = join(TEKS, "node_modules", ".bin");
const PM_DB_DESENI = /^tekserp_pm_[a-z0-9]+_test$/;

type Sonuc = "YESIL" | "KIRMIZI";
interface Adim { ad: string; sonuc: Sonuc; sureMs: number; ozet: string; log?: string }
interface ProfilSonucu { ad: string; db: string; sonuc: Sonuc; adimlar: Adim[]; profilOzeti: string }

function ret(mesaj: string): never {
  console.error(`❌ ${mesaj}`);
  process.exit(2);
}

/** Rapor ile yayın kapısı (`scripts/lib/profil-raporu.mjs`) aynı özeti hesaplar. */
const sha = profilOzeti;

function sonSatir(metin: string, desen: RegExp): string {
  return [...metin.split("\n")].reverse().find((l) => desen.test(l))?.trim() ?? "";
}

/** Alt süreci koşar; çıktıyı dosyaya yazar, (çıkış, çıktı) döner. */
function kos(komut: string, arglar: string[], ortam: NodeJS.ProcessEnv, logYolu: string): { kod: number; cikti: string } {
  const r = spawnSync(komut, arglar, { cwd: TEKS, env: ortam, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 });
  const cikti = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  writeFileSync(logYolu, cikti);
  return { kod: r.status ?? 1, cikti };
}

async function dbYenidenKur(pgUrl: string, dbAdi: string): Promise<void> {
  if (!PM_DB_DESENI.test(dbAdi)) ret(`'${dbAdi}' matris DB adı desenine uymuyor — DROP reddedildi.`);
  const yonetim = new URL(pgUrl);
  yonetim.pathname = "/postgres";
  const havuz = new Pool({ connectionString: yonetim.toString(), max: 1 });
  try {
    await havuz.query(`DROP DATABASE IF EXISTS "${dbAdi}" WITH (FORCE)`);
    await havuz.query(`CREATE DATABASE "${dbAdi}"`);
  } finally {
    await havuz.end();
  }
}

function dbUrl(pgUrl: string, dbAdi: string): string {
  const u = new URL(pgUrl);
  u.pathname = `/${dbAdi}`;
  u.search = "?schema=public";
  return u.toString();
}

async function profilKos(ad: string, pgUrl: string, logDizini: string, sonda: boolean): Promise<ProfilSonucu> {
  const profilYolu = join(PROFIL_DIZINI, `${ad}.json`);
  const dbAdi = `tekserp_pm_${ad}_test`;
  const adimlar: Adim[] = [];
  const sonuc: ProfilSonucu = { ad, db: dbAdi, sonuc: "KIRMIZI", adimlar, profilOzeti: sha(readFileSync(profilYolu, "utf8")) };
  const jwt = randomBytes(48).toString("hex");
  const url = dbUrl(pgUrl, dbAdi);
  const ortam: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url, JWT_SECRET: jwt, TZ: "UTC" };
  for (const k of ["BEKCI_HEDEF_ONAY", "BEKCI_PROD_ONAY", "ALLOW_NONLOCAL_TEST_DB"]) delete ortam[k];

  const adim = async (adAdi: string, f: () => Promise<{ ok: boolean; ozet: string; log?: string }>): Promise<boolean> => {
    const t0 = Date.now();
    let r: { ok: boolean; ozet: string; log?: string };
    try {
      r = await f();
    } catch (e) {
      r = { ok: false, ozet: (e as Error).message.split("\n")[0] ?? "hata" };
    }
    adimlar.push({ ad: adAdi, sonuc: r.ok ? "YESIL" : "KIRMIZI", sureMs: Date.now() - t0, ozet: r.ozet, log: r.log });
    console.log(`  ${r.ok ? "✅" : "❌"} ${adAdi.padEnd(34)} ${r.ozet} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return r.ok;
  };
  const alt = (adAdi: string, komut: string, arglar: string[], ek: NodeJS.ProcessEnv = {}, ozet?: (c: string) => string) =>
    async () => {
      const log = join(logDizini, `${ad}-${adAdi}.log`);
      const r = kos(komut, arglar, { ...ortam, ...ek }, log);
      return { ok: r.kod === 0, ozet: ozet ? ozet(r.cikti) : `çıkış ${r.kod}`, log };
    };

  // Kurulum adımları: biri düşerse sonrası anlamsız → profil KIRMIZI, sunucu hiç açılmaz.
  if (!(await adim("DB aç (taze)", async () => { await dbYenidenKur(pgUrl, dbAdi); return { ok: true, ozet: dbAdi }; }))) return sonuc;
  if (!(await adim("migrate deploy", alt("migrate", join(BIN, "prisma"), ["migrate", "deploy"], {}, (c) => sonSatir(c, /applied|No pending/i) || "tamam")))) return sonuc;
  if (!(await adim("seed", alt("seed", join(BIN, "prisma"), ["db", "seed"])))) return sonuc;
  if (!(await adim("seed:fixtures", alt("fixtures", join(BIN, "tsx"), ["prisma/seed-fixtures.ts"])))) return sonuc;
  if (!(await adim("profil ayarları (servis)", alt("uygula", join(BIN, "tsx"), ["scripts/profil-uygula.ts", ad], {}, (c) => sonSatir(c, /uygulandı/) || "uygulandı")))) return sonuc;

  let sunucu: Awaited<ReturnType<typeof sunucuAc>> | null = null;
  const sunucuAcildi = await adim("sunucu açılışı", async () => {
    sunucu = await sunucuAc(url, jwt);
    return { ok: true, ozet: sunucu.base, log: sunucu.logYolu };
  });
  if (!sunucuAcildi || !sunucu) return sonuc;
  const aktif: Awaited<ReturnType<typeof sunucuAc>> = sunucu;
  try {
    const sondaEk: NodeJS.ProcessEnv = sonda ? { PM_SONDA: "kapi-ters" } : {};
    await adim("P-takımı: açılış/kapı/belge", alt("ptakimi", join(BIN, "tsx"), ["scripts/profil-ptakimi.ts"], { TEST_API_URL: aktif.base, PM_PROFIL: ad, ...sondaEk }, (c) => sonSatir(c, /Sonuç:/).replace(/=/g, "").trim() || "Sonuç satırı yok"));
    if (!sonda) {
      await adim("veri tutarlılığı (db_invariants)", alt("invariants", join(BIN, "tsx"), ["scripts/test_db_invariants.ts"], {}, (c) => sonSatir(c, /(Sonuç|SONUÇ):/).replace(/=/g, "").trim() || "Sonuç satırı yok"));
      await adim("üretim akışı (e2e)", alt("e2e", join(BIN, "tsx"), ["scripts/test_e2e_full_flow.ts"], {}, (c) => sonSatir(c, /(Sonuç|SONUÇ):/).replace(/=/g, "").trim() || "Sonuç satırı yok"));
    }
  } finally {
    await aktif.kapat();
  }
  sonuc.sonuc = adimlar.every((a) => a.sonuc === "YESIL") ? "YESIL" : "KIRMIZI";
  return sonuc;
}

function gitKisa(): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: TEKS, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "bilinmiyor";
}

/** Koşu başında ağaç temiz mi: kirli ağaçta üretilen rapor commit'i temsil etmez (kapı reddeder). */
function agacTemizMi(): boolean {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: TEKS, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() === "";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const bayrakDegeri = (ad: string): string | undefined => {
    const i = argv.indexOf(ad);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (argv.includes("--acik-yaz")) {
    const p = { ad: "acik", kaynak: "uretilmis: her modül açık, her boolean bayrak true (scripts/lib/hepsi-acik.ts)", alinma: "2026-10-06", ayarlar: hepsiAcikAyarlar() };
    writeFileSync(join(PROFIL_DIZINI, "acik.json"), `${JSON.stringify(p, null, 2)}\n`);
    console.log("✅ acik.json yeniden üretildi.");
    return;
  }

  const pgUrl = process.env.PM_PG_URL;
  if (!pgUrl) ret("PM_PG_URL ortamda yok — .env okunmaz (örn. postgresql://kul:parola@localhost:55433).");
  const host = new URL(pgUrl).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) ret(`PM_PG_URL yerel değil (${host}); matris yalnız yerel PG'ye koşar.`);

  const sonda = argv.includes("--sonda");
  const hepsi = profilAdlari();
  const istenen = (bayrakDegeri("--profil")?.split(",").map((s) => s.trim()).filter(Boolean)) ?? (sonda ? ["kapali"] : hepsi);
  for (const ad of istenen) if (!hepsi.includes(ad)) ret(`profil yok: '${ad}' (var olanlar: ${hepsi.join(", ")})`);
  for (const ad of istenen) {
    const h = profilHatalari(profilOku(ad));
    if (h.length > 0) ret(`profil '${ad}' geçersiz: ${h.join("; ")}`);
  }

  const agacTemiz = agacTemizMi();
  const commitBasta = gitKisa();
  const logDizini = mkdtempSync(join(tmpdir(), "tekserp-profil-matrisi-log-"));
  console.log(`🧪 Profil matrisi: ${istenen.join(", ")}${sonda ? " (NEGATİF SONDA)" : ""} · loglar: ${logDizini}`);
  const sonuclar: ProfilSonucu[] = [];
  for (const ad of istenen) {
    console.log(`\n▶ profil ${ad}`);
    sonuclar.push(await profilKos(ad, pgUrl, logDizini, sonda));
  }

  const kirmizi = sonuclar.filter((s) => s.sonuc === "KIRMIZI");
  console.log(`\n=== profil matrisi: ${sonuclar.length} profil · ${sonuclar.length - kirmizi.length} yeşil · ${kirmizi.length} kırmızı ===`);
  for (const s of kirmizi) {
    for (const a of s.adimlar.filter((x) => x.sonuc === "KIRMIZI")) console.log(`❌ ${s.ad} / ${a.ad}: ${a.ozet}${a.log ? ` — ${a.log}` : ""}`);
  }

  if (sonda) {
    const dustu = kirmizi.length > 0;
    console.log(dustu ? "✅ negatif sonda: bozulan adım matrisi KIRMIZIYA çevirdi." : "❌ negatif sonda: adım bozuldu ama matris YEŞİL kaldı — koşucu kördür.");
    process.exit(dustu ? 0 : 1);
  }

  const commit = gitKisa();
  const rapor = {
    commit,
    // Koşu sırasında commit değiştiyse rapor hiçbir commit'i temsil etmez.
    agacTemiz: agacTemiz && commit === commitBasta && agacTemizMi(),
    uretildi: new Date().toISOString(),
    sonuc: kirmizi.length === 0 ? "YESIL" : "KIRMIZI",
    profiller: sonuclar.map((s) => ({ ad: s.ad, db: s.db, sonuc: s.sonuc, profilOzeti: s.profilOzeti, adimlar: s.adimlar.map(({ ad, sonuc, sureMs, ozet }) => ({ ad, sonuc, sureMs, ozet })) })),
    profilDizini: Object.fromEntries(hepsi.map((ad) => [ad, sha(readFileSync(join(PROFIL_DIZINI, `${ad}.json`), "utf8"))])),
  };
  const yol = bayrakDegeri("--rapor-yolu") ?? raporYolu(commit);
  mkdirSync(dirname(yol), { recursive: true });
  writeFileSync(yol, `${JSON.stringify(rapor, null, 2)}\n`);
  console.log(`📄 rapor: ${yol}`);
  process.exit(kirmizi.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`❌ profil-matrisi beklenmedik hata: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
