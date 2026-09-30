// =============================================================================
// SUNUCU SIRLARI SALT OKUNUR BİRİMDE (G1) — satıcı açılışı ve CLI'lar portal TOTP anahtarını, etkinleştirme
// kodu sırrını (pepper) ve modül kasası anahtarını YARATMAZ; tek üretici `anahtar.ts sirlar-uret`.
//   §1 statik: `create: true` yalnız `src/keys/server-secrets.ts`te; sunucu + iki CLI `loadServerSecrets` çağırır
//      (⭐ kalıcı sonda: sunucuya `create: true` geri konunca kırmızı)
//   §2 süreç içi: salt okunur BOŞ dizinde `loadServerSecrets` açık TR hata (üç ad + komut), dizin boş kalır
//   §3 gerçek süreç: pepper + kasa anahtarı eksik salt okunur dizinde açılış çıkış 1, açık hata, dosya yaratılmaz
//   §4 `sirlar-uret` eksik ikisini 0600 üretir, var olanı ezmez; ikinci koşum üçünü de korur (baytlar aynı)
//   §5 pozitif: sırlar tamken salt okunur dizinde gerçek sunucu dinlemeye başlar
// Koşum: npx tsx scripts/test_sunucu_sirlari.ts   (kendi `_test` DB'si; yalnız §5 bağlanır, satır yazmaz)
// =============================================================================
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ACTIVATION_CODE_PEPPER_FILE } from "../src/keys/code-pepper";
import { MODULE_VAULT_KEY_FILE } from "../src/keys/module-vault";
import { MissingServerSecretsError, SERVER_SECRET_FILES, loadServerSecrets } from "../src/keys/server-secrets";
import { PORTAL_SECRET_KEY_FILE } from "../src/portal/secret-box";
import { BEKCI_ORTAMI, SATICI_KOKU, anahtarOrtamiKur, hedefDbKapisi, kapat, kontrol, sonuc, sunucuBaslat, temizleKurulumlar } from "./lib/test-ortam";

const KAYNAKLAR = ["src", "scripts/anahtar.ts", "scripts/portal-kullanici.ts", "scripts/modul-anahtari.ts"];
const YUKLEYICILER = ["src/server.ts", "scripts/portal-kullanici.ts", "scripts/modul-anahtari.ts"];

function tsDosyalari(yol: string): string[] {
  const tam = path.join(SATICI_KOKU, yol);
  if (!statSync(tam).isDirectory()) return [yol];
  return readdirSync(tam, { withFileTypes: true }).flatMap((d) => tsDosyalari(path.join(yol, d.name))).filter((f) => f.endsWith(".ts"));
}

/** `create: true` yalnız üretici modülde; yükleyiciler yalnız okur. */
function statikIhlaller(oku: (f: string) => string): string[] {
  const ih: string[] = [];
  for (const f of KAYNAKLAR.flatMap(tsDosyalari)) {
    if (f === path.join("src", "keys", "server-secrets.ts")) continue;
    if (/\{\s*create:\s*true\s*\}/.test(oku(f))) ih.push(`${f}: create: true`);
  }
  for (const f of YUKLEYICILER) if (!/loadServerSecrets\(config\.ANAHTAR_DIZINI\)/.test(oku(f))) ih.push(`${f}: loadServerSecrets yok`);
  return ih;
}

const oku = (f: string): string => readFileSync(path.join(SATICI_KOKU, f), "utf8");
const ozet = (f: string): string => crypto.createHash("sha256").update(readFileSync(f)).digest("hex");

function sunucuCikisi(dizin: string, capa: string): Promise<{ kod: number | null; log: string }> {
  return new Promise((resolve) => {
    const surec = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: SATICI_KOKU,
      env: { ...process.env, ...BEKCI_ORTAMI, PORT_GENEL: "0", PORT_TAILNET: "0", PORT_IC: "0", GENEL_BIND: "127.0.0.1", TAILNET_BIND: "127.0.0.1", IC_BIND: "127.0.0.1", ANAHTAR_DIZINI: dizin, GUVEN_CAPASI_DOSYASI: capa },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    const zaman = setTimeout(() => surec.kill("SIGKILL"), 30_000);
    surec.stdout.on("data", (c: Buffer) => (log += c.toString("utf8")));
    surec.stderr.on("data", (c: Buffer) => (log += c.toString("utf8")));
    surec.once("exit", (kod) => {
      clearTimeout(zaman);
      resolve({ kod, log });
    });
  });
}

function sirlarUret(dizin: string): string {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", "sirlar-uret", `--dizin=${dizin}`], { cwd: SATICI_KOKU, encoding: "utf8", timeout: 60_000 });
  return `${r.stdout}${r.stderr}|çıkış ${r.status}`;
}

async function main(): Promise<void> {
  hedefDbKapisi();
  console.log("§1 statik");
  const gercek = statikIhlaller(oku);
  kontrol("§1 ⭐ create: true yalnız server-secrets.ts'te; sunucu + iki CLI loadServerSecrets çağırır", gercek.length === 0, gercek.join(" | "));
  const sondaMetni = oku("src/server.ts").replace("...loadServerSecrets(config.ANAHTAR_DIZINI)", "moduleVault: ModuleKeyVault.load(config.ANAHTAR_DIZINI, { create: true })");
  const sonda = statikIhlaller((f) => (f === "src/server.ts" ? sondaMetni : oku(f)));
  kontrol("§1 sonda: sunucuya create: true geri konunca kırmızı", sondaMetni !== oku("src/server.ts") && sonda.length >= 2, sonda.join(" | ") || "MUTASYON UYGULANMADI");

  console.log("\n§2 süreç içi — salt okunur boş dizin");
  const bos = mkdtempSync(path.join(os.tmpdir(), "satici-sir-ro-"));
  try {
    chmodSync(bos, 0o500);
    let hata: unknown = null;
    try {
      loadServerSecrets(bos);
    } catch (e) {
      hata = e;
    }
    const m = hata instanceof Error ? hata.message : String(hata);
    kontrol("§2a eksik sır → MissingServerSecretsError (EROFS/EACCES değil)", hata instanceof MissingServerSecretsError && !/EROFS|EACCES/.test(m), m);
    kontrol("§2b mesaj üç dosyayı ve üretici komutu söyler", SERVER_SECRET_FILES.every((f) => m.includes(f)) && m.includes("anahtar.ts sirlar-uret"), m);
    kontrol("§2c dizin boş kaldı (yaratma yok)", readdirSync(bos).length === 0, readdirSync(bos).join(", "));
  } finally {
    chmodSync(bos, 0o700);
    rmSync(bos, { recursive: true, force: true });
  }

  const ortam = await anahtarOrtamiKur();
  try {
    console.log("\n§3 gerçek süreç — pepper + kasa anahtarı yok (VDS 2026-09-30 durumu)");
    unlinkSync(path.join(ortam.dizin, ACTIVATION_CODE_PEPPER_FILE));
    unlinkSync(path.join(ortam.dizin, MODULE_VAULT_KEY_FILE));
    const once = readdirSync(ortam.dizin).sort().join(",");
    chmodSync(ortam.dizin, 0o500);
    const r = await sunucuCikisi(ortam.dizin, ortam.capaDosyasi);
    kontrol("§3a açılış çıkış 1, dinleyici açılmadı", r.kod === 1 && !r.log.includes("SATICI_DINLIYOR"), `çıkış ${r.kod}`);
    kontrol("§3b açık TR hata: eksik iki ad + sirlar-uret, EROFS/EACCES yok", /Sunucu sırları eksik/.test(r.log) && r.log.includes(ACTIVATION_CODE_PEPPER_FILE) && r.log.includes(MODULE_VAULT_KEY_FILE) && !r.log.includes(`${PORTAL_SECRET_KEY_FILE},`) && r.log.includes("sirlar-uret") && !/EROFS|EACCES/.test(r.log), r.log.trim().split("\n").pop() ?? "");
    kontrol("§3c anahtar dizini değişmedi (yaratma yok)", readdirSync(ortam.dizin).sort().join(",") === once);

    console.log("\n§4 sirlar-uret — tek üretici, var olanı ezmez");
    chmodSync(ortam.dizin, 0o700);
    const totpOnce = ozet(path.join(ortam.dizin, PORTAL_SECRET_KEY_FILE));
    const c1 = sirlarUret(ortam.dizin);
    kontrol("§4a eksik ikisi üretildi, TOTP anahtarı korundu", c1.includes(`${ACTIVATION_CODE_PEPPER_FILE}: üretildi`) && c1.includes(`${MODULE_VAULT_KEY_FILE}: üretildi`) && c1.includes(`${PORTAL_SECRET_KEY_FILE}: vardı, korundu`) && c1.endsWith("çıkış 0"), c1);
    const izinler = SERVER_SECRET_FILES.map((f) => (statSync(path.join(ortam.dizin, f)).mode & 0o777).toString(8));
    kontrol("§4b üçü 0600", izinler.every((m) => m === "600"), izinler.join(" "));
    const ozetler = SERVER_SECRET_FILES.map((f) => ozet(path.join(ortam.dizin, f)));
    const c2 = sirlarUret(ortam.dizin);
    kontrol("§4c ikinci koşum üçünü de korur (baytlar aynı)", SERVER_SECRET_FILES.every((f) => c2.includes(`${f}: vardı, korundu`)) && SERVER_SECRET_FILES.every((f, i) => ozet(path.join(ortam.dizin, f)) === ozetler[i]) && ozet(path.join(ortam.dizin, PORTAL_SECRET_KEY_FILE)) === totpOnce, c2);

    console.log("\n§5 pozitif — sırlar tamken salt okunur dizinde sunucu açılır");
    chmodSync(ortam.dizin, 0o500);
    const sunucu = await sunucuBaslat(ortam);
    kontrol("§5 salt okunur anahtar dizininde SATICI_DINLIYOR", /SATICI_DINLIYOR/.test(sunucu.cikti()));
    await sunucu.durdur();
  } finally {
    chmodSync(ortam.dizin, 0o700);
    await temizleKurulumlar([], ortam.kidler);
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
