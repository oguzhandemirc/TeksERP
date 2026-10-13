// =============================================================================
// DAĞITIM — YÜKLEME İÇERİK DENETİMİ (Bölge 7 B7; DB'siz). `vetContent` birleşik gövdeyi taşımadan önce ölçer:
//   §1 her izinli uzantının (FILE_TYPES) içerik kuralı var; geçerli örnek iki yönde de geçer
//   §2 imza (magic): uzantının vaat ettiği tür baytlarda yoksa 415; metin türünde ikili imza / NUL 415 (UTF-16 serbest)
//   §3 zip yolu ve içeriği: yol kaçışı (`..` · mutlak · sürücü · ters bölü) iki yönde 415; GELEN kapta yürütülebilir ·
//      betik · iç içe arşiv · makrolu ofis · vbaProject.bin 415; GİDEN ilk kurulum paketi biçimi (iç zip + .exe) geçer
//   §4 bomba: girdi tavanı · oran tavanı (yalan açık boyut) · örtüşen girdi (sıkışık toplam > dosya) · bozuk/kesik
//      merkez dizini 415; iyi sıkışan küçük günlük zip'i (taban altında) geçer · ofis belgesi yapısız 415
//   §5 gerçek yapıtlar (varsa, ~/.tekserp/arsiv/derlemeler-*): GİDEN geçer; yoksa ÖLÇÜLMEDİ beyanı · zip64 (bekçinin
//      yazdığı + `zip -fz` varsa Info-ZIP'inki); §4a 100.001 girdi de zip64 yolundan okunur
// NEGATİF SONDA (dosya DIŞI, geri alındı): N1 `entryEscapes` hep false → §3a ❌ · N2 GELEN yasak uzantı denetimi
//   kaldırılır → §3b ❌ · N3 oran koşulu kaldırılır → §4b ❌ · N4 imza denetimi atlanır (`if (!magic(head))` sökülür) → §2a ❌ ·
//   N5 tamamlamada `vetContent` çağrısı sökülür → test_dagitim_yukleme §6b/§6c ❌
// Koşum: npx tsx scripts/test_dagitim_icerik.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZIP_LIMITS, entryEscapes, vetContent, type Direction } from "../src/distribution/content-vet";
import { FILE_TYPES, INCOMING_EXTENSIONS, OUTGOING_EXTENSIONS } from "../src/distribution/storage";
import { VendorError } from "../src/lib/errors";
import { ornekZip, rastgelePdf, rastgeleZip } from "./lib/ornek-dosya";

let kirmizi = 0;
function kontrol(ad: string, ok: boolean, ayrinti = ""): void {
  if (!ok) kirmizi++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

const dizin = mkdtempSync(path.join(os.tmpdir(), "dagitim-icerik-"));
let sayac = 0;
/** "ok" ya da 415 iletisi; başka hata bekçiyi kırmızıya düşürür (gizli istisna yutulmaz). */
async function dene(veri: Buffer, ext: string, yon: Direction): Promise<string> {
  const f = path.join(dizin, `${sayac++}.${ext}`);
  writeFileSync(f, veri);
  try {
    await vetContent(f, ext, yon);
    return "ok";
  } catch (e) {
    if (e instanceof VendorError && e.status === 415 && e.code === "DOSYA_TURU_YASAK") return e.message;
    throw e;
  } finally {
    rmSync(f, { force: true });
  }
}

const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ofis = () => ornekZip([{ ad: "[Content_Types].xml", veri: Buffer.from("<Types/>") }, { ad: "word/document.xml", veri: Buffer.from("<w/>") }]);
const tar = () => {
  const b = Buffer.alloc(1024);
  b.write("dosya.txt", 0);
  b.write("ustar", 257);
  return b;
};
const ORNEK: Readonly<Record<string, () => Buffer>> = {
  pdf: () => rastgelePdf(2000),
  png: () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(100)]),
  jpg: () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(100)]),
  jpeg: () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), randomBytes(100)]),
  txt: () => Buffer.from("düz metin\n"),
  log: () => Buffer.from("2026-10-13 HATA bağlantı\n"),
  csv: () => Buffer.from("a;b\n1;2\n"),
  json: () => Buffer.from('\ufeff{"a":1}'),
  xlsx: ofis,
  xls: () => Buffer.concat([CFB, randomBytes(500)]),
  docx: ofis,
  zip: () => rastgeleZip(5000),
  "7z": () => Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), randomBytes(100)]),
  mp4: () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), randomBytes(100)]),
  exe: () => Buffer.concat([Buffer.from("MZ"), randomBytes(200)]),
  msi: () => Buffer.concat([CFB, randomBytes(500)]),
  apk: () => ornekZip([{ ad: "AndroidManifest.xml", veri: randomBytes(100) }, { ad: "classes.dex", veri: randomBytes(300) }]),
  tar,
  gz: () => Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3]),
};

async function bolum1(): Promise<void> {
  console.log("§1 her uzantının kuralı + geçerli örnek");
  const eksik = Object.keys(FILE_TYPES).filter((e) => !ORNEK[e]);
  kontrol("§1a bekçi her FILE_TYPES uzantısı için örnek taşır", eksik.length === 0, eksik.join(","));
  const kotu: string[] = [];
  for (const ext of Object.keys(FILE_TYPES)) {
    const ornek = ORNEK[ext];
    if (!ornek) continue;
    if (INCOMING_EXTENSIONS.includes(ext) && (await dene(ornek(), ext, "GELEN")) !== "ok") kotu.push(`GELEN .${ext}`);
    if (OUTGOING_EXTENSIONS.includes(ext) && (await dene(ornek(), ext, "GIDEN")) !== "ok") kotu.push(`GIDEN .${ext}`);
  }
  kontrol("§1b geçerli örnek her izinli yönde geçer", kotu.length === 0, kotu.join(", ") || `${Object.keys(FILE_TYPES).length} tür`);
  kontrol("§1c tanımsız uzantı reddedilir (fail-closed)", (await dene(Buffer.from("x"), "rar", "GIDEN")) !== "ok");
}

async function bolum2(): Promise<void> {
  console.log("§2 imza (magic)");
  const ikili = Object.keys(FILE_TYPES).filter((e) => !["txt", "log", "csv", "json"].includes(e));
  const gecen: string[] = [];
  for (const ext of ikili) if ((await dene(Buffer.concat([Buffer.from("SAHTE-ICERIK"), randomBytes(600)]), ext, "GIDEN")) === "ok") gecen.push(ext);
  kontrol("§2a uzantının türü baytlarda yoksa 415 (bütün ikili türler)", gecen.length === 0, gecen.join(",") || `${ikili.length} tür`);
  const exePdf = await dene(Buffer.concat([Buffer.from("MZ"), randomBytes(300)]), "pdf", "GELEN");
  kontrol("§2b .pdf adlı yürütülebilir 415", exePdf !== "ok");
  const mzTxt = await dene(Buffer.concat([Buffer.from("MZ"), randomBytes(50)]), "txt", "GELEN");
  const zipLog = await dene(rastgeleZip(500), "log", "GELEN");
  const nul = await dene(Buffer.from("abc\0def"), "csv", "GELEN");
  kontrol("§2c metin türünde ikili imza (MZ · PK) ve NUL 415", mzTxt !== "ok" && zipLog !== "ok" && nul !== "ok");
  const utf16 = await dene(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("günlük", "utf16le")]), "log", "GELEN");
  kontrol("§2d UTF-16 (BOM'lu) günlük geçer", utf16 === "ok", utf16);
}

async function bolum3(): Promise<void> {
  console.log("§3 zip yolu ve içeriği");
  const kacis = ["../dis.txt", "a/../../dis.txt", "/etc/passwd", "C:\\Windows\\x.txt", "a\\..\\..\\x.txt", "c:dosya.txt"];
  const kacanlar: string[] = [];
  for (const ad of kacis) {
    for (const yon of ["GELEN", "GIDEN"] as const) if ((await dene(ornekZip([{ ad, veri: Buffer.from("x") }]), "zip", yon)) === "ok") kacanlar.push(`${yon} ${ad}`);
  }
  kontrol("§3a yol kaçışı iki yönde 415", kacanlar.length === 0 && entryEscapes("a/../b") && !entryEscapes("a/..b/c"), kacanlar.join(" | ") || `${kacis.length} ad × 2`);
  const yasak = ["kur.exe", "a/b/script.PS1", "x.js", "kisayol.lnk", "ic/arsiv.zip", "ic.7z", "rapor.docm", "word/vbaProject.bin", "app.apk"];
  const gecen: string[] = [];
  for (const ad of yasak) if ((await dene(ornekZip([{ ad: "oku.txt", veri: Buffer.from("x") }, { ad, veri: Buffer.from("y") }]), "zip", "GELEN")) === "ok") gecen.push(ad);
  kontrol("§3b GELEN kapta yürütülebilir/betik/iç içe arşiv/makro 415", gecen.length === 0, gecen.join(",") || `${yasak.length} ad`);
  const makroDocx = ornekZip([{ ad: "[Content_Types].xml", veri: Buffer.from("<T/>") }, { ad: "word/vbaProject.bin", veri: randomBytes(50) }]);
  kontrol("§3c GELEN makrolu .docx (vbaProject.bin) 415", (await dene(makroDocx, "docx", "GELEN")) !== "ok");
  const kurulum = ornekZip([
    { ad: "TeksERP-Panel-Setup.exe", veri: Buffer.concat([Buffer.from("MZ"), randomBytes(2000)]) },
    { ad: "tekserp-backend.zip", veri: rastgeleZip(3000) },
    { ad: "tablet.zip", veri: rastgeleZip(2000) },
    { ad: "SHA256SUMS", veri: Buffer.from("aa  x\n") },
    { ad: "BENIOKU.txt", veri: Buffer.from("kurulum") },
  ]);
  const g = await dene(kurulum, "zip", "GIDEN");
  kontrol("§3d GİDEN ilk kurulum paketi biçimi (iç zip + .exe) geçer", g === "ok", g);
  kontrol("§3e aynı paket GELEN yönde 415", (await dene(kurulum, "zip", "GELEN")) !== "ok");
}

async function bolum4(): Promise<void> {
  console.log("§4 bomba ve bozuk yapı");
  const n = ZIP_LIMITS.maxEntries + 1;
  const cok = ornekZip(Array.from({ length: n }, (_, i) => ({ ad: `d${i}`, veri: Buffer.alloc(0) })));
  kontrol(`§4a girdi tavanı (${n}) 415`, /girdi/.test(await dene(cok, "zip", "GIDEN")));
  const yalan = ornekZip([{ ad: "sifirlar.bin", veri: randomBytes(1000), yalan: { acik: 0xfffffff0 } }]);
  const oran = await dene(yalan, "zip", "GIDEN");
  kontrol("§4b oran tavanı (1 KB → ~4 GiB beyan) 415", /oran/.test(oran), oran);
  const ortusme = ornekZip([{ ad: "a.bin", veri: randomBytes(100), yalan: { sikisik: 10_000_000 } }]);
  kontrol("§4c sıkışık toplam dosyayı aşıyor (örtüşen girdi) 415", /örtüşen/.test(await dene(ortusme, "zip", "GIDEN")));
  const iyi = ornekZip([{ ad: "uzun.log", veri: Buffer.alloc(10 * 1024 * 1024, 0x41), sikistir: true }]);
  const iyiS = await dene(iyi, "zip", "GELEN");
  kontrol("§4d iyi sıkışan küçük günlük zip'i (10 MB → ~10 KB, taban altında) geçer", iyiS === "ok", iyiS);
  const z = rastgeleZip(800);
  const kesik = await dene(z.subarray(0, z.length - 30), "zip", "GIDEN");
  const basbozuk = Buffer.from(z);
  basbozuk.writeUInt32LE(0xdeadbeef, z.length - 22 - 46 - "veri.bin".length);
  kontrol("§4e kesik ya da bozuk merkez dizini 415", kesik !== "ok" && (await dene(basbozuk, "zip", "GIDEN")) !== "ok");
  kontrol("§4f [Content_Types].xml'siz .docx 415", (await dene(rastgeleZip(500), "docx", "GELEN")) !== "ok");
}

async function bolum5(): Promise<void> {
  console.log("§5 gerçek yapıtlar · zip64");
  const kok = path.join(os.homedir(), ".tekserp", "arsiv");
  const adaylar = existsSync(kok)
    ? readdirSync(kok)
        .filter((d) => d.startsWith("derlemeler-"))
        .flatMap((d) => readdirSync(path.join(kok, d)).map((f) => path.join(kok, d, f)))
        .filter((f) => /\.(zip|apk|exe)$/.test(f) && statSync(f).isFile())
    : [];
  if (adaylar.length === 0) console.log("⏭ §5a ÖLÇÜLMEDİ — yerelde yayın yapıtı yok (~/.tekserp/arsiv/derlemeler-*)");
  else {
    const kotu: string[] = [];
    for (const f of adaylar) {
      try {
        await vetContent(f, path.extname(f).slice(1), "GIDEN");
      } catch (e) {
        kotu.push(`${path.basename(f)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    kontrol("§5a gerçek yayın yapıtları GİDEN geçer", kotu.length === 0, kotu.join(" | ") || adaylar.map((f) => path.basename(f)).join(", "));
  }
  const yazili = await dene(ornekZip([{ ad: "a.txt", veri: Buffer.from("x") }, { ad: "b/c.txt", veri: Buffer.from("y") }], true), "zip", "GELEN");
  kontrol("§5b bekçinin yazdığı zip64 dizin sonu okunur ve geçer", yazili === "ok", yazili);
  const zipVar = spawnSync("zip", ["-v"], { encoding: "utf8" }).status === 0;
  if (!zipVar) {
    console.log("⏭ §5c ÖLÇÜLMEDİ — `zip` aracı yok (zip64 örneği üretilemedi)");
    return;
  }
  const kaynak = path.join(dizin, "z64-kaynak.txt");
  writeFileSync(kaynak, "zip64 örneği\n");
  const hedef = path.join(dizin, "z64.zip");
  const r = spawnSync("sh", ["-c", `cat "${kaynak}" | zip -q -fz "${hedef}" -`], { encoding: "utf8" });
  if (r.status !== 0 || !existsSync(hedef)) {
    console.log(`⏭ §5c ÖLÇÜLMEDİ — zip -fz başarısız (${r.stderr.trim().slice(0, 80)})`);
    return;
  }
  let sonuc = "ok";
  try {
    await vetContent(hedef, "zip", "GELEN");
  } catch (e) {
    sonuc = e instanceof Error ? e.message : String(e);
  }
  kontrol("§5c Info-ZIP `zip -fz` arşivi okunur ve geçer", sonuc === "ok", sonuc);
}

async function main(): Promise<void> {
  try {
    await bolum1();
    await bolum2();
    await bolum3();
    await bolum4();
    await bolum5();
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
  console.log(kirmizi === 0 ? "\nSONUÇ: YEŞİL" : `\nSONUÇ: ${kirmizi} KIRMIZI`);
  process.exit(kirmizi === 0 ? 0 : 1);
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
