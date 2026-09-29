// =============================================================================
// KÖK PAROLASI SÜREÇ LİSTESİNDE GÖRÜNMEZ — parola imza alt sürecine YALNIZ stdin'den gider.
// Paylaşımlı makinede (VDS) argv her kullanıcıya açıktır (`ps`, /proc/<pid>/cmdline); env aynı
// kullanıcıya açıktır (/proc/<pid>/environ, `ps eww`). Ölçüm GERÇEK alt süreçte, o stdin'i
// beklerken yapılır: argv ve env'de parola YOK; sonra aynı süreç imzalar (sertifika köke karşı
// doğrulanır) ve verilen parola Buffer'ı sıfırlanmış döner. Yanlış parola → YANLIS_PAROLA (mesajda
// parola yok). CLI `--parola` argümanını reddeder.
// ⭐ KALICI SONDA ✓K2 (her koşumda): ölçüm aracı KÖR DEĞİL — parolayı argv'de taşıyan bir kukla
//    süreçte argv okuyucusu, env'de taşıyanda env okuyucusu parolayı BULUR.
// Koşum: npx tsx scripts/test_kok_parola_argv.ts   (DB GEREKMEZ)
// =============================================================================
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CertificateSchema, DAY_MS, LICENSE_CLASSES, TYP, publicKeyX, verifyCertificate } from "../src/lisans-protokol";
import { KeyFileError, passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { signWithWrappedKey, spawnSignerProcess } from "../src/keys/signer";
import { SATICI_KOKU, kontrol, sonuc } from "./lib/test-ortam";

/** Sürecin argv'si (herkese açık yüzey) ve env'i (aynı kullanıcıya açık yüzey), düz metin. */
function surecYuzeyleri(pid: number): { argv: string; env: string } {
  if (process.platform === "linux") {
    const oku = (f: string) => (existsSync(f) ? readFileSync(f).toString("utf8").replace(/\0/g, " ") : "");
    return { argv: oku(`/proc/${pid}/cmdline`), env: oku(`/proc/${pid}/environ`) };
  }
  const ps = (args: string[]) => execFileSync("ps", [...args, "-p", String(pid)], { encoding: "utf8" });
  return { argv: ps(["-o", "args="]), env: ps(["eww", "-o", "command="]) };
}

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dizin = mkdtempSync(path.join(os.tmpdir(), "satici-argv-"));
  const parola = `argv-sonda-${randomBytes(12).toString("hex")}`;
  try {
    const { privateKey } = generateKeyPairSync("ed25519");
    const kokDosyasi = path.join(dizin, "kok-2026-7.kok.json");
    const kok = await wrapPrivateKey({ tur: "tekserp-kok-anahtar", kid: "kok-2026-7", siniflar: [...LICENSE_CLASSES] }, privateKey, passwordBuffer(parola));
    writeKeyFileExclusive(kokDosyasi, kok);
    const alt = generateKeyPairSync("ed25519");
    const simdi = Date.now();
    const sertifika = CertificateSchema.parse({
      v: 1,
      sertifikaId: randomUUID(),
      kullanim: "ALT",
      kid: "alt-2026-7",
      x: publicKeyX(alt.privateKey),
      siniflar: ["URETIM"],
      baslangic: new Date(simdi).toISOString(),
      bitis: new Date(simdi + 30 * DAY_MS).toISOString(),
      bayi: null,
    });

    console.log("\n§1 imza alt süreci stdin'i beklerken");
    // Ana süreç sır taşıyan bir ortamda koşar (sunucuda DATABASE_URL vb.): alt sürece geçmemeli.
    const ortamSirri = `ortam-sirri-${randomBytes(8).toString("hex")}`;
    process.env.DATABASE_URL = `postgresql://sonda:${ortamSirri}@127.0.0.1:1/sonda_test`;
    process.env.SATICI_SONDA_SIRRI = ortamSirri;
    const cocuk = spawnSignerProcess();
    await bekle(400);
    const yuzey = surecYuzeyleri(cocuk.pid!);
    kontrol("§1a ölçüm gerçek süreci okudu (argv'de signer-child var)", /signer-child/.test(yuzey.argv), yuzey.argv.trim().slice(0, 120));
    kontrol("§1b argv'de parola YOK", !yuzey.argv.includes(parola));
    kontrol("§1c env'de parola YOK", !yuzey.env.includes(parola));
    kontrol("§1d ana sürecin ortam sırları (DATABASE_URL · diğer) alt sürece GEÇMEDİ", !yuzey.env.includes(ortamSirri) && !/DATABASE_URL/.test(yuzey.env));
    const verilen = passwordBuffer(parola);
    const belge = await signWithWrappedKey({ keyFile: kokDosyasi, typ: TYP.SERTIFIKA, payload: sertifika, password: verilen, child: cocuk });
    const dogru = verifyCertificate(belge, { roots: [{ kid: kok.kid, x: kok.x, classes: kok.siniflar }], usage: "ALT", atMs: Date.now() });
    kontrol("§1e aynı alt süreç imzaladı; sertifika köke karşı doğrulanır", dogru.ok, dogru.ok ? "" : dogru.code);
    kontrol("§1f verilen parola Buffer'ı iş bitince SIFIRLANDI", verilen.every((b) => b === 0));

    console.log("\n§2 yanlış parola");
    let hata: unknown = null;
    try {
      await signWithWrappedKey({ keyFile: kokDosyasi, typ: TYP.SERTIFIKA, payload: sertifika, password: passwordBuffer(`${parola}-yanlis`) });
    } catch (err) {
      hata = err;
    }
    kontrol("§2a YANLIS_PAROLA, mesajda parola yok", hata instanceof KeyFileError && hata.kind === "YANLIS_PAROLA" && !hata.message.includes(parola));

    console.log("\n§3 CLI parolayı argümandan ALMAZ");
    const cli = spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", "kok-uret", "--kid=kok-2026-8", `--parola=${parola}`, `--dizin=${dizin}`], {
      cwd: SATICI_KOKU,
      encoding: "utf8",
      input: "",
    });
    kontrol("§3a --parola → çıkış 2 + açıklayıcı hata, dosya yazılmadı", cli.status === 2 && /argümandan ALINMAZ/.test(cli.stderr) && !existsSync(path.join(dizin, "kok-2026-8.kok.json")), `${cli.status}`);
    const stdinCli = spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", "kok-uret", "--kid=kok-2026-9", `--dizin=${dizin}`], {
      cwd: SATICI_KOKU,
      encoding: "utf8",
      input: `${parola}\n${parola}\n`,
    });
    const yazilan = path.join(dizin, "kok-2026-9.kok.json");
    kontrol("§3b stdin'den parola → kök yazıldı (0600), dosyada parola yok", stdinCli.status === 0 && existsSync(yazilan) && !readFileSync(yazilan, "utf8").includes(parola), stdinCli.stderr.trim().slice(0, 120));

    console.log("\n§4 ✓K ölçüm aracı kör değil");
    const kuklaArgv = spawn(process.execPath, ["-e", "setTimeout(()=>{},3000)", parola], { stdio: "ignore" });
    const kuklaEnv = spawn(process.execPath, ["-e", "setTimeout(()=>{},3000)"], { stdio: "ignore", env: { ...process.env, SONDA_PAROLA: parola } });
    await bekle(400);
    kontrol("§4a parolayı argv'de taşıyan süreçte argv okuyucusu BULUR", surecYuzeyleri(kuklaArgv.pid!).argv.includes(parola));
    kontrol("§4b parolayı env'de taşıyan süreçte env okuyucusu BULUR", surecYuzeyleri(kuklaEnv.pid!).env.includes(parola));
    kuklaArgv.kill();
    kuklaEnv.kill();
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
