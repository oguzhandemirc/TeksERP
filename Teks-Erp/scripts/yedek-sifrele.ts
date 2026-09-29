// =============================================================================
// yedek-sifrele — `.tkenc` yedek şifreleme aracı (sunucu paketinde dist/tools/yedek-sifrele.cjs)
// =============================================================================
// Kullanım (paketli sunucuda `node dist\tools\yedek-sifrele.cjs <komut> ...`):
//   anahtar-uret --ad <ad> --dizin <D> [--parolali] [--parola-stdin] [--ozel-cikti <dosya>]
//   sifrele      --girdi <x.dump> [--cikti <x.dump.tkenc>] (--anahtar-dizini <D> | --alici <a.tkpub> ...) [--duzu-sil]
//   coz          --girdi <x.dump.tkenc> [--cikti <x.dump>] (--anahtar <dosya> | --anahtar-dizini <D>) [--parola-stdin]
//   dogrula      --girdi <x.dump.tkenc> [--anahtar <dosya> | --anahtar-dizini <D>] [--parola-stdin]
//   durum        --anahtar-dizini <D>
// Çıkış: 0 tamam · 1 kullanım/genel · 2 yanlış anahtar/parola · 3 bozuk/kurcalanmış/yarım.
//
// PAROLA ARGÜMANDAN ALINMAZ: komut satırı süreç listesine ve kabuk geçmişine düşer.
// Parola terminalden gizli sorulur; betik/test için yalnız `--parola-stdin` (ilk satır).
// Çıktı ASCII: Windows konsolu 857/850 kod sayfasında Türkçe harfleri bozar ve
// yedekle.ps1 bu çıktıyı log dosyasına yazar.
// =============================================================================

import fs from "fs";
import path from "path";
import {
  BackupCryptoError,
  ENCRYPTED_SUFFIX,
  LOCAL_KEY_FILE,
  PUBLIC_KEY_EXT,
  WRAPPED_KEY_EXT,
  decodePublicKey,
  decryptFile,
  encodePublicKey,
  encodeSecretKey,
  encryptFile,
  firstKeyLine,
  fingerprint,
  generateRawKeyPair,
  inspectEncrypted,
  isBackupCryptoError,
  privateKeyFromRaw,
  privateRawFromText,
  readBackupCryptoConfig,
  validatePasswordStrength,
  verifyEncrypted,
  wrapSecretKey,
  type Recipient,
} from "../src/lib/backup-crypto";

const TR: Record<string, string> = { ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U", "—": "-", "…": "..." };
const ascii = (s: string): string => s.replace(/[çÇğĞıİöÖşŞüÜ—…]/g, (c) => TR[c] ?? c);
const out = (s: string): void => void process.stdout.write(`${ascii(s)}\n`);
const err = (s: string): void => void process.stderr.write(`${ascii(s)}\n`);

class Kullanim extends Error {}

interface Args {
  komut: string;
  tek: Map<string, string>;
  cok: Map<string, string[]>;
  bayrak: Set<string>;
}

const BAYRAKLAR = new Set(["--parolali", "--parola-stdin", "--duzu-sil"]);
const TEKRARLI = new Set(["--alici"]);

function parseArgs(argv: string[]): Args {
  const [komut = "", ...rest] = argv;
  const a: Args = { komut, tek: new Map(), cok: new Map(), bayrak: new Set() };
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i]!;
    if (!k.startsWith("--")) throw new Kullanim(`Beklenmeyen arguman: ${k}`);
    if (/parola(?!li|-stdin)/.test(k)) throw new Kullanim("Parola argumandan verilmez (terminal ya da --parola-stdin).");
    if (BAYRAKLAR.has(k)) {
      a.bayrak.add(k);
      continue;
    }
    const v = rest[++i];
    if (v === undefined) throw new Kullanim(`${k} bir deger ister.`);
    if (TEKRARLI.has(k)) a.cok.set(k, [...(a.cok.get(k) ?? []), v]);
    else a.tek.set(k, v);
  }
  return a;
}

function gerekli(a: Args, k: string): string {
  const v = a.tek.get(k);
  if (!v) throw new Kullanim(`${k} gerekli.`);
  return v;
}

// -----------------------------------------------------------------------------
// Parola okuma
// -----------------------------------------------------------------------------

let stdinSatirlari: string[] | null = null;
async function stdinSatiri(): Promise<string> {
  if (!stdinSatirlari) {
    const parcalar: Buffer[] = [];
    for await (const p of process.stdin) parcalar.push(p as Buffer);
    stdinSatirlari = Buffer.concat(parcalar).toString("utf8").split(/\r?\n/);
  }
  const s = stdinSatirlari.shift();
  if (!s) throw new Kullanim("--parola-stdin: standart girdide parola satiri yok.");
  return s;
}

function gizliSor(soru: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(new Kullanim("Parola icin terminal gerekli (etkilesimsiz kosumda --parola-stdin)."));
  }
  return new Promise((resolve, reject) => {
    let pw = "";
    process.stderr.write(ascii(soru));
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const bitir = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
    };
    const onData = (s: string): void => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          bitir();
          resolve(pw);
          return;
        }
        if (ch === "\u0003") {
          bitir();
          reject(new Kullanim("Iptal edildi."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") pw = pw.slice(0, -1);
        else pw += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const parolaAl = (a: Args, soru: string): Promise<string> =>
  a.bayrak.has("--parola-stdin") ? stdinSatiri() : gizliSor(soru);

// -----------------------------------------------------------------------------
// Anahtar kaynakları
// -----------------------------------------------------------------------------

async function kimlikYukle(a: Args, zorunlu: boolean) {
  const dosya = a.tek.get("--anahtar");
  const dizin = a.tek.get("--anahtar-dizini");
  if (dosya && dizin) throw new Kullanim("--anahtar ile --anahtar-dizini birlikte verilmez.");
  const yol = dosya ?? (dizin ? path.join(dizin, LOCAL_KEY_FILE) : null);
  if (!yol) {
    if (zorunlu) throw new Kullanim("--anahtar <dosya> ya da --anahtar-dizini <dizin> gerekli.");
    return null;
  }
  const metin = await fs.promises.readFile(yol, "utf8");
  const raw = await privateRawFromText(metin, () => parolaAl(a, "Yedek parolasi: "));
  try {
    return privateKeyFromRaw(raw);
  } finally {
    raw.fill(0);
  }
}

async function alicilar(a: Args): Promise<Recipient[]> {
  const dizin = a.tek.get("--anahtar-dizini");
  const dosyalar = a.cok.get("--alici") ?? [];
  if (dizin && dosyalar.length) throw new Kullanim("--anahtar-dizini ile --alici birlikte verilmez.");
  if (dizin) {
    const cfg = await readBackupCryptoConfig({ keyDir: dizin });
    if (cfg.state !== "acik") throw new Kullanim(`Anahtar dizini kullanilamaz: ${cfg.problems.join(" | ")}`);
    for (const w of cfg.warnings) err(`UYARI: ${w}`);
    return cfg.recipients;
  }
  if (!dosyalar.length) throw new Kullanim("--anahtar-dizini <dizin> ya da en az bir --alici <a.tkpub> gerekli.");
  return Promise.all(
    dosyalar.map(async (f) => ({
      ad: path.basename(f, PUBLIC_KEY_EXT).toLowerCase(),
      publicRaw: decodePublicKey(firstKeyLine(await fs.promises.readFile(f, "utf8"))),
    })),
  );
}

// -----------------------------------------------------------------------------
// Komutlar
// -----------------------------------------------------------------------------

async function anahtarUret(a: Args): Promise<void> {
  const ad = gerekli(a, "--ad").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(ad)) throw new Kullanim("--ad: kucuk harf, rakam, tire (en cok 32).");
  const dizin = gerekli(a, "--dizin");
  await fs.promises.mkdir(dizin, { recursive: true });
  const k = generateRawKeyPair();
  const pubYol = path.join(dizin, `${ad}${PUBLIC_KEY_EXT}`);
  const fp = fingerprint(k.publicRaw);

  let ozelYol: string | null = null;
  if (a.bayrak.has("--parolali")) {
    const p1 = await parolaAl(a, "Yeni yedek parolasi: ");
    validatePasswordStrength(p1);
    if (!a.bayrak.has("--parola-stdin")) {
      const p2 = await gizliSor("Yedek parolasi (tekrar): ");
      if (p1 !== p2) throw new Kullanim("Parolalar ayni degil.");
    }
    const w = await wrapSecretKey(ad, k.privateRaw, p1);
    ozelYol = path.join(dizin, `${ad}${WRAPPED_KEY_EXT}`);
    await fs.promises.writeFile(ozelYol, `${JSON.stringify(w, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } else {
    const satir = encodeSecretKey(k.privateRaw);
    const hedef = a.tek.get("--ozel-cikti");
    const govde = `# TeksERP yedek ozel anahtari - ad: ${ad} - parmak izi: ${fp}\n# Bu satir yedekleri ACAR. Kagida yaz / USB'de sakla; sunucuda BIRAKMA.\n${satir}\n`;
    if (hedef) {
      await fs.promises.writeFile(hedef, govde, { flag: "wx", mode: 0o600 });
      ozelYol = hedef;
    } else {
      err("---- OZEL ANAHTAR (yalniz bir kez gosterilir; yaz ve sakla) ----");
      out(satir);
      err("-----------------------------------------------------------------");
    }
  }
  k.privateRaw.fill(0);
  await fs.promises.writeFile(pubYol, `# TeksERP yedek alicisi - ad: ${ad} - parmak izi: ${fp}\n${encodePublicKey(k.publicRaw)}\n`, {
    flag: "wx",
  });
  err(`acik anahtar: ${pubYol}  (parmak izi ${fp})`);
  if (ozelYol) err(`ozel anahtar: ${ozelYol}`);
}

async function sifrele(a: Args): Promise<void> {
  const girdi = gerekli(a, "--girdi");
  const cikti = a.tek.get("--cikti") ?? `${girdi}${ENCRYPTED_SUFFIX}`;
  const alc = await alicilar(a);
  const yarim = `${cikti}.part`;
  await fs.promises.rm(yarim, { force: true });
  await encryptFile(girdi, yarim, alc);
  // Yapısal denetim geçmeden nihai ad verilmez (yarım dosya `.tkenc` adı almaz).
  const ins = await inspectEncrypted(yarim);
  await fs.promises.rename(yarim, cikti);
  if (a.bayrak.has("--duzu-sil")) await fs.promises.rm(girdi);
  out(`sifrelendi: ${cikti}  (alicilar: ${ins.header.alicilar.map((x) => x.ad).join(", ")})`);
}

async function coz(a: Args): Promise<void> {
  const girdi = gerekli(a, "--girdi");
  const varsayilan = girdi.toLowerCase().endsWith(ENCRYPTED_SUFFIX) ? girdi.slice(0, -ENCRYPTED_SUFFIX.length) : null;
  const cikti = a.tek.get("--cikti") ?? varsayilan;
  if (!cikti) throw new Kullanim(`--cikti gerekli (girdi ${ENCRYPTED_SUFFIX} ile bitmiyor).`);
  await inspectEncrypted(girdi);
  const kimlik = (await kimlikYukle(a, true))!;
  const h = await decryptFile(girdi, cikti, [kimlik]);
  out(`cozuldu: ${cikti}  (alicilar: ${h.alicilar.map((x) => x.ad).join(", ")})`);
}

async function dogrula(a: Args): Promise<void> {
  const girdi = gerekli(a, "--girdi");
  const ins = await inspectEncrypted(girdi);
  const kimlik = await kimlikYukle(a, false);
  const alc = ins.header.alicilar.map((x) => `${x.ad} (${x.parmakIzi})`).join(", ");
  if (!kimlik) {
    out(`yapi saglam (anahtarsiz denetim - parca etiketleri DOGRULANMADI): ${girdi}`);
    out(`  olusturma: ${ins.header.olusturma}  alicilar: ${alc}`);
    return;
  }
  const r = await verifyEncrypted(girdi, [kimlik]);
  out(`butunluk TAMAM: ${girdi}  (${r.bytes} bayt duz)  alicilar: ${alc}`);
}

async function durum(a: Args): Promise<void> {
  const cfg = await readBackupCryptoConfig({ keyDir: gerekli(a, "--anahtar-dizini") });
  out(`durum: ${cfg.state}  dizin: ${cfg.dir}`);
  for (const r of cfg.recipients) out(`  alici: ${r.ad}  ${r.parmakIzi}`);
  out(`  yerel anahtar: ${cfg.localKeyPath ?? "YOK"}`);
  for (const p of cfg.problems) out(`  SORUN: ${p}`);
  for (const w of cfg.warnings) out(`  UYARI: ${w}`);
  if (cfg.state !== "acik") process.exitCode = 1;
}

const KOMUTLAR: Record<string, (a: Args) => Promise<void>> = {
  "anahtar-uret": anahtarUret,
  sifrele,
  coz,
  dogrula,
  durum,
};

function cikisKodu(e: unknown): number {
  if (e instanceof Kullanim) return 1;
  if (isBackupCryptoError(e)) {
    const c = (e as BackupCryptoError).code;
    if (c === "YANLIS_ANAHTAR" || c === "YANLIS_PAROLA") return 2;
    if (c === "KURCALANMIS" || c === "KESIK" || c === "BICIM") return 3;
  }
  return 1;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const f = KOMUTLAR[a.komut];
  if (!f) throw new Kullanim(`Komut: ${Object.keys(KOMUTLAR).join(" | ")}`);
  await f(a);
}

main().catch((e: unknown) => {
  const kod = cikisKodu(e);
  const mesaj = e instanceof Error ? e.message : String(e);
  err(`HATA${isBackupCryptoError(e) ? ` [${(e as BackupCryptoError).code}]` : ""}: ${mesaj}`);
  process.exitCode = kod;
});
