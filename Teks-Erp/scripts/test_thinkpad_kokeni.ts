// =============================================================================
// BEKÇİ — THINKPAD KÖKENİ: kayıtlı derleme makinesinin künyesiyle PAKET imzası (kullanıcı kararı 2026-10-08)
// =============================================================================
// DB'siz, ağsız; her şey GEÇİCİ dizinde, HOME geçici. NE ÖLÇER:
//   §1 saf hüküm (`thinkpadKokeniHukmu`): uyan künye → uyumlu; künye yok/biçimsiz · betik okunamadı · üretimde
//      ana dal ölçülemedi → ÖLÇÜLEMEDİ; zip özeti · iki uç · başka makine · hedef · kirli ağaç · commit · Rust
//      parçası · hizmet ikilisi · elle değiştirilmiş betik · üretimde ana dal dışı → İHLAL; test anahtarında dal serbest
//   §2 uçtan uca (gerçek CLI, `zip` kipi): üretim anahtarı köken bayraksız → RED (mesaj --derleme-kunyesi'ni anar);
//      künye yok · zip tutmaz · başka makine · kirli ağaç → parola SORULMADAN RED, zip değişmez; --ci-kosu / --ci-atla
//      ile birlikte RED; `imzala` (dizin) kipinde RED; uyan künye → imza, yükte `ciKokeni.kip = "thinkpad"`,
//      kaçış cümlesi GEREKMEZ
// Koşum: node ../scripts/agir-is.mjs -- npx tsx scripts/test_thinkpad_kokeni.ts
// =============================================================================
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePackageKey, writePackageKey } from "./lib/butunluk-imza";
import { git } from "./lib/git";
import { RUST_PARCALARI, THINKPAD_BETIGI, type ThinkpadOlcumu, thinkpadKokeniHukmu } from "./lib/thinkpad-kokeni";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const TEKS = path.resolve(__dirname, "..");
const DEPO = path.resolve(TEKS, "..");
const TEMP = mkdtempSync(path.join(os.tmpdir(), "thinkpad-kokeni-"));
const PAROLA = "bekci-thinkpad-parolasi-2026";
const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const gitOku = (a: string[]): string | null => {
  try {
    return git(["-C", DEPO, ...a], { stdio: "yut" }).trim();
  } catch {
    return null;
  }
};
/** Uçtan uca kaynak/betik commit'i: ana dal ölçülebiliyorsa `origin/main`, değilse HEAD. */
const ANA = gitOku(["rev-parse", "--verify", "origin/main^{commit}"]);
const COMMIT = ANA ?? (gitOku(["rev-parse", "HEAD"]) as string);
const BETIK_SHA = sha(Buffer.from(git(["-C", DEPO, "show", `${COMMIT}:${THINKPAD_BETIGI}`]), "utf8"));

const RUST = { node: Buffer.from("sahte-node"), hizmet: Buffer.from("sahte-hizmet"), guncelleyici: Buffer.from("sahte-guncelleyici") };
const RUST_SHA = {
  "lisans-cekirdek.win32-x64-msvc.node": sha(RUST.node),
  "tekserp-hizmet.exe": sha(RUST.hizmet),
  "tekserp-guncelleyici.exe": sha(RUST.guncelleyici),
};

function kunye(zipSha: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    tur: "thinkpad-derleme",
    zaman: "2026-10-08T12:00:00.000Z",
    makine: { ad: "thinkpad-1", tailscaleIp: "100.70.47.46" },
    betik: { yol: THINKPAD_BETIGI, commit: COMMIT, sha256: BETIK_SHA },
    kaynak: { commit: COMMIT, ref: "origin/main" },
    agac: { macKlonTemiz: true, uzakAgacTemiz: true },
    rust: RUST_SHA,
    zip: { ad: "p.zip", sha256: zipSha, uzakSha256: zipSha },
    ...o,
  };
}

function paketJson(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commit: COMMIT.slice(0, 7),
    calismaAgaciTemiz: true,
    korumali: true,
    korumaHedef: "win-x64",
    backendKanal: null,
    uygulamaSurumu: "2.14.1",
    dosyaSayisi: 7,
    hizmetIkilileri: { "tekserp-hizmet.exe": { sha256: RUST_SHA["tekserp-hizmet.exe"] }, "tekserp-guncelleyici.exe": { sha256: RUST_SHA["tekserp-guncelleyici.exe"] } },
    ...o,
  };
}

// ── §1 saf hüküm ─────────────────────────────────────────────────────────────
function bolum1(): void {
  console.log("\n§1 saf hüküm");
  const Z = "a".repeat(64);
  const temel: ThinkpadOlcumu = {
    kunye: kunye(Z),
    zipSha256: Z,
    paket: paketJson(),
    serverKunye: { commit: COMMIT },
    zipRust: RUST_SHA,
    betikBlobSha256: BETIK_SHA,
    anaDalda: { kaynak: true, betik: true },
    uretim: true,
  };
  const h = (o: Partial<ThinkpadOlcumu>) => thinkpadKokeniHukmu({ ...temel, ...o }).sonuc;
  const k = (o: Record<string, unknown>) => ({ kunye: kunye(Z, o) });
  check("§1a pozitif: kayıtlı makine · iki uç · temiz · commit · Rust · betik · ana dal → uyumlu", h({}) === "uyumlu");
  const olculemedi: Array<[string, Partial<ThinkpadOlcumu>]> = [
    ["künye yok", { kunye: null }],
    ["künye biçimsiz (v:2)", k({ v: 2 })],
    ["künye türü başka", k({ tur: "ci" })],
    ["betik commit'i depoda okunamadı", { betikBlobSha256: null }],
    ["üretimde ana dal ölçülemedi", { anaDalda: { kaynak: null, betik: true } }],
  ];
  for (const [ad, o] of olculemedi) check(`§1b ⭐ ${ad} → ÖLÇÜLEMEDİ`, h(o) === "olculemedi", h(o));
  const ihlal: Array<[string, Partial<ThinkpadOlcumu>]> = [
    ["imzalanan zip künyedekinden farklı", { zipSha256: "b".repeat(64) }],
    ["iki uç eşleşmemiş", k({ zip: { sha256: Z, uzakSha256: "c".repeat(64) } })],
    ["başka makine (IP)", k({ makine: { ad: "thinkpad-1", tailscaleIp: "100.70.47.47" } })],
    ["başka makine (ad)", k({ makine: { ad: "thinkpad-2", tailscaleIp: "100.70.47.46" } })],
    ["hedef linux-x64", { paket: paketJson({ korumaHedef: "linux-x64" }) }],
    ["kirli ağaç (uzak)", k({ agac: { macKlonTemiz: true, uzakAgacTemiz: false } })],
    ["kirli ağaç (Mac klonu)", k({ agac: { macKlonTemiz: false, uzakAgacTemiz: true } })],
    ["kirli ağaç (PAKET.json)", { paket: paketJson({ calismaAgaciTemiz: false }) }],
    ["yapıt başka commit'ten", { serverKunye: { commit: "f".repeat(40) } }],
    ["paket başka commit'te", { paket: paketJson({ commit: "zzzzzzz" }) }],
    ["Rust .node farklı", { zipRust: { ...RUST_SHA, "lisans-cekirdek.win32-x64-msvc.node": "d".repeat(64) } }],
    ["Rust parçası zip'te yok", { zipRust: { ...RUST_SHA, "tekserp-hizmet.exe": null } }],
    ["PAKET.json hizmet ikilisi özeti farklı", { paket: paketJson({ hizmetIkilileri: { "tekserp-hizmet.exe": { sha256: "e".repeat(64) }, "tekserp-guncelleyici.exe": { sha256: RUST_SHA["tekserp-guncelleyici.exe"] } } }) }],
    ["betik elle değiştirilmiş", { betikBlobSha256: "0".repeat(64) }],
    ["betik yolu başka", k({ betik: { yol: "deploy/baska.sh", commit: COMMIT, sha256: BETIK_SHA } })],
    ["üretimde kaynak ana dalda değil", { anaDalda: { kaynak: false, betik: true } }],
    ["üretimde betik ana dalda değil", { anaDalda: { kaynak: true, betik: false } }],
  ];
  for (const [ad, o] of ihlal) check(`§1c ⭐ ${ad} → İHLAL`, h(o) === "ihlal", h(o));
  check("§1d üretim dışı (test) anahtarda dal serbest", h({ uretim: false, anaDalda: { kaynak: false, betik: null } }) === "uyumlu");
  check("§1e Rust parça listesi künye ile zip yolları birebir", Object.keys(RUST_PARCALARI).sort().join() === Object.keys(RUST_SHA).sort().join());
}

// ── §2 uçtan uca ─────────────────────────────────────────────────────────────
interface Kosum {
  readonly kod: number | null;
  readonly cikti: string;
  readonly hata: string;
}
function cli(argv: readonly string[], input = ""): Kosum {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/build-korumali-imza.ts", ...argv], {
    cwd: TEKS,
    input,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME: path.join(TEMP, "ev") },
  });
  return { kod: r.status, cikti: r.stdout ?? "", hata: r.stderr ?? "" };
}
let sayac = 0;
function dizin(ad: string): string {
  const d = path.join(TEMP, `${ad}-${sayac++}`);
  mkdirSync(d, { recursive: true });
  return d;
}
/** Küçük korumalı paket zip'i (künyede çapa kipi `uretim` ya da yok) + özeti. */
function zipKur(capa: "uretim" | null, paketEk: Record<string, unknown> = {}): { zip: string; sha: string } {
  const k = dizin("paket");
  for (const d of ["dist", "native", "runtime"]) mkdirSync(path.join(k, d));
  writeFileSync(path.join(k, "dist", "a.js"), "console.log('a');\n");
  writeFileSync(path.join(k, "dist", "server-kunye.json"), `${JSON.stringify({ commit: COMMIT, zaman: "2026-10-08T12:00:00.000Z", ...(capa ? { guvenCapasi: capa } : {}) })}\n`);
  writeFileSync(path.join(k, "package.json"), '{"name":"p"}\n');
  writeFileSync(path.join(k, RUST_PARCALARI["lisans-cekirdek.win32-x64-msvc.node"]), RUST.node);
  writeFileSync(path.join(k, RUST_PARCALARI["tekserp-hizmet.exe"]), RUST.hizmet);
  writeFileSync(path.join(k, RUST_PARCALARI["tekserp-guncelleyici.exe"]), RUST.guncelleyici);
  writeFileSync(path.join(k, "PAKET.json"), `${JSON.stringify(paketJson(paketEk), null, 2)}\n`);
  const zip = path.join(dizin("zip"), "p.zip");
  spawnSync("zip", ["-q", "-r", "-X", zip, "."], { cwd: k });
  return { zip, sha: sha(readFileSync(zip)) };
}
function kunyeYaz(zip: string, k: Record<string, unknown>): string {
  const f = `${zip}.derleme.json`;
  writeFileSync(f, `${JSON.stringify(k, null, 2)}\n`);
  return f;
}
function yuk(zip: string): Record<string, unknown> {
  const jws = execFileSync("unzip", ["-p", zip, "butunluk.jws"], { encoding: "utf8" }).trim();
  return JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
}

function bolum2(): void {
  console.log("\n§2 uçtan uca (gerçek CLI, zip kipi)");
  const ad = dizin("anahtar");
  const u = cli(["anahtar-uret", "--kid=paket-2099", `--dizin=${ad}`, "--json"], `${PAROLA}\n${PAROLA}\n`);
  const uretim = path.join(ad, "paket-2099.paket.json");
  check("§2a üretim anahtarı (paket-2099, parolalı) üretildi", u.kod === 0, u.hata.trim().slice(0, 120));
  const test = writePackageKey(dizin("test-anahtar"), generatePackageKey("paket-test", ["TEST", "DEMO"]));

  // Parola SORULMADAN red: stdin boş; parola sorulsaydı mesaj "parola" olurdu ve zip özeti aynı kalmalı.
  const red = (etiket: string, argv: (zip: string, sha: string) => string[], desen: RegExp, kunyeEk?: Record<string, unknown> | null, paketEk: Record<string, unknown> = {}) => {
    const { zip, sha: s } = zipKur("uretim", paketEk);
    if (kunyeEk !== null && kunyeEk !== undefined) kunyeYaz(zip, kunye(s, kunyeEk));
    const r = cli(["zip", `--zip=${zip}`, `--anahtar=${uretim}`, ...argv(zip, s)]);
    const ayni = sha(readFileSync(zip)) === s;
    check(`§2 ⭐ ${etiket} → çıkış 1, parola sorulmadı, zip değişmedi`, r.kod === 1 && desen.test(r.hata) && ayni, `çıkış ${r.kod} ${r.hata.trim().slice(0, 160)}`);
  };
  const kunyeArg = (zip: string) => [`--derleme-kunyesi=${zip}.derleme.json`];
  red("köken bayraksız üretim imzası", () => [], /--derleme-kunyesi/);
  red("künye dosyası yok", kunyeArg, /THINKPAD KÖKENİ ÖLÇÜLEMEDİ/, null);
  red("zip künyedekinden farklı", kunyeArg, /THINKPAD KÖKENİ TUTMUYOR[\s\S]*künyedekinden farklı/, { zip: { sha256: "b".repeat(64), uzakSha256: "b".repeat(64) } });
  red("başka makine", kunyeArg, /THINKPAD KÖKENİ TUTMUYOR[\s\S]*kayıtlı değil/, { makine: { ad: "thinkpad-1", tailscaleIp: "100.64.0.9" } });
  red("kirli ağaç", kunyeArg, /THINKPAD KÖKENİ TUTMUYOR[\s\S]*kirli/, {}, { calismaAgaciTemiz: false });
  red("--derleme-kunyesi + --ci-kosu", (z) => [...kunyeArg(z), "--ci-kosu=4242"], /birlikte verilemez/, {});
  red("--derleme-kunyesi + --ci-atla", (z) => [...kunyeArg(z), "--ci-atla=CI kırık ama kullanıcı imzalamamı istedi"], /CI KAÇIŞI REDDEDİLDİ[\s\S]*birlikte/, {});

  const dk = dizin("dizin-kipi");
  mkdirSync(path.join(dk, "dist"));
  writeFileSync(path.join(dk, "dist", "server-kunye.json"), `${JSON.stringify({ commit: COMMIT, zaman: "2026-10-08T12:00:00.000Z" })}\n`);
  const ri = cli(["imzala", `--kok=${dk}`, `--anahtar=${test}`, "--surum=2.14.1", `--derleme-kunyesi=${path.join(dk, "k.json")}`]);
  check("§2b ⭐ `imzala` (dizin) kipinde --derleme-kunyesi → RED (zip özeti yok)", ri.kod === 1 && /yalnız `zip` kipinde/.test(ri.hata), ri.hata.trim().slice(0, 120));

  // Test anahtarı + uyan künye → imza; yükte thinkpad kaydı.
  const t = zipKur(null);
  kunyeYaz(t.zip, kunye(t.sha));
  const rt = cli(["zip", `--zip=${t.zip}`, `--anahtar=${test}`, ...kunyeArg(t.zip)]);
  const yt = rt.kod === 0 ? (yuk(t.zip).ciKokeni as Record<string, unknown> | undefined) : undefined;
  check("§2c test anahtarı + uyan künye → imza, ciKokeni {thinkpad · thinkpad-1 · 100.70.47.46 · commit · zip özeti}",
    rt.kod === 0 && yt?.kip === "thinkpad" && yt.makine === "thinkpad-1" && yt.tailscaleIp === "100.70.47.46" && yt.commit === COMMIT && yt.zipSha256 === t.sha,
    `${rt.kod} ${rt.hata.trim().slice(0, 160)} ${JSON.stringify(yt)}`);

  // Üretim anahtarı + uyan künye: ana dal ölçülebiliyorsa kaçış cümlesi OLMADAN imzalar; ölçülemiyorsa fail-closed.
  const p = zipKur("uretim");
  kunyeYaz(p.zip, kunye(p.sha));
  const rp = cli(["zip", `--zip=${p.zip}`, `--anahtar=${uretim}`, ...kunyeArg(p.zip)], `${PAROLA}\n`);
  if (ANA) {
    const yp = rp.kod === 0 ? (yuk(p.zip).ciKokeni as Record<string, unknown> | undefined) : undefined;
    check("§2d ⭐ üretim anahtarı + uyan künye (origin/main) → imza, --ci-atla GEREKMEDİ, yükte thinkpad kaydı",
      rp.kod === 0 && yp?.kip === "thinkpad" && yp.commit === COMMIT && !/CI KAÇIŞI/.test(rp.hata + rp.cikti), `${rp.kod} ${rp.hata.trim().slice(0, 160)}`);
  } else {
    check("§2d ⭐ origin/main yok → üretim imzası ÖLÇÜLEMEDİ (fail-closed)", rp.kod === 1 && /ÖLÇÜLEMEDİ/.test(rp.hata), rp.hata.trim().slice(0, 160));
  }
}

try {
  bolum1();
  bolum2();
} finally {
  rmSync(TEMP, { recursive: true, force: true });
}
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail === 0 ? 0 : 1);
