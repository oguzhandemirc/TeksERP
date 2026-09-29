// =============================================================================
// BEKÇİ — LİSANS Faz 2d: MODÜL ŞİFRELEME ("güvenlik-kritik sonuç boolean değil ANAHTARDIR")
// =============================================================================
// DB'siz; geçici dizinler. §1 paket biçimi (yanlış anahtar / kurcalı başlık / kurcalı gövde açılmaz) ·
// §2 anahtar YALNIZ doğrulanmış kiradan: başka kurulumun anahtarı açamaz · donmuş modül · kirada hak
// yok · HAK'ta yok (TS + varsa native test derlemesi) · §3 yükleyici: GERÇEK depo-multi paketi bellekte
// derlenir, çekirdeğin AYNI örneklerine bağlanır; anahtarsız / yanlış anahtar → 403 LICENSE_MODULE ·
// §4 düz metin diske düşmez · §5 üretimde TS'e düşme yok · §6 kurulumun X25519 anahtarı.
// Sondalar (✓K): BEKCI-HARITASI `## lisans` satırında.
// =============================================================================
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { fiksturKur, hakBas, kiraBas, type Fikstur } from "./lib/lisans-fikstur";
import { moduleKeyId, wrapModuleKey, type LeaseDoc } from "../src/lib/license/protocol";
import { tsLicenseCore, type LicenseCore } from "../src/lib/license/license-core";
import { loadLicenseCoreFrom } from "../src/lib/license/native";
import { openModulePackage, readModulePackageHeader, sealModulePackage } from "../src/lib/license/encrypted-module";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const TEKS = path.resolve(__dirname, "..");
const TEMP = mkdtempSync(path.join(tmpdir(), "lisans-modul-"));
const MODUL = "depo.multiEnabled";
const oku = (p: string): string => readFileSync(path.join(TEKS, p), "utf8");

function x25519(): { ozel: string; acik: string } {
  const jwk = generateKeyPairSync("x25519").privateKey.export({ format: "jwk" });
  return { ozel: String(jwk.d), acik: String(jwk.x) };
}

function bolum1(): void {
  console.log("\n§1 paket biçimi");
  const key = randomBytes(32);
  const code = Buffer.from("module.exports = 42; // tekserp-duz-metin-isareti");
  const pkg = sealModulePackage({ code: Buffer.from(code), key, modul: MODUL, paket: "depo-multi", surum: 1, kid: moduleKeyId(key) });
  check("§1a doğru anahtar açar, içerik aynı", openModulePackage(pkg, key)?.code.equals(code) === true);
  check("§1b ✓K yanlış anahtar AÇAMAZ", openModulePackage(pkg, randomBytes(32)) === null);
  const kurcali = Buffer.from(pkg);
  kurcali[pkg.indexOf(Buffer.from("depo.multiEnabled"))] ^= 1;
  check("§1c başlıkta modül adı kurcalanınca açılmaz (AAD)", openModulePackage(kurcali, key) === null);
  const govde = Buffer.from(pkg);
  govde[govde.length - 20] ^= 1;
  check("§1d gövde kurcalanınca açılmaz (GCM)", openModulePackage(govde, key) === null);
  check("§1e başlık anahtarsız okunur, düz metin pakette YOK", readModulePackageHeader(pkg)?.header.kid === moduleKeyId(key) && !pkg.includes("tekserp-duz-metin-isareti"));
}

interface KiraSenaryosu {
  readonly f: Fikstur;
  readonly alici: { ozel: string; acik: string };
  readonly kid: string;
  readonly hak: (ek?: Partial<LeaseDoc>) => string;
}

function kiraSenaryosu(): KiraSenaryosu {
  const f = fiksturKur(Date.now());
  const alici = x25519();
  const key = randomBytes(32);
  const kid = moduleKeyId(key);
  const grant = { modul: MODUL, surum: 1, kid, sarma: wrapModuleKey({ moduleKey: key, recipientPublicX: alici.acik, modul: MODUL }) };
  return { f, alici, kid, hak: (ek = {}) => kiraBas(f, { modulAnahtarlari: [grant], ...ek }) };
}

function bolum2(ad: string, core: LicenseCore, s: KiraSenaryosu): void {
  const hakDocu = hakBas(s.f, { moduller: ["production.enabled", MODUL] });
  const ac = (lease: string, g: { ozel?: string; entitlement?: string } = {}) =>
    core.unwrapLeaseModuleKey({ lease, entitlement: g.entitlement ?? hakDocu, privateKeyX: g.ozel ?? s.alici.ozel, modul: MODUL, kid: s.kid, roots: s.f.kokler });
  const ok = ac(s.hak());
  check(`§2a [${ad}] geçerli kira + kurulumun anahtarı → modül anahtarı (kid eşit)`, ok.ok && moduleKeyId(Buffer.from(ok.value.anahtar, "base64url")) === s.kid);
  const baska = ac(s.hak(), { ozel: x25519().ozel });
  check(`§2b [${ad}] ✓K başka kurulumun anahtarı AÇAMAZ`, !baska.ok && baska.code === "MODUL_SARMA_ACILAMADI", baska.ok ? "açtı" : baska.code);
  const donmus = ac(s.hak({ yaptirim: { kademe: "K2", mesaj: null, kisitlamaTarihi: null, donmusModuller: [MODUL], guncellemeDonuk: false } }));
  check(`§2c [${ad}] ✓K donmuş modül (hak kirada olsa bile) → anahtar YOK`, !donmus.ok && donmus.code === "MODUL_DONMUS", donmus.ok ? "açtı" : donmus.code);
  const yok = ac(kiraBas(s.f));
  check(`§2d [${ad}] ✓K anahtarsız kira → açılamaz`, !yok.ok && yok.code === "MODUL_ANAHTARI_YOK", yok.ok ? "açtı" : yok.code);
  const hakta = ac(s.hak(), { entitlement: hakBas(s.f, { moduller: ["production.enabled"] }) });
  check(`§2e [${ad}] HAK'ta olmayan modül → açılamaz`, !hakta.ok && hakta.code === "MODUL_HAK_YOK", hakta.ok ? "açtı" : hakta.code);
}

type HostMap = Record<string, () => unknown>;

interface ModulPaketi {
  readonly pkgDir: string;
  readonly key: Buffer;
}

async function bolum3ve4(): Promise<ModulPaketi | null> {
  console.log("\n§3 yükleyici — GERÇEK depo-multi paketi bellekte, çekirdeğin örnekleriyle");
  const { katalogOku, modulPaketiDerle } = await import("./lib/sifreli-modul-derle.mjs");
  const esbuild = createRequire(path.join(TEKS, "package.json"))("esbuild") as unknown;
  const paket = katalogOku(TEKS).find((p) => p.modul === MODUL);
  if (!paket) {
    check("§3 katalogda depo-multi var", false);
    return null;
  }
  const duz = path.join(TEMP, "derleme", "depo-multi.cjs");
  const { ev } = await modulPaketiDerle({ esbuild, proj: TEKS, giris: paket.giris, dosyalar: paket.dosyalar, outfile: duz, disarida: ["@prisma/client", ".prisma/client", ".prisma/client/default", "prisma", "bwip-js"] });
  const yuzey = [...ev.keys()];
  check("§3a sınır: paket yalnız modülün dosyaları; çekirdek + npm ev sahibinden (prisma · zod · express aynı örnek)", yuzey.includes("src:lib/prisma") && yuzey.includes("npm:zod") && yuzey.includes("npm:express") && !yuzey.some((k) => paket.dosyalar.some((d) => k === `src:${d.replace(/\.ts$/, "")}`)), `${yuzey.length} parça`);
  const host: HostMap = {};
  for (const [k, v] of ev) host[k] = () => require(v.tur === "src" ? v.yol : v.ad);
  const key = randomBytes(32);
  const pkgDir = path.join(TEMP, "paket");
  mkdirSync(pkgDir, { recursive: true });
  const kod = readFileSync(duz);
  const isaret = "Kaynak ve hedef depo";
  writeFileSync(path.join(pkgDir, "depo-multi.tkmod"), sealModulePackage({ code: kod, key, modul: MODUL, paket: "depo-multi", surum: 1, kid: moduleKeyId(key) }));
  rmSync(path.join(TEMP, "derleme"), { recursive: true, force: true });
  const { createModuleLoader } = await import("../src/lib/license/encrypted-module-router");
  const { getRegisteredDocBuilders } = await import("../src/services/printed-document.service");
  const hata = async (unlock: (m: string, k: string) => { ok: true; key: Buffer; surum: number; kaynak: "kira" } | { ok: false; code: string; message: string }) => {
    const loader = createModuleLoader("depo-multi", { packageDir: pkgDir, host, unlock });
    let yakalanan: unknown = null;
    loader.handler({} as Request, {} as Response, ((e?: unknown) => (yakalanan = e ?? "devredildi")) as NextFunction);
    return yakalanan;
  };
  const anahtarsiz = await hata(() => ({ ok: false, code: "MODUL_DONMUS", message: "dondurulmuş" }));
  const e = anahtarsiz instanceof AppError ? anahtarsiz : null;
  check("§3b ✓K anahtarsız AÇILAMAZ → 403 LICENSE_MODULE (details.modul, neden ANAHTAR_YOK)", e?.statusCode === 403 && e.details?.code === "LICENSE_MODULE" && e.details?.modul === MODUL && e.details?.neden === "ANAHTAR_YOK", e ? `${e.statusCode} ${String(e.details?.code)}` : String(anahtarsiz));
  const yanlis = await hata(() => ({ ok: true, key: randomBytes(32), surum: 1, kaynak: "kira" }));
  check("§3c yanlış anahtar → 403 (paket açılmaz, kod koşmaz)", yanlis instanceof AppError && yanlis.details?.anahtar === "PAKET_ACILAMADI" && !getRegisteredDocBuilders().has("TRANSFER_DISPATCH"));
  const once = readdirSync(pkgDir).sort().join(",");
  const loader = createModuleLoader("depo-multi", { packageDir: pkgDir, host, unlock: () => ({ ok: true, key: Buffer.from(key), surum: 1, kaynak: "kira" }) });
  const yuklendi = loader.tryLoad();
  check("§3d doğru anahtar → modül bellekte derlenir, çekirdeğin belge kayıt defterine bağlanır (aynı örnek)", yuklendi.ok && getRegisteredDocBuilders().has("TRANSFER_DISPATCH"), yuklendi.ok ? [...getRegisteredDocBuilders().keys()].join(",") : `${yuklendi.code} ${yuklendi.message}`);

  console.log("\n§4 düz metin diske düşmez");
  const pkg = readFileSync(path.join(pkgDir, "depo-multi.tkmod"));
  check("§4a paket dosyasında modülün düz metni YOK", !pkg.includes(isaret) && kod.includes(isaret), `pakette ${pkg.includes(isaret)} · düzde ${kod.includes(isaret)} · ${kod.length} bayt`);
  check("§4b yükleme paket dizinine dosya YAZMADI", readdirSync(pkgDir).sort().join(",") === once, readdirSync(pkgDir).join(","));
  const yazanlar = ["src/lib/license/encrypted-module.ts", "src/lib/license/encrypted-module-router.ts", "src/lib/license/module-unlock.ts"].filter((f) =>
    /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|writeFileAtomicSync|copyFile)\b/.test(oku(f)),
  );
  check("§4c ✓K çözme/derleme yolunda hiçbir dosya yazma çağrısı yok", yazanlar.length === 0, yazanlar.join(", "));
  return { pkgDir, key };
}

/**
 * §7 GERÇEK paket biçiminde (esbuild çekirdek + eklenti) ev sahibi aynı örneği verir: çift paketli npm
 * (zod `import` ↔ `require` başka dosya) iki kopya doğurursa `instanceof` kırılır; şifresiz korumalı
 * derleme de eklentisiz kalırsa `tekserp:module-host` çözülemez (ikisi de ölçülerek yakalandı).
 */
async function bolum7(p: ModulPaketi): Promise<void> {
  console.log("\n§7 korumalı derleme biçiminde yükleme (esbuild + eklenti, ayrı süreç)");
  const { cekirdekEklentisi, katalogOku, modulPaketiDerle } = await import("./lib/sifreli-modul-derle.mjs");
  const esbuild = createRequire(path.join(TEKS, "package.json"))("esbuild") as { build(o: Record<string, unknown>): Promise<unknown> };
  const disarida = ["@prisma/client", ".prisma/client", ".prisma/client/default", "prisma", "bwip-js"];
  const paketler = katalogOku(TEKS).filter((k) => k.modul === MODUL);
  const { ev } = await modulPaketiDerle({ esbuild, proj: TEKS, giris: paketler[0]!.giris, dosyalar: paketler[0]!.dosyalar, outfile: path.join(TEMP, "d7", "m.cjs"), disarida });
  const giris = path.join(TEMP, "d7", "giris.ts");
  const kaynak = (dosya: string) => JSON.stringify(path.join(TEKS, "src", dosya));
  writeFileSync(giris, [
    `import { createModuleLoader } from ${kaynak("lib/license/encrypted-module-router")};`,
    `import { getRegisteredDocBuilders } from ${kaynak("services/printed-document.service")};`,
    `import { ZodError } from "zod";`,
    `const HOST = require("tekserp:module-host").HOST;`,
    `const [dir, k] = process.argv.slice(2);`,
    `const r = createModuleLoader("depo-multi", { packageDir: dir, unlock: () => ({ ok: true, key: Buffer.from(k, "base64url"), surum: 1, kaynak: "kira" }) }).tryLoad();`,
    `console.log("SONUC " + JSON.stringify({ ok: r.ok, kod: r.ok ? null : r.code, belge: getRegisteredDocBuilders().has("TRANSFER_DISPATCH"), zod: HOST["npm:zod"]().ZodError === ZodError }));`,
    `process.exit(0);`,
  ].join("\n"));
  const cikti = path.join(TEMP, "d7", "cekirdek.cjs");
  const derle = async (liste: typeof paketler) => {
    try {
      await esbuild.build({ entryPoints: [giris], outfile: cikti, bundle: true, platform: "node", format: "cjs", external: disarida, nodePaths: [path.join(TEKS, "node_modules")], logLevel: "silent", plugins: [cekirdekEklentisi({ proj: TEKS, paketler: liste, ev })] });
      return true;
    } catch {
      return false;
    }
  };
  check("§7a şifresiz korumalı derleme (paket yok) çekirdeği yine derler — ev sahibi eklentisi takılı", await derle([]));
  const derlendi = await derle(paketler);
  const cocuk = derlendi ? spawnSync(process.execPath, [cikti, p.pkgDir, p.key.toString("base64url")], { cwd: TEKS, env: { ...process.env, NODE_PATH: path.join(TEKS, "node_modules") }, encoding: "utf8", timeout: 120_000 }) : null;
  const satir = cocuk?.stdout.split("\n").find((l) => l.startsWith("SONUC ")) ?? null;
  const sonucu = satir ? (JSON.parse(satir.slice(6)) as { ok: boolean; kod: string | null; belge: boolean; zod: boolean }) : null;
  check("§7b ✓K paketli çekirdekte modül yüklenir, belge kayıt defteri ve zod AYNI örnek (çift kopya yok)", !!sonucu?.ok && sonucu.belge && sonucu.zod, satir ?? (cocuk?.stderr ?? "derlenmedi").slice(-300));
}

function bolum5(): void {
  console.log("\n§5 üretimde TS'e düşme yok");
  const zorunlu = loadLicenseCoreFrom({ required: true, cwd: TEMP, env: {}, platform: process.platform, arch: process.arch });
  const s = kiraSenaryosu();
  const r = zorunlu.core.unwrapLeaseModuleKey({ lease: s.hak(), entitlement: hakBas(s.f, { moduller: [MODUL] }), privateKeyX: s.alici.ozel, modul: MODUL, kid: s.kid, roots: s.f.kokler });
  check("§5a ✓K zorunlu kipte native yoksa anahtar AÇILMAZ (CEKIRDEK_YOK; TS kâhini kullanılmaz)", zorunlu.core.source === "yok" && !r.ok && r.code === "CEKIRDEK_YOK", `${zorunlu.core.source} ${r.ok ? "açtı" : r.code}`);
  const kaynak = oku("src/lib/license/module-unlock.ts");
  check(
    "§5b anahtar yolu çekirdeği YALNIZ getLicenseCore()'dan alır (tsLicenseCore / TS açıcı içe aktarılmaz)",
    /getLicenseCore\(\)\.unwrapLeaseModuleKey/.test(kaynak) && !/tsLicenseCore|from "\.\/module-key"|from "\.\/license-core"/.test(kaynak),
  );
}

async function bolum6(): Promise<void> {
  console.log("\n§6 kurulumun X25519 anahtarı");
  const store = await import("../src/lib/license/store");
  const dir = path.join(TEMP, "lisans");
  const yeni = store.loadLicenseStoreSync({ dir });
  const dosya = () => JSON.parse(readFileSync(path.join(dir, store.LICENSE_FILES.KEY), "utf8")) as { x25519: { x: string } | null };
  check("§6a yeni kurulum anahtarı X25519 ile doğar (dosyada, açık yarı tutarlı)", !!yeni.key?.x25519 && dosya().x25519?.x === yeni.key.x25519.publicX);
  const kid = yeni.key?.kid;
  const eski = { ...JSON.parse(readFileSync(path.join(dir, store.LICENSE_FILES.KEY), "utf8")), x25519: null };
  writeFileSync(path.join(dir, store.LICENSE_FILES.KEY), JSON.stringify(eski));
  const yuklu = store.loadLicenseStoreSync({ dir });
  const ilk = store.ensureInstallationX25519();
  const ikinci = store.ensureInstallationX25519();
  check("§6b eski dosya (x25519 null) → ilk yoklamada doğar, dosyaya yazılır, kararlı; kimlik (kid) DEĞİŞMEZ", yuklu.key?.x25519 === null && !!ilk && ilk.publicX === ikinci?.publicX && dosya().x25519?.x === ilk.publicX && store.getLicenseStore()?.key?.kid === kid);
  writeFileSync(path.join(dir, store.LICENSE_FILES.KEY), JSON.stringify({ ...eski, x25519: { d: ilk?.privateX, x: x25519().acik } }));
  const bozuk = store.loadLicenseStoreSync({ dir });
  check("§6c tutarsız X25519 Ed25519 kimliğini BOZMAZ (kenara alınmaz, x25519 null → yenilenir)", bozuk.key?.kid === kid && bozuk.setAsideKeyFile === null && bozuk.key?.x25519 === null);
  const { encryptionKeyField } = await import("../src/services/helpers/license-wire.helper");
  check("§6d yoklama/etkinleştirme gövdesi açık yarıyı taşır (sifrelemeAnahtari)", encryptionKeyField().sifrelemeAnahtari === store.getLicenseStore()?.key?.x25519?.publicX);
}

async function main(): Promise<void> {
  bolum1();
  console.log("\n§2 anahtar YALNIZ doğrulanmış kiradan");
  bolum2("TS", tsLicenseCore, kiraSenaryosu());
  const yerel = loadLicenseCoreFrom({ required: false, cwd: TEKS, env: process.env, platform: process.platform, arch: process.arch });
  const neden = yerel.status.kaynak === "native" ? "" : yerel.status.ayrinti;
  if (yerel.core.source === "native") bolum2("native", yerel.core, kiraSenaryosu());
  else if (process.env.TEKSERP_STRICT === "1") check("§2 native test derlemesi (TEKSERP_STRICT)", false, neden);
  else console.log(`⏭ §2 native kolu ATLANDI — ${neden} (derle: cd native/lisans-cekirdek && npm run derle)`);
  const paket = await bolum3ve4();
  if (paket) await bolum7(paket);
  bolum5();
  await bolum6();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  rmSync(TEMP, { recursive: true, force: true });
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  rmSync(TEMP, { recursive: true, force: true });
  process.exit(1);
});
