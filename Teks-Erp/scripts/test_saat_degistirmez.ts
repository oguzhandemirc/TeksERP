// =============================================================================
// SAAT DEĞİŞTİRMEZ (§B-3) — programda sistem saatini/saat dilimini DEĞİŞTİREN işlev yoktur; imzalı sapma yalnız UYARIdır.
// =============================================================================
// Çalıştır: npx tsx scripts/run-all-tests.ts saat_degistirmez   (DB'siz)
//
// §1 depo taraması (git ls-files, kod uzantıları): saat/dilim AYARLAYAN çağrı yok (Set-Date · w32tm /resync ·
//    SetSystemTime · SetLocalTime · settimeofday · clock_settime · timedatectl set-* · hwclock --set/-w · date -s ·
//    Set-TimeZone · tzutil /s · net time /set). `w32tm` YALNIZ deploy/kurulum/kurulum.ps1'de (NTP yapılandırması,
//    saat ayarı değil). Bu kalıpları ARAYAN bekçiler beyanlıdır (BEKCILER).
// §2 bellek-içi negatif sondalar: dedektör enjekte edilen ihlali yakalar (sessiz kalmaz).
// §3 saf imzalı sapma: eşik kenarı (eşik − 1 / eşik), yön, monotonik izdüşüm (elle kaydırılan saat ölçümü beklemeden görünür),
//    bant yalnız UYARIda · süreç bilgi bantları kapalı liste.
// =============================================================================
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { git } from "./lib/git";
import { SIGNED_SKEW_WARN_SECONDS } from "../src/lib/license/protocol";
import { projectSignedSkew, signedSkewBanner, type SignedSkewSample } from "../src/lib/license/signed-skew";
import { PROCESS_INFO_BANNERS } from "../src/lib/license/process-banners";

const KOK = join(__dirname, "..", "..");
const KOD_UZANTISI = /\.(ts|tsx|js|mjs|cjs|ps1|psm1|rs|cmd|bat|sh|iss|py)$/;
/** Kalıpları kendi içinde ARAYAN bekçiler (ihlal değil, ölçüm). Kapalı küme. */
const BEKCILER = new Set(["Teks-Erp/scripts/test_saat_degistirmez.ts", "Teks-Erp/scripts/test_kurulum_betikleri.ts"]);
const W32TM_YERI = "deploy/kurulum/kurulum.ps1";

const SAAT_AYARLAYAN: readonly (readonly [string, RegExp])[] = [
  ["Set-Date", /\bSet-Date\b/i],
  ["w32tm /resync", /w32tm(\.exe)?["']?[^\n]*\/resync/i],
  ["SetSystemTime", /\bSetSystemTime\b/],
  ["SetLocalTime", /\bSetLocalTime\b/],
  ["settimeofday", /\bsettimeofday\b/],
  ["clock_settime", /\bclock_settime\b/],
  ["timedatectl set-*", /\btimedatectl\s+set-/i],
  ["hwclock --set/-w", /\bhwclock\s+(--set|-w\b|--systohc)/i],
  ["date -s", /\bdate\s+(-s|--set)\b/],
  ["Set-TimeZone", /\bSet-TimeZone\b/i],
  ["tzutil /s", /\btzutil(\.exe)?["']?\s*[^\n]*\/s\b/i],
  ["net time /set", /\bnet\s+time\b[^\n]*\/set\b/i],
];

export interface Ihlal {
  readonly dosya: string;
  readonly satir: number;
  readonly neden: string;
}

/** Saf dedektör: dosya adı + metin → ihlaller. */
export function tara(dosyalar: readonly { readonly yol: string; readonly metin: string }[]): Ihlal[] {
  const out: Ihlal[] = [];
  for (const d of dosyalar) {
    if (BEKCILER.has(d.yol)) continue;
    d.metin.split("\n").forEach((l, i) => {
      for (const [ad, re] of SAAT_AYARLAYAN) if (re.test(l)) out.push({ dosya: d.yol, satir: i + 1, neden: ad });
      if (/\bw32tm\b/i.test(l) && d.yol !== W32TM_YERI) out.push({ dosya: d.yol, satir: i + 1, neden: `w32tm yalnız ${W32TM_YERI}` });
    });
  }
  return out;
}

let fail = 0;
let pass = 0;
function check(label: string, ok: boolean, detay?: string): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

function depo(): { yol: string; metin: string }[] {
  const yollar = git(["ls-files", "-z"], { cwd: KOK }).split("\0").filter((p) => p && KOD_UZANTISI.test(p) && !p.includes("node_modules/"));
  const out: { yol: string; metin: string }[] = [];
  for (const yol of yollar) {
    try {
      out.push({ yol, metin: readFileSync(join(KOK, yol), "utf8") });
    } catch {
      // Silinmiş ama index'te duran dosya: taranacak içerik yok.
    }
  }
  return out;
}

function main(): void {
  console.log("§1 — depo: saat/dilim ayarlayan çağrı yok; w32tm yalnız kurulum betiğinde");
  const dosyalar = depo();
  check("§1a körlük zemini: en az 1000 kod dosyası tarandı", dosyalar.length >= 1000, String(dosyalar.length));
  check("§1b kurulum betiği taranan kümede (w32tm yeri)", dosyalar.some((d) => d.yol === W32TM_YERI && /\bw32tm\b/i.test(d.metin)));
  const ihlaller = tara(dosyalar);
  check("§1c ⭐ programda saati/dilimi DEĞİŞTİREN işlev YOK", ihlaller.length === 0, ihlaller.slice(0, 8).map((x) => `${x.dosya}:${x.satir} ${x.neden}`).join(" · "));

  console.log("\n§2 — negatif sondalar (bellek-içi)");
  const sonda = (yol: string, metin: string): number => tara([{ yol, metin }]).length;
  check("§2a src dosyasına `Set-Date` → yakalanır", sonda("Teks-Erp/src/x.ts", 'exec("powershell Set-Date -Date $t")') === 1);
  check("§2b src dosyasına `w32tm /config` → yakalanır (yer dışı)", sonda("Teks-Erp/src/x.ts", 'spawn("w32tm.exe", ["/config"])') === 1);
  check("§2c kurulum betiğine `w32tm /resync` → yakalanır", sonda(W32TM_YERI, 'NativeKos "w32tm.exe" @("/resync")') === 1);
  check("§2d Rust `SetSystemTime` · Linux `timedatectl set-time` · `tzutil /s` → yakalanır", sonda("a.rs", "SetSystemTime(&st)") + sonda("a.sh", "timedatectl set-time 12:00") + sonda("a.cmd", 'tzutil /s "UTC"') === 3);
  check("§2e karşı: kurulum betiğinde `w32tm /config` ve okuma (`Get-Date`, `w32tm /query`) temiz", sonda(W32TM_YERI, 'NativeKos "w32tm.exe" @("/config", "/update")\nGet-Date\nw32tm /query /status') === 0);

  console.log("\n§3 — saf imzalı sapma");
  const T = 1_800_000_000_000;
  const H = 1_000_000_000_000n;
  const s = (skewSn: number): SignedSkewSample => ({ skewMs: skewSn * 1000, wallMs: T, hrNs: H });
  const at = (x: SignedSkewSample | null, dWallMs = 0, dHrMs = 0) => projectSignedSkew(x, T + dWallMs, H + BigInt(dHrMs) * 1_000_000n);
  check("§3a eşik tek sabit 300 sn (protokol)", SIGNED_SKEW_WARN_SECONDS === 300);
  check(
    "§3b eşik kenarı: 299 → TUTARLI · 300 → UYARI · −300 → UYARI",
    at(s(SIGNED_SKEW_WARN_SECONDS - 1)).durum === "TUTARLI" && at(s(SIGNED_SKEW_WARN_SECONDS)).durum === "UYARI" && at(s(-SIGNED_SKEW_WARN_SECONDS)).durum === "UYARI",
  );
  check("§3c ölçülmedi → OLCULMEDI, sapma null, bant yok", at(null).durum === "OLCULMEDI" && at(null).sapmaSn === null && signedSkewBanner(at(null)) === null);
  check("§3d monotonik: duvar ve monotonik birlikte 1 sa ilerler → sapma aynı", at(s(10), 3_600_000, 3_600_000).sapmaSn === 10);
  const kaydi = at(s(10), 60_000 + 10 * 60_000, 60_000);
  check("§3e ⭐ elle 10 dk ileri alınan saat yoklamayı beklemeden görünür (+610 sn, UYARI)", kaydi.sapmaSn === 610 && kaydi.durum === "UYARI", `${kaydi.sapmaSn} ${kaydi.durum}`);
  const ileri = signedSkewBanner(at(s(420)));
  const geri = signedSkewBanner(at(s(-7200)));
  check(
    "§3f bant yalnız UYARIda; yön ve büyüklük metinde",
    signedSkewBanner(at(s(60))) === null && !!ileri && ileri.ton === "uyari" && ileri.metin.includes("7 dk ileride") && !!geri && geri.metin.includes("2 saat geride"),
    `${ileri?.metin.slice(0, 80)} | ${geri?.metin.slice(0, 80)}`,
  );
  check("§3g süreç bilgi bantları kapalı liste: yalnız SAAT_SAPMASI", JSON.stringify(Object.keys(PROCESS_INFO_BANNERS)) === '["SAAT_SAPMASI"]', Object.keys(PROCESS_INFO_BANNERS).join(","));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
