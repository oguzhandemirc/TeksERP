// =============================================================================
// BEKÇİ — lisans Faz 2e: imzalı dosya listesi · derleme künyesi · filigran · native'e bağlama
// =============================================================================
// DB'siz. Geçici dizinlerde küçük paketler kurar, GEÇİCİ PAKET anahtarlarıyla imzalar (satıcı
// anahtarı gerekmez). NE ÖLÇER:
//   §1 imzalı yük + liste dosyası: geçerli · kurcalanmış · eksik · FAZLA (kapsamda / dışında /
//      node_modules / sembolik bağ; ÇEKİRDEKTE, TS ikinci katman) · migration SQL · liste dosyası
//      kurcalı/silinmiş · imzasız · yanlış anahtar · liste yok · eski hazırlık PAKET kid'i gömülü çapada YOK · filigran ·
//      yeni HAK: aynı ölçümün kararı yeni sınıfla (`decideForClass`) o sınıfla tam denetime eşit (§1q–§1s) ·
//      ⭐ yalancı çekirdek (imza denetlemeden "geçerli" der): ikinci katman imzayı TS'te yeniden doğrular,
//      imzasız başlıktan kid okumaz → GECERSIZ BUTUNLUK_IMZA (§1t)
//   §2 çapa: tek kip — PAKET listesi yalnız paket-<yıl>, hazırlık listesi YOK, derlemenin çapası üretim listesi,
//      paket-hazirlik* üretim kid kuralının dışında; kapsam
//   §3 merdiven + künye + çapa kalıcılığı (saf): uyuşma damgayı silmez, yalnız yeni paketId sıfırlar
//   §4 native'e bağlama: motor çekirdekten geçer; zorunlu kipte TS'e düşme YOK; `.node` dlopen
//      ÖNCESİ imzalı listeye karşı (liste yok / yanlış anahtar / kurcalanmış → çekirdek YOK); korumalı derleme
//      sabitlerini tanımlar, çapa kipi sabiti YOK (tek kip); paketleme native kip denetimi (§4j)
//   §5 imza aracı: öz-denetim, liste JWS tavanına takılmaz, derleme künyesi, node_modules'süz paket
//   §5' şifreli modül paketleri (.tkmod, 2d) imzalı kapsamda: değişen UYUSMAZ, sonradan beliren FAZLA
//   §7 korumalı yükleyici: execArgv/NODE_OPTIONS enjeksiyon bayrağı → GECERSIZ BUTUNLUK_YUKLEYICI (dosya raporu korunur, geliştirme etkilenmez)
//   §6 Docker teslim künyesi (`PAKET-DOCKER.json`): kapsamdaki teslim dosyaları imzada listelenir, ek alanlar imzada, kurcalama GECERSIZ, eksik dosyayla imza yok, CLI `belge`
// Koşum: node ../scripts/agir-is.mjs -- npx tsx scripts/test_lisans_butunluk.ts
// =============================================================================
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createPrivateKey, randomUUID } from "node:crypto";
import { atlamaDefteri } from "./lib/atlama";
import { generatePackageKey, signManifestDocument, signPackageDirectory, writePackageKey } from "./lib/butunluk-imza";
import { signJws, type RootKey } from "../src/lib/license/protocol";
import {
  INTEGRITY_TYP,
  PACKAGE_PUBLIC_KEYS,
  PRODUCTION_PACKAGE_PUBLIC_KEYS,
  verifyIntegrity,
  type PackageKey,
} from "../src/lib/license/integrity";
import { INTEGRITY_FILE, INTEGRITY_SCOPE_DIRS, INTEGRITY_SCOPE_FILES, isProductionPackageKid } from "../src/lib/license/integrity-scope";
import * as butunlukModulu from "../src/lib/license/integrity";
import { INTEGRITY_LIST_FILE } from "../src/lib/license/integrity-list";
import { MODULE_PACKAGE_EXT } from "../src/lib/license/encrypted-module";
import { decideForClass, detectLoaderInjection, integrityReason, runIntegrityCheck, type IntegrityCheckInput } from "../src/lib/license/integrity-check";
import { tsLicenseCore, type LicenseCore } from "../src/lib/license/license-core";
import { unavailableCore } from "../src/lib/license/native-adapter";
import { loadLicenseCoreFrom, nativeFileName } from "../src/lib/license/native";
import { evaluateIntegrity } from "../src/lib/license/state-rules-package";
import type { Finding } from "../src/lib/license/state-rules";
import type { StateRecord } from "../src/lib/license/saat";
import { verifyLicenseDocuments } from "../src/lib/license/state";
import {
  __resetIntegrityStateForTests,
  buildDateMsForState,
  integrityAnchorMs,
  integrityRecordPatch,
  integrityStatusForState,
  setIntegrityOutcome,
} from "../src/lib/license/integrity-state";
import type { IntegrityOutcome } from "../src/lib/license/integrity-check";
import { bolum8 } from "./lib/butunluk-zincir-bolum";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

const TEKS = path.resolve(__dirname, "..");
const TEMP = mkdtempSync(path.join(tmpdir(), "lisans-butunluk-"));
const oku = (p: string) => readFileSync(path.join(TEKS, p), "utf8");

interface TestKey {
  readonly kid: string;
  readonly x: string;
  readonly privateKey: ReturnType<typeof createPrivateKey>;
}
function anahtar(kid: string): TestKey {
  const f = generatePackageKey(kid, ["TEST"]);
  return { kid, x: f.x, privateKey: createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", x: f.x, d: f.d }, format: "jwk" }) };
}
const A = anahtar("paket-2099");
const B = anahtar("paket-2098");
const H = anahtar("paket-hazirlik");
const keysOf = (...k: TestKey[]): PackageKey[] => k.map((x) => ({ kid: x.kid, x: x.x }));

/** Küçük paket kökü: dist/ + native/ + node_modules/ + prisma/migrations/ + kökte package.json + kapsam dışı logs/. */
function paket(ad: string): string {
  const kok = path.join(TEMP, ad);
  mkdirSync(path.join(kok, "dist", "tools"), { recursive: true });
  mkdirSync(path.join(kok, "native"), { recursive: true });
  mkdirSync(path.join(kok, "logs"), { recursive: true });
  writeFileSync(path.join(kok, "dist", "server.js"), "require('./server.jsc')\n");
  writeFileSync(path.join(kok, "dist", "server.jsc"), Buffer.alloc(2048, 7));
  writeFileSync(path.join(kok, "dist", "tools", "arac.cjs"), "module.exports = 1;\n");
  writeFileSync(path.join(kok, "native", "lisans-cekirdek.test.node"), Buffer.alloc(512, 3));
  mkdirSync(path.join(kok, "node_modules", "express", "Quick Start"), { recursive: true });
  writeFileSync(path.join(kok, "node_modules", "express", "index.js"), "module.exports = {};\n");
  writeFileSync(path.join(kok, "node_modules", "express", "Quick Start", "ilk.md"), "# boşluklu ad\n");
  mkdirSync(path.join(kok, "prisma", "migrations", "20260929000000_ilk"), { recursive: true });
  writeFileSync(path.join(kok, "prisma", "migrations", "20260929000000_ilk", "migration.sql"), "CREATE TABLE x (id uuid);\n");
  writeFileSync(path.join(kok, "package.json"), '{"name":"tekserp-backend"}\n');
  writeFileSync(path.join(kok, "logs", "out.log"), "log\n");
  return kok;
}
const imzala = (kok: string, k: TestKey, o: { musteri?: string | null; paketId?: string; derleme?: string } = {}) =>
  signPackageDirectory({
    root: kok,
    key: k,
    urun: "backend",
    surum: "2.12.0",
    derlemeTarihi: o.derleme ?? "2026-09-29T20:00:00.000Z",
    musteri: o.musteri ?? null,
    paketId: o.paketId,
  });

function girdi(kok: string, o: Partial<IntegrityCheckInput> = {}): IntegrityCheckInput {
  // Süreç bayrakları temiz verilir: bekçinin kendisi tsx yükleyicisiyle (--require/--import) koşar; §7 ayrıca ölçer.
  return { root: kok, required: true, core: tsLicenseCore, keys: keysOf(A), entitlementClass: "URETIM", watermark: null, runtimeFlags: { execArgv: [], nodeOptions: undefined }, ...o };
}

async function bolum1(core: LicenseCore, ek: string): Promise<void> {
  console.log(`\n§1 imzalı liste (${ek})`);
  const k = paket(`s1-${ek}`);
  await imzala(k, A);
  const ok = await runIntegrityCheck(girdi(k, { core }));
  check(`§1a geçerli paket → GECERLI + imzalı künye (${ek})`, ok.durum === "GECERLI" && ok.kunye?.derlemeTarihi === "2026-09-29T20:00:00.000Z" && ok.kid === A.kid, `${ok.durum} ${ok.kod ?? ""}`);

  writeFileSync(path.join(k, "logs", "yeni.log"), "x\n");
  const disari = await runIntegrityCheck(girdi(k, { core }));
  check(`§1b kapsam DIŞINDA fazla dosya (logs/) sorulmaz (${ek})`, disari.durum === "GECERLI");

  writeFileSync(path.join(k, "dist", "yama.js"), "evil()\n");
  const fazla = await runIntegrityCheck(girdi(k, { core }));
  check(`§1c kapsamda FAZLA dosya (dist/yama.js) → GECERSIZ BUTUNLUK_FAZLA (${ek})`, fazla.durum === "GECERSIZ" && fazla.kod === "BUTUNLUK_FAZLA" && fazla.fazla.includes("dist/yama.js"));
  rmSync(path.join(k, "dist", "yama.js"));

  appendFileSync(path.join(k, "dist", "server.js"), "// yama\n");
  const kurc = await runIntegrityCheck(girdi(k, { core }));
  check(`§1d kurcalanmış dosya → GECERSIZ BUTUNLUK_UYUSMAZ (${ek})`, kurc.durum === "GECERSIZ" && kurc.kod === "BUTUNLUK_UYUSMAZ" && (kurc.rapor?.degisik ?? []).includes("dist/server.js"));
  await imzala(k, A);

  rmSync(path.join(k, "dist", "tools", "arac.cjs"));
  const eksik = await runIntegrityCheck(girdi(k, { core }));
  check(`§1e eksik dosya → GECERSIZ BUTUNLUK_UYUSMAZ (${ek})`, eksik.durum === "GECERSIZ" && eksik.kod === "BUTUNLUK_UYUSMAZ" && (eksik.rapor?.eksik ?? []).includes("dist/tools/arac.cjs"));
  await imzala(k, A);

  const yanlis = await runIntegrityCheck(girdi(k, { core, keys: keysOf(B) }));
  check(`§1f yanlış anahtar → GECERSIZ (JWS_*) (${ek})`, yanlis.durum === "GECERSIZ" && (yanlis.kod ?? "").startsWith("JWS_"), `${yanlis.kod}`);

  const token = readFileSync(path.join(k, INTEGRITY_FILE), "utf8").trim();
  const [h, p] = token.split(".");
  writeFileSync(path.join(k, INTEGRITY_FILE), `${h}.${p}.${"A".repeat(86)}\n`);
  const imzasiz = await runIntegrityCheck(girdi(k, { core }));
  check(`§1g imzası bozuk liste → GECERSIZ (JWS_*) (${ek})`, imzasiz.durum === "GECERSIZ" && (imzasiz.kod ?? "").startsWith("JWS_"), `${imzasiz.kod}`);
  const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: INTEGRITY_TYP, kid: A.kid })).toString("base64url")}.${p}.`;
  writeFileSync(path.join(k, INTEGRITY_FILE), `${none}\n`);
  const algNone = await runIntegrityCheck(girdi(k, { core }));
  check(`§1h imzasız (alg none) liste → GECERSIZ (${ek})`, algNone.durum === "GECERSIZ" && algNone.kunye === null, `${algNone.kod}`);

  await imzala(k, A);
  writeFileSync(path.join(k, "node_modules", "opsiyonel.js"), "evil()\n");
  const nm = await runIntegrityCheck(girdi(k, { core }));
  check(`§1m node_modules'te FAZLA dosya (isteğe bağlı bağımlılık gölgesi) → GECERSIZ BUTUNLUK_FAZLA, ÇEKİRDEK raporunda (${ek})`, nm.kod === "BUTUNLUK_FAZLA" && nm.rapor?.kod === "BUTUNLUK_FAZLA" && (nm.rapor?.fazla ?? []).includes("node_modules/opsiyonel.js"), `${nm.kod} rapor=${nm.rapor?.kod}`);
  rmSync(path.join(k, "node_modules", "opsiyonel.js"));
  const sql = path.join(k, "prisma", "migrations", "20260929000000_ilk", "migration.sql");
  writeFileSync(sql, "DROP TABLE x;;;;;;;;;;;;;;;\n");
  const mig = await runIntegrityCheck(girdi(k, { core }));
  check(`§1n migration SQL değişti → GECERSIZ BUTUNLUK_UYUSMAZ (${ek})`, mig.kod === "BUTUNLUK_UYUSMAZ" && (mig.rapor?.degisik ?? []).some((f) => f.endsWith("migration.sql")));
  writeFileSync(sql, "CREATE TABLE x (id uuid);\n");
  symlinkSync(path.join(k, "logs"), path.join(k, "dist", "bag"));
  const bag = await runIntegrityCheck(girdi(k, { core }));
  check(`§1o kapsamda sembolik bağ izlenmez, kendisi FAZLA sayılır (${ek})`, bag.kod === "BUTUNLUK_FAZLA" && (bag.rapor?.fazla ?? []).includes("dist/bag"), `${bag.kod}`);
  rmSync(path.join(k, "dist", "bag"));
  const listeYolu = path.join(k, INTEGRITY_LIST_FILE);
  const listeMetni = readFileSync(listeYolu);
  writeFileSync(listeYolu, Buffer.from(listeMetni.toString("latin1").replace("dist/server.js", "dist/server.jx"), "latin1"));
  const lb = await runIntegrityCheck(girdi(k, { core }));
  rmSync(listeYolu);
  const ly = await runIntegrityCheck(girdi(k, { core }));
  check(`§1p liste dosyası kurcalı/silinmiş → GECERSIZ BUTUNLUK_LISTE_BOZUK (${ek})`, lb.kod === "BUTUNLUK_LISTE_BOZUK" && ly.kod === "BUTUNLUK_LISTE_BOZUK" && (ly.rapor?.eksik ?? []).includes(INTEGRITY_LIST_FILE));

  await okunamayanDosya(k, core, ek);

  rmSync(path.join(k, INTEGRITY_FILE));
  const yokZ = await runIntegrityCheck(girdi(k, { core }));
  const yokG = await runIntegrityCheck(girdi(k, { core, required: false }));
  check(`§1i liste yok: korumalı pakette GECERSIZ BUTUNLUK_LISTE_YOK · geliştirmede KAPSAM_DISI (${ek})`, yokZ.durum === "GECERSIZ" && yokZ.kod === "BUTUNLUK_LISTE_YOK" && yokG.durum === "KAPSAM_DISI");
}

/** G12 §3.3: zorunlu kipte imzalı listedeki dosya OKUNAMIYORSA değişmiş sayılır (kilitli/izinsiz dosya denetimi atlatamaz). */
async function okunamayanDosya(k: string, core: LicenseCore, ek: string): Promise<void> {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    console.log(`⏭️  §1z atlandı (Windows ya da root: izin kilidi ölçülemez) (${ek})`);
    return;
  }
  await imzala(k, A);
  const hedef = path.join(k, "dist", "server.js");
  chmodSync(hedef, 0o000);
  try {
    const z = await runIntegrityCheck(girdi(k, { core }));
    const g = await runIntegrityCheck(girdi(k, { core, required: false }));
    check(
      `§1z ⭐ listedeki dosya okunamıyor: ZORUNLU kipte GECERSIZ BUTUNLUK_OKUNAMAYAN (değişmiş sayılır) · geliştirmede ÖLÇÜLEMEDİ (${ek})`,
      z.durum === "GECERSIZ" && z.kod === "BUTUNLUK_OKUNAMAYAN" && (z.rapor?.okunamayan ?? []).includes("dist/server.js") && g.durum === "OLCULEMEDI",
      `${z.durum}/${z.kod} · ${g.durum}/${g.kod}`,
    );
  } finally {
    chmodSync(hedef, 0o644);
  }
}

async function bolum1b(): Promise<void> {
  console.log("\n§1' eski hazırlık PAKET kid'i + filigran");
  const k = paket("s1b");
  await imzala(k, H, { musteri: "testfabrika", paketId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b" });
  const g = (o: Partial<IntegrityCheckInput>) => runIntegrityCheck(girdi(k, { keys: keysOf(H), ...o }));
  const uretim = await g({ entitlementClass: "URETIM" });
  const test = await g({ entitlementClass: "TEST" });
  const gomuluTest = await g({ keys: undefined, entitlementClass: "TEST" });
  const gomuluUretim = await g({ keys: undefined, entitlementClass: "URETIM" });
  check(
    "§1j ⭐ eski hazırlık PAKET kid'i (paket-hazirlik) gömülü çapada YOK: TEST'te de ÜRETİM'de de GECERSIZ, künye güvenilmez",
    gomuluTest.durum === "GECERSIZ" && gomuluUretim.durum === "GECERSIZ" && gomuluTest.kunye === null && gomuluUretim.kunye === null,
    `${gomuluTest.kod} · ${gomuluUretim.kod}`,
  );
  check(
    "§1k kid ailesine özel sınıf kuralı YOK (kapı gömülü çapadır): aynı anahtar çapada açıkça verilirse ÜRETİM'de de TEST'te de GECERLI",
    uretim.durum === "GECERLI" && test.durum === "GECERLI",
    `${uretim.durum}/${uretim.kod} · ${test.durum}/${test.kod}`,
  );
  const esit = await g({ entitlementClass: "TEST", watermark: { musteri: "testfabrika", kurulumId: null, paketId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", derlemeTarihi: null } });
  const baska = await g({ entitlementClass: "TEST", watermark: { musteri: "baskafabrika", kurulumId: null, paketId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", derlemeTarihi: null } });
  const baskaPaket = await g({ entitlementClass: "TEST", watermark: { musteri: "testfabrika", kurulumId: null, paketId: randomUUID(), derlemeTarihi: null } });
  check("§1l filigran: bayt kodu = imzalı künye → GECERLI · başka müşteri/paket → GECERSIZ BUTUNLUK_FILIGRAN", esit.durum === "GECERLI" && baska.kod === "BUTUNLUK_FILIGRAN" && baskaPaket.kod === "BUTUNLUK_FILIGRAN");
}

async function bolum1c(): Promise<void> {
  console.log("\n§1'' yeni HAK: aynı ölçümün kararı yeni sınıfla (decideForClass) = o sınıfla tam denetim");
  const k = paket("s1c");
  const pid = "7a2b3c4d-5e6f-4a70-8b9c-0d1e2f3a4b5c";
  await imzala(k, H, { musteri: "testfabrika", paketId: pid });
  const g = (o: Partial<IntegrityCheckInput>) => runIntegrityCheck(girdi(k, { keys: keysOf(H), ...o }));
  const iz = (o: IntegrityOutcome | null) =>
    o === null ? "null" : JSON.stringify([o.durum, o.kod, o.kid, o.kunye, o.fazla, o.fazlaSayisi, o.yukleyiciBayraklari, o.rapor]);
  const esdeger = async (ad: string, olcumGirdisi: Partial<IntegrityCheckInput>, sinif: string | null): Promise<string | null> => {
    const once = await g({ ...olcumGirdisi, entitlementClass: null });
    const karar = decideForClass(once, sinif);
    const tam = await g({ ...olcumGirdisi, entitlementClass: sinif });
    return iz(karar) === iz(tam) && karar?.denetlendi === once.denetlendi ? null : `${ad}: ${karar?.durum}/${karar?.kod} ≠ ${tam.durum}/${tam.kod}`;
  };
  const baska = { musteri: "baskafabrika", kurulumId: null, paketId: pid, derlemeTarihi: null };
  const enjeksiyon = { execArgv: ["--require", "/x.js"], nodeOptions: undefined };
  const farklar: string[] = [];
  for (const sinif of ["TEST", "DEMO", "URETIM", null]) farklar.push((await esdeger(`sınıf ${sinif}`, {}, sinif)) ?? "");
  farklar.push((await esdeger("filigran uyuşmaz", { watermark: baska }, "TEST")) ?? "");
  farklar.push((await esdeger("yükleyici enjeksiyonu", { runtimeFlags: enjeksiyon }, "TEST")) ?? "");
  writeFileSync(path.join(k, "dist", "yama.js"), "evil()\n");
  farklar.push((await esdeger("kapsamda FAZLA", {}, "TEST")) ?? "");
  rmSync(path.join(k, "dist", "yama.js"));
  const kotu = farklar.filter(Boolean);
  check("§1q ⭐ sınıfsız ölçümün kararı TEST/DEMO/URETIM/null · filigran · enjeksiyon · FAZLA'da o sınıfla tam denetime EŞİT, `denetlendi` ölçüm anı", kotu.length === 0, kotu.join(" | ") || `${farklar.length} durum eşit`);
  const bilinmez = await g({ entitlementClass: null });
  const test = decideForClass(bilinmez, "TEST");
  // Etkinleştirme penceresi (sınıf bilinmiyor → OLCULEMEDI) yalnız dar zincir sertifikasında doğar: §8f'.
  check("§1r zincirsiz listede kid ailesine bağlı pencere YOK: sınıf bilinmese de GECERLI + imzalı künye; yeni sınıfla karar aynı",
    bilinmez.durum === "GECERLI" && bilinmez.kunye?.derlemeTarihi === "2026-09-29T20:00:00.000Z" && test?.durum === "GECERLI" && test.kunye?.derlemeTarihi === "2026-09-29T20:00:00.000Z", `${bilinmez.durum}/${bilinmez.kod} → ${test?.durum}`);
  rmSync(path.join(k, INTEGRITY_FILE));
  const listesiz = await g({ entitlementClass: null });
  check("§1s ölçümü olmayan sonuç (liste yok) yeniden kararlanmaz → null (tam denetim beklenir)", listesiz.olcum === null && decideForClass(listesiz, "TEST") === null, `${listesiz.kod}`);
}

/**
 * §1t yamalı çekirdek yabancı anahtarın (B) imzasını da "geçerli" sayar; ikinci katman bu derlemenin anahtarıyla
 * (A) yeniden doğrular. Başlıktaki kid A'ya çevrilse de imzasız okunmaz.
 */
async function bolum1d(): Promise<void> {
  console.log("\n§1''' ikinci katman imzayı kendisi doğrular (yalancı çekirdek)");
  const k = paket("s1d");
  await imzala(k, B);
  const yalanci: LicenseCore = { ...tsLicenseCore, verifyIntegrity: (manifest, root) => tsLicenseCore.verifyIntegrity(manifest, root, keysOf(A, B)) };
  const sonuc = await runIntegrityCheck(girdi(k, { core: yalanci, keys: keysOf(A) }));
  const token = readFileSync(path.join(k, INTEGRITY_FILE), "utf8").trim();
  const [, govde, imza] = token.split(".");
  const sahteBaslik = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: INTEGRITY_TYP, kid: A.kid })).toString("base64url");
  writeFileSync(path.join(k, INTEGRITY_FILE), `${sahteBaslik}.${govde}.${imza}\n`);
  // Yamalı çekirdek diskteki (başlığı değiştirilmiş) listeye bakmadan özgün imzalı yükün raporunu döner.
  const kidli: LicenseCore = { ...tsLicenseCore, verifyIntegrity: (_liste, root) => tsLicenseCore.verifyIntegrity(token, root, keysOf(B)) };
  const sahte = await runIntegrityCheck(girdi(k, { core: kidli, keys: keysOf(A) }));
  check(
    "§1t ⭐ çekirdek 'geçerli' dese de imza bu derlemenin PAKET anahtarıyla doğrulanmazsa GECERSIZ BUTUNLUK_IMZA (kid/künye güvenilmez) · başlık kid'i A'ya çevrilmiş liste de",
    sonuc.durum === "GECERSIZ" && sonuc.kod === "BUTUNLUK_IMZA" && sonuc.kid === null && sonuc.kunye === null &&
      sahte.durum === "GECERSIZ" && sahte.kod === "BUTUNLUK_IMZA" && sahte.kid === null,
    `${sonuc.durum}/${sonuc.kod} · ${sahte.durum}/${sahte.kod}`,
  );
  await imzala(k, A);
  const durust = await runIntegrityCheck(girdi(k, { core: yalanci, keys: keysOf(A) }));
  check("§1t' karşı kontrol: bu derlemenin anahtarıyla (A) imzalı listede aynı çekirdek + ikinci katman GECERLI (A'nın kid'i ve künyesi)", durust.durum === "GECERLI" && durust.kid === A.kid && durust.kunye !== null, `${durust.durum}/${durust.kod}`);
}

function bolum2(): void {
  console.log("\n§2 çapa");
  check(
    "§2a ⭐ PAKET çapası tek kip: üretim listesi dolu ve YALNIZ paket-<yıl>; hazırlık listesi (STAGING_PACKAGE_PUBLIC_KEYS) YOK",
    PRODUCTION_PACKAGE_PUBLIC_KEYS.length > 0 && PRODUCTION_PACKAGE_PUBLIC_KEYS.every((k) => isProductionPackageKid(k.kid)) && !("STAGING_PACKAGE_PUBLIC_KEYS" in butunlukModulu),
    `üretim ${PRODUCTION_PACKAGE_PUBLIC_KEYS.map((k) => k.kid).join(",")}`,
  );
  check("§2a' derlemenin PAKET çapası geliştirmede ÜRETİM listesi", PACKAGE_PUBLIC_KEYS === PRODUCTION_PACKAGE_PUBLIC_KEYS);
  check(
    "§2b üretim kid kuralı paket-<yıl>[-<n>]: eski paket-hazirlik* ailesi ve fikstür kid'i kuralın DIŞINDA",
    isProductionPackageKid("paket-2027") && isProductionPackageKid("paket-2027-2") && !isProductionPackageKid("paket-hazirlik") && !isProductionPackageKid("paket-hazirlik-2") && !isProductionPackageKid("paket-fikstur"),
  );
  check("§2c kapsam dizinleri dist/ + native/ + runtime/ + node_modules/ + prisma/migrations/ içerir", ["dist", "native", "runtime", "node_modules", "prisma/migrations"].every((d) => INTEGRITY_SCOPE_DIRS.includes(d)));
  check("§2d ecosystem.config.js kapsamda DEĞİL (kur.ps1 yükseltmede sunucununkini korur)", !INTEGRITY_SCOPE_FILES.includes("ecosystem.config.js"));
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-01T00:00:00.000Z");

function bolum3(): void {
  console.log("\n§3 merdiven · künye · çapa kalıcılığı (saf)");
  const bul = (o: { butunluk: IntegrityOutcome["durum"]; ilk?: number | null; basarisiz?: boolean }): Finding[] => {
    const out: Finding[] = [];
    // İkinci anahtar (K3): son 24 saatte başarılı kira alışverişi YOK → `internetVar: false`.
    evaluateIntegrity({ butunluk: o.butunluk, butunlukIlkUyusmazlikMs: o.ilk ?? null, internetVar: !(o.basarisiz ?? false) }, NOW, out);
    return out;
  };
  const f0 = bul({ butunluk: "GECERSIZ" });
  const f1 = bul({ butunluk: "GECERSIZ", ilk: NOW - DAY });
  const f2 = bul({ butunluk: "GECERSIZ", ilk: NOW - 31 * DAY });
  const f3 = bul({ butunluk: "GECERSIZ", ilk: NOW - 31 * DAY, basarisiz: true });
  check("§3a çapa yoksa UYARI (BUTUNLUK_GECERSIZ)", f0.length === 1 && f0[0].code === "BUTUNLUK_GECERSIZ" && f0[0].tier === "UYARI");
  check("§3b ilk görülüşten 1 gün → EK_SURE, 29 gün kaldı", f1[0]?.tier === "EK_SURE" && f1[0]?.daysLeft === 29);
  check("§3c 30 gün geçti + internet VAR (son 24 saatte kira alışverişi) → EK_SURE (0 gün; iki anahtar)", f2[0]?.tier === "EK_SURE" && f2[0]?.daysLeft === 0);
  check("§3d 30 gün geçti + son 24 saatte başarılı alışveriş YOK → KISITLI", f3[0]?.tier === "KISITLI");
  const olc = bul({ butunluk: "OLCULEMEDI" });
  check("§3e ölçülemedi → UYARI (BUTUNLUK_OLCULEMEDI) · GECERLI/KAPSAM_DISI bulgu yok", olc[0]?.code === "BUTUNLUK_OLCULEMEDI" && bul({ butunluk: "GECERLI" }).length === 0 && bul({ butunluk: "KAPSAM_DISI" }).length === 0);

  __resetIntegrityStateForTests();
  check("§3f ölçülmeden önce: korumalı pakette OLCULEMEDI, geliştirmede KAPSAM_DISI", integrityStatusForState(true) === "OLCULEMEDI" && integrityStatusForState(false) === "KAPSAM_DISI");
  const P1 = randomUUID();
  const P2 = randomUUID();
  const sonuc = (durum: IntegrityOutcome["durum"], derleme: string | null, paketId: string | null = P1): IntegrityOutcome => ({
    durum, kod: null, kid: A.kid, fazla: [], fazlaSayisi: 0, yukleyiciBayraklari: [], olcum: null, sertifika: null, uyari: null, denetlendi: new Date(NOW).toISOString(),
    rapor: paketId
      ? { durum: durum === "GECERSIZ" ? "GECERSIZ" : "GECERLI", kod: null, dosyaSayisi: 1, eksik: [], eksikSayisi: 0, degisik: [], degisikSayisi: 0, okunamayan: [], okunamayanSayisi: 0, fazla: [], fazlaSayisi: 0,
          paket: { paketId, urun: "backend", surum: "2.12.0", derlemeTarihi: derleme ?? "2026-09-01T00:00:00.000Z", musteri: null } }
      : null,
    kunye: derleme && paketId ? { derlemeTarihi: derleme, musteri: null, paketId, surum: "2.12.0" } : null,
  });
  const kayit = (ilk: string | null, paketId: string | null | "yok" = P1): StateRecord => ({
    v: 1, kurulumId: randomUUID(), kiraId: randomUUID(), birikenMs: 0, yazildi: new Date(NOW).toISOString(), yuksekSu: new Date(NOW).toISOString(),
    sonKiraZorlamasi: null, sonYaptirim: null, sira: 1, butunlukIlk: ilk, ...(paketId === "yok" ? {} : { butunlukPaketId: paketId }),
  });
  setIntegrityOutcome(sonuc("GECERSIZ", "2026-09-01T00:00:00.000Z"), NOW);
  const onGun = new Date(NOW - 10 * DAY).toISOString();
  check("§3g çapa = kayıttaki ile süreçtekinin ERKENİ (yeniden başlatma ek süreyi uzatmaz)", integrityAnchorMs(kayit(onGun)) === NOW - 10 * DAY && integrityAnchorMs(null) === NOW);
  const y = integrityRecordPatch(kayit(onGun));
  check("§3h kayda yazılan: GECERSIZ → çapa + paketId", y?.butunlukIlk === onGun && y?.butunlukPaketId === P1);
  check("§3i imzalı künyeden derleme tarihi okunur", buildDateMsForState() === Date.parse("2026-09-01T00:00:00.000Z"));
  setIntegrityOutcome(sonuc("OLCULEMEDI", null, null), NOW + DAY);
  check("§3j ölçülemedi: kayıttaki çapa KORUNUR (undefined) · künye yok → derleme tarihi null", integrityRecordPatch(kayit(onGun)) === undefined && buildDateMsForState() === null);
  setIntegrityOutcome(sonuc("GECERLI", "2026-09-01T00:00:00.000Z"), NOW + 2 * DAY);
  const geri = integrityRecordPatch(kayit(onGun));
  check("§3k ⭐ dosyalar AYNI pakette yeniden uyuşunca damga SİLİNMEZ (kayıtta kalır), ek süre bulgusu yok", geri?.butunlukIlk === onGun && geri?.butunlukPaketId === P1 && integrityAnchorMs(kayit(onGun)) === null);
  setIntegrityOutcome(sonuc("GECERSIZ", "2026-09-01T00:00:00.000Z"), NOW + 5 * DAY);
  check("§3l ⭐ kısa geri yükleme sonrası yeniden bozulma: çapa İLK uyuşmazlıkta kalır (30 gün yeniden başlamaz)", integrityAnchorMs(kayit(onGun)) === NOW - 10 * DAY);
  setIntegrityOutcome(sonuc("GECERLI", "2026-09-01T00:00:00.000Z", P2), NOW + 6 * DAY);
  const yeni = integrityRecordPatch(kayit(onGun));
  check("§3m yeni imzalı paket (farklı paketId) kurulunca damga sıfırlanır", yeni?.butunlukIlk === null && yeni?.butunlukPaketId === P2);
  setIntegrityOutcome(sonuc("GECERSIZ", "2026-09-01T00:00:00.000Z", P2), NOW + 7 * DAY);
  check("§3n yeni pakette ilk uyuşmazlık kendi damgasını alır (eski paketin kaydı sayılmaz)", integrityAnchorMs(kayit(onGun, P1)) === NOW + 7 * DAY);
  check("§3o paketId'siz eski kayıttaki damga BENİMSENİR (fail-closed) · paket bilinmeyen GECERSIZ'de kayıt korunur", integrityAnchorMs(kayit(onGun, "yok")) === NOW - 10 * DAY);
  setIntegrityOutcome(sonuc("GECERSIZ", null, null), NOW + 8 * DAY);
  const bilinmez = integrityRecordPatch(kayit(onGun, P1));
  check("§3p imza düştü (paket bilinmiyor): kayıttaki damga ve paketId korunur", bilinmez?.butunlukIlk === onGun && bilinmez?.butunlukPaketId === P1);
  __resetIntegrityStateForTests();
}

async function bolum4(): Promise<void> {
  console.log("\n§4 native'e bağlama");
  const kaynaklar: Record<string, string> = {
    "src/lib/license/state.ts": oku("src/lib/license/state.ts"),
    "src/services/license-sync.service.ts": oku("src/services/license-sync.service.ts"),
    "src/lib/license/fingerprint.ts": oku("src/lib/license/fingerprint.ts"),
  };
  const dogrudan = Object.entries(kaynaklar).filter(([, t]) => /\b(verifyEntitlement|verifyLease|checkLeaseBinding|digestFingerprint|collectOsFactors)\s*\(/.test(t)).map(([p]) => p);
  check("§4a motor (state · license-sync · fingerprint) kripto/ölçümü protokolden DOĞRUDAN çağırmaz — çekirdekten", dogrudan.length === 0, dogrudan.join(", "));
  const yok = unavailableCore("bekçi");
  const d = verifyLicenseDocuments({ entitlementJws: "a.b.c", leaseJws: "a.b.c", roots: [] as RootKey[], core: yok });
  check("§4b çekirdek YOKken motor TS'e düşmez: HAK/kira GECERSIZ(CEKIRDEK_YOK)", d.hak.status === "GECERSIZ" && d.hak.code === "CEKIRDEK_YOK" && d.kira.status === "GECERSIZ" && d.kira.code === "CEKIRDEK_YOK");
  const kb = oku("scripts/build-korumali.mjs");
  check(
    "§4c korumalı derleme __TEKSERP_NATIVE_REQUIRED__=true + filigran sabitlerini tanımlar; çapa kipi sabiti YOK (tek kip), ortak paketin kipi koda gömülü `uretim` (kanal kaydı okunmaz)",
    /__TEKSERP_NATIVE_REQUIRED__:\s*'true'/.test(kb) &&
      /__TEKSERP_FILIGRAN__:\s*JSON\.stringify/.test(kb) &&
      !/__TEKSERP_GUVEN_CAPASI__/.test(kb) &&
      /^\s*const guvenCapasi = 'uretim';$/m.test(kb) && !/kanalCoz|guvenCapasi\s*=\s*musteri/.test(kb),
  );
  const pk = oku("../deploy/paketle.ps1");
  const kur = oku("../deploy/kur.ps1");
  check(
    "§4d paketle.ps1 native'i app/native'e koyar (yoksa Fail) · kur.ps1 imzasız ya da listesiz korumalı paketi reddeder",
    /Join-Path \$stage "native"/.test(pk) && /native lisans cekirdegi yok/.test(pk) && /Korumali paket IMZASIZ/.test(kur) && /Join-Path \$temp "butunluk-liste\.txt"/.test(kur),
  );
  // G3: native kopyalandıktan hemen sonra paketin kendi Node'uyla çapa kipi denetimi; sıfır dışı çıkış paketi durdurur.
  const kipCagri = /& \$runtimeNode \(Join-Path \(Join-Path \$proj "scripts"\) "native-capa-kipi\.mjs"\)[^\n]*server-kunye\.json"\)\r?\n\s*if \(\$LASTEXITCODE -ne 0\) \{ Fail /;
  const kopya = pk.indexOf('Copy-Item $natKaynak (Join-Path $stage "native\\$natAd")');
  check("§4d' ⭐ paketle.ps1 -Korumali native'i kopyaladıktan sonra çapa kipini paketin Node'uyla denetler, uyuşmazlıkta Fail", kopya > 0 && kipCagri.test(pk.slice(kopya, kopya + 900)));

  const dosya = nativeFileName(process.platform, process.arch);
  const uretim = dosya ? path.join(TEKS, "native", "lisans-cekirdek", "dist-uretim", dosya) : null;
  if (!dosya || !uretim || !existsSync(uretim)) {
    ATLAMA.atla("§4e–§4h zorunlu kipte liste denetimi (gerçek .node)", "native üretim derlemesi yok — `cd native/lisans-cekirdek && npm run derle:uretim`", 4);
    return;
  }
  const kok = paket("s4");
  copyFileSync(uretim, path.join(kok, "native", dosya));
  const yukle = (keys: PackageKey[]) => loadLicenseCoreFrom({ required: true, cwd: kok, env: {}, platform: process.platform, arch: process.arch, packageKeys: keys });
  const neden = (r: ReturnType<typeof yukle>) => ("neden" in r.status ? r.status.neden : "native");
  const r0 = yukle(keysOf(A));
  check("§4e zorunlu kip + imzalı liste YOK → çekirdek YOK (LISTE_YOK), TS'e düşmez", r0.status.kaynak === "yok" && neden(r0) === "LISTE_YOK" && r0.core !== tsLicenseCore);
  await imzala(kok, B);
  const r1 = yukle(keysOf(A));
  check("§4f liste tanınmayan anahtarla imzalı → LISTE_GECERSIZ", r1.status.kaynak === "yok" && neden(r1) === "LISTE_GECERSIZ");
  await imzala(kok, A);
  appendFileSync(path.join(kok, "native", dosya), Buffer.from([0]));
  const r2 = yukle(keysOf(A));
  check("§4g kurcalanmış .node (dlopen ÖNCESİ) → LISTE_UYUSMAZ", r2.status.kaynak === "yok" && neden(r2) === "LISTE_UYUSMAZ");
  copyFileSync(uretim, path.join(kok, "native", dosya));
  await imzala(kok, A);
  const r3 = yukle(keysOf(A));
  check("§4h imzalı listedeki üretim .node → native yüklenir (zorunlu kip)", r3.status.kaynak === "native" && r3.core.source === "native", neden(r3));

  const kipDenetimi = (node: string, kunye: unknown): number | null => {
    const kf = path.join(TEMP, `kunye-${randomUUID()}.json`);
    writeFileSync(kf, JSON.stringify(kunye));
    return spawnSync(process.execPath, [path.join(TEKS, "scripts", "native-capa-kipi.mjs"), node, kf], { encoding: "utf8" }).status;
  };
  const test = path.join(TEKS, "native", "lisans-cekirdek", "dist", dosya);
  const sonuclar = [
    kipDenetimi(uretim, { guvenCapasi: "uretim" }),
    kipDenetimi(uretim, { guvenCapasi: "hazirlik" }),
    existsSync(test) ? kipDenetimi(test, { guvenCapasi: "uretim" }) : 1,
    kipDenetimi(uretim, { zaman: "x" }),
  ];
  check(
    "§4j ⭐ paketleme kip denetimi (native-capa-kipi.mjs): aynı kip 0 · künye eski hazırlık kipi 2 (tek kip, tanınmaz) · test çapalı ikili 1 · künyede kip yok 2 (ölçülemedi)",
    JSON.stringify(sonuclar) === JSON.stringify([0, 2, 1, 2]),
    JSON.stringify(sonuclar),
  );
}

async function bolum5(): Promise<void> {
  console.log("\n§5 imza aracı");
  const kok = paket("s5");
  for (let i = 0; i < 2000; i++) writeFileSync(path.join(kok, "dist", `parca-${String(i).padStart(4, "0")}.js`), `${i}\n`);
  const buyuk = await imzala(kok, A);
  const bk = await runIntegrityCheck(girdi(kok));
  check("§5a JWS tavanını (32 KB) aşacak liste ayrı dosyada: 2000+ dosya imzalanır, JWS küçük kalır, denetim GECERLI", buyuk.entries.length > 2000 && buyuk.token.length < 2048 && bk.durum === "GECERLI", `${buyuk.entries.length} dosya · jws ${buyuk.token.length} bayt`);
  const k2 = paket("s5b");
  const r = await imzala(k2, A, { derleme: "2027-01-02T03:04:05.000Z", musteri: "testfabrika" });
  const yollar = r.entries.map((f) => f.yol);
  check(
    "§5b imzalı yük: derleme tarihi + müşteri + kapsam (node_modules + migration SQL listede; logs/, butunluk.jws, liste dosyası yok)",
    r.manifest.derlemeTarihi === "2027-01-02T03:04:05.000Z" && r.manifest.musteri === "testfabrika" &&
      yollar.includes("node_modules/express/Quick Start/ilk.md") && yollar.some((y) => y.startsWith("prisma/migrations/")) &&
      yollar.every((y) => !y.startsWith("logs/") && y !== INTEGRITY_FILE && y !== INTEGRITY_LIST_FILE),
  );
  const k3 = paket("s5c");
  rmSync(path.join(k3, "node_modules"), { recursive: true });
  const ince = await imzala(k3, A);
  check("§5d node_modules'süz paket (-NodeModulesHaric): imzalı kapsamda node_modules YOK (sunucudaki npm ci FAZLA sayılmaz)", !ince.manifest.kapsam.dizinler.includes("node_modules") && ince.manifest.kapsam.dizinler.includes("dist"));
  const sahte = signJws({ typ: INTEGRITY_TYP, kid: A.kid, payload: { v: 1 }, privateKey: A.privateKey });
  writeFileSync(path.join(k2, INTEGRITY_FILE), sahte);
  const s = await runIntegrityCheck(girdi(k2));
  check("§5c şemaya uymayan imzalı yük → GECERSIZ (BELGE_*)", s.durum === "GECERSIZ" && (s.kod ?? "").startsWith("BELGE_"), `${s.kod}`);
}

// §5' — Faz 2d'nin şifreli modül paketleri (`dist/moduller/*.tkmod`) 2e-S'nin imzalı listesinde: derleyicinin
// yazdığı ve yönlendiricinin okuduğu dizin imzalı kapsamda; değişen .tkmod UYUSMAZ, sonradan beliren FAZLA.
async function bolum5b(): Promise<void> {
  console.log("\n§5' şifreli modül paketleri (2d .tkmod) imzalı kapsamda");
  const k = paket("s5m");
  const modDir = path.join(k, "dist", "moduller");
  mkdirSync(modDir, { recursive: true });
  const tk = path.join(modDir, `depo-multi${MODULE_PACKAGE_EXT}`);
  writeFileSync(tk, Buffer.alloc(512, 7));
  const r = await imzala(k, A);
  const derleyici = readFileSync(path.join(TEKS, "scripts", "build-korumali.mjs"), "utf8");
  const yonlendirici = readFileSync(path.join(TEKS, "src", "lib", "license", "encrypted-module-router.ts"), "utf8");
  check(
    "§5e ⭐ .tkmod imzalı listede: derleyici dist/moduller'e yazar, yönlendirici oradan okur, dizin imzalı kapsamda",
    INTEGRITY_SCOPE_DIRS.some((d) => "dist/moduller".startsWith(`${d}/`)) && r.entries.some((e) => e.yol === `dist/moduller/depo-multi${MODULE_PACKAGE_EXT}`) &&
      /path\.join\(ciktiDir, 'moduller'\)/.test(derleyici) && /path\.join\(__dirname, "moduller"\)/.test(yonlendirici),
  );
  writeFileSync(tk, Buffer.alloc(512, 8));
  const deg = await runIntegrityCheck(girdi(k));
  check("§5f imzadan sonra değişen .tkmod → GECERSIZ (BUTUNLUK_UYUSMAZ)", deg.durum === "GECERSIZ" && deg.kod === "BUTUNLUK_UYUSMAZ", `${deg.durum} ${deg.kod}`);
  writeFileSync(tk, Buffer.alloc(512, 7));
  writeFileSync(path.join(modDir, `sahte${MODULE_PACKAGE_EXT}`), "x");
  const fz = await runIntegrityCheck(girdi(k));
  check("§5g imzadan sonra beliren .tkmod → GECERSIZ (BUTUNLUK_FAZLA)", fz.durum === "GECERSIZ" && fz.kod === "BUTUNLUK_FAZLA", `${fz.durum} ${fz.kod}`);
}

async function bolum6(): Promise<void> {
  console.log("\n§6 Docker teslim künyesi imzası (PAKET-DOCKER.json → .jws + liste dosyası)");
  const dir = path.join(TEMP, "teslim");
  mkdirSync(dir, { recursive: true });
  const ad = "tekserp-korumali_2.12.0_linux-amd64.tar.gz";
  writeFileSync(path.join(dir, ad), Buffer.alloc(4096, 5));
  writeFileSync(path.join(dir, "docker-compose.yml"), "services: {}\n");
  writeFileSync(path.join(dir, ".env.ornek"), "A=1\n");
  writeFileSync(path.join(dir, "SHA256SUMS"), "kapsam dışı\n");
  const kunye = { v: 1, paketId: randomUUID(), urun: "backend-docker", surum: "2.12.0", derlemeTarihi: "2026-09-30T08:00:00.000Z", musteri: "testfabrika", commit: "abc", imaj: { etiket: "x:1", platform: "linux/amd64" }, kapsam: { dizinler: [], dosyalar: [ad, "docker-compose.yml", ".env.ornek"] } };
  const belge = path.join(dir, "PAKET-DOCKER.json");
  writeFileSync(belge, `${JSON.stringify(kunye, null, 2)}\n`);
  const r = await signManifestDocument(belge, A);
  const v = await verifyIntegrity(readFileSync(r.file, "utf8").trim(), dir, keysOf(A));
  const yuk = JSON.parse(Buffer.from(r.token.split(".")[1] ?? "", "base64url").toString("utf8")) as { imaj?: { etiket?: string }; commit?: string; liste?: { dosyaSayisi?: number } };
  const yazili = JSON.parse(readFileSync(belge, "utf8")) as unknown;
  check(
    "§6a ⭐ imzalı künye GECERLI: üç teslim dosyası listede, ek alanlar (imaj · commit) imzada, künye dosyası = imzalı yük",
    v.durum === "GECERLI" && yuk.liste?.dosyaSayisi === 3 && yuk.imaj?.etiket === "x:1" && yuk.commit === "abc" && JSON.stringify(yazili) === JSON.stringify(yuk) && existsSync(r.listFile),
    `${v.durum} ${v.kod ?? ""}`,
  );
  appendFileSync(path.join(dir, "docker-compose.yml"), "# kurcalandı\n");
  const v2 = await verifyIntegrity(readFileSync(r.file, "utf8").trim(), dir, keysOf(A));
  check("§6b teslim dosyası kurcalanınca GECERSIZ (BUTUNLUK_UYUSMAZ)", v2.durum === "GECERSIZ" && v2.kod === "BUTUNLUK_UYUSMAZ", `${v2.durum} ${v2.kod}`);
  writeFileSync(path.join(dir, "docker-compose.yml"), "services: {}\n");
  writeFileSync(r.listFile, readFileSync(r.listFile, "utf8").replace(".env.ornek", ".env.orneX"));
  const v3 = await verifyIntegrity(readFileSync(r.file, "utf8").trim(), dir, keysOf(A));
  check("§6c liste dosyası kurcalanınca GECERSIZ (BUTUNLUK_LISTE_BOZUK)", v3.durum === "GECERSIZ" && v3.kod === "BUTUNLUK_LISTE_BOZUK", `${v3.durum} ${v3.kod}`);
  rmSync(path.join(dir, ".env.ornek"));
  rmSync(r.file);
  rmSync(r.listFile);
  writeFileSync(belge, `${JSON.stringify(kunye, null, 2)}\n`);
  let hata = "";
  try {
    await signManifestDocument(belge, A);
  } catch (e) {
    hata = e instanceof Error ? e.message : String(e);
  }
  check("§6d teslim dosyası eksikken imza ATILMAZ (ne .jws ne liste dosyası)", /teslim dosyası eksik: \.env\.ornek/.test(hata) && !existsSync(r.file) && !existsSync(r.listFile), hata.slice(0, 80));
  writeFileSync(path.join(dir, ".env.ornek"), "A=1\n");
  const anahtarDizini = path.join(TEMP, "anahtar6");
  const kf = writePackageKey(anahtarDizini, generatePackageKey("paket-fikstur", ["TEST", "DEMO"]));
  const cli = spawnSync(process.execPath, ["--import", "tsx", "scripts/build-korumali-imza.ts", "belge", `--belge=${belge}`, `--anahtar=${kf}`], { cwd: TEKS, encoding: "utf8", timeout: 60_000 });
  check("§6e ⭐ CLI `belge` (teslim-paketle.sh'in çağrısı) .jws + liste dosyası yazar", cli.status === 0 && existsSync(r.file) && existsSync(r.listFile), `${cli.status} ${(cli.stderr || cli.stdout).trim().slice(0, 100)}`);
}

// §7 — korumalı yükleyici sertleştirmesi (F2): `ecosystem.config.js` imzalanamaz (kur.ps1 sunucununkini birleştirir),
// `node_args` / `NODE_OPTIONS` ile `--require/-r/--import/--loader/--experimental-loader/--inspect*` imzalı dosyalar
// uyuşsa da kod enjekte eder. Korumalı kipte bu bayraklar bütünlüğü GECERSIZ `BUTUNLUK_YUKLEYICI` yapar (merdiven;
// gözlemde yalnız rapor), dosya raporu + künye korunur; geliştirme (tsx `--import`) etkilenmez. Karşılaştırıcılar
// fonksiyon alır: KALICI SONDA bozuk tespit/denetim verilince ısırır, gerçeği verilince susar.
type Tespit = typeof detectLoaderInjection;
type Denetim = typeof runIntegrityCheck;
const ENJEKSIYON: ReadonlyArray<[string, readonly string[], string | undefined, string]> = [
  ["execArgv --require", ["--require", "/tmp/x.js", "dist/server.js"], undefined, "--require"],
  ["execArgv -r", ["-r", "x"], undefined, "-r"],
  ["execArgv --import=", ["--import=data:text/javascript,1"], undefined, "--import"],
  ["execArgv --experimental-loader", ["--experimental-loader", "x.mjs"], undefined, "--experimental-loader"],
  ["execArgv --loader=", ["--loader=x.mjs"], undefined, "--loader"],
  ["execArgv --inspect-brk=", ["--inspect-brk=0.0.0.0:9229"], undefined, "--inspect-brk"],
  ["execArgv alt çizgi --inspect_port", ["--inspect_port=9"], undefined, "--inspect-port"],
  ["NODE_OPTIONS tırnaklı --require", [], '--max-old-space-size=4096 --require "C:\\a b\\x.js"', "--require"],
  ["NODE_OPTIONS --inspect", [], "--inspect", "--inspect"],
];
const TEMIZ: ReadonlyArray<[string, readonly string[], string | undefined]> = [
  ["bellek/kaynak haritası bayrakları", ["--max-old-space-size=2048", "--enable-source-maps", "--expose-gc"], "--max-old-space-size=4096"],
  ["tırnak içindeki metin bayrak değil", [], '--title "x --require y"'],
  ["değer içinde bayrak adı", ["--title=--require"], "--experimental-require-module"],
];

function tespitIhlalleri(tespit: Tespit): string[] {
  const ih: string[] = [];
  for (const [ad, argv, env, bayrak] of ENJEKSIYON) {
    const r = tespit(argv, env);
    if (!r.some((f) => f.bayrak === bayrak && f.kaynak === (argv.length ? "execArgv" : "NODE_OPTIONS"))) ih.push(`${ad} yakalanmadı`);
  }
  for (const [ad, argv, env] of TEMIZ) if (tespit(argv, env).length > 0) ih.push(`${ad} yanlış pozitif`);
  return ih;
}

async function denetimIhlalleri(denetim: Denetim, kok: string): Promise<string[]> {
  const ih: string[] = [];
  const bayrak = (execArgv: readonly string[], nodeOptions?: string) => ({ execArgv, nodeOptions });
  const temiz = await denetim(girdi(kok, { runtimeFlags: bayrak(["--max-old-space-size=2048"]) }));
  if (temiz.durum !== "GECERLI" || temiz.yukleyiciBayraklari.length) ih.push(`temiz süreç ${temiz.durum}/${temiz.kod}`);
  const req = await denetim(girdi(kok, { runtimeFlags: bayrak(["--require", "/tmp/yama.js"]) }));
  if (req.durum !== "GECERSIZ" || req.kod !== "BUTUNLUK_YUKLEYICI") ih.push(`--require → ${req.durum}/${req.kod}`);
  if (req.kunye?.paketId !== temiz.kunye?.paketId || !req.rapor) ih.push("enjeksiyon dosya raporunu/künyeyi düşürdü");
  const env = await denetim(girdi(kok, { runtimeFlags: bayrak([], "--inspect=0.0.0.0:9229") }));
  if (env.kod !== "BUTUNLUK_YUKLEYICI") ih.push(`NODE_OPTIONS --inspect → ${env.kod}`);
  const gelistirme = await denetim(girdi(kok, { required: false, runtimeFlags: bayrak(["--import", "tsx"]) }));
  if (gelistirme.kod === "BUTUNLUK_YUKLEYICI") ih.push("korumasız kipte (geliştirme) enjeksiyon sayıldı");
  return ih;
}

async function bolum7(): Promise<void> {
  console.log("\n§7 korumalı yükleyici: execArgv / NODE_OPTIONS enjeksiyonu → BUTUNLUK_YUKLEYICI");
  const kok = paket("s7");
  await imzala(kok, A);
  const t = tespitIhlalleri(detectLoaderInjection);
  check("§7a ⭐ tespit: --require/-r/--import/--loader/--experimental-loader/--inspect* (execArgv + NODE_OPTIONS, alt çizgi) yakalanır, zararsız bayrak susar", t.length === 0, t.join(" | ") || "temiz");
  const d = await denetimIhlalleri(runIntegrityCheck, kok);
  check("§7b ⭐ korumalı kipte enjeksiyon → GECERSIZ BUTUNLUK_YUKLEYICI (rapor + künye korunur); geliştirme kipi etkilenmez", d.length === 0, d.join(" | ") || "temiz");
  const inj = await runIntegrityCheck(girdi(kok, { runtimeFlags: { execArgv: ["--require", "/gizli/yol.js"], nodeOptions: "--inspect" } }));
  const neden = integrityReason(inj) ?? "";
  const saglik = oku("src/lib/license/license-health.ts");
  check("§7c health lisans bloğu nedeni taşır: bayrak adı + kaynak, DEĞER yok (yol/sır basılmaz)",
    neden.includes("--require (execArgv)") && neden.includes("--inspect (NODE_OPTIONS)") && !neden.includes("/gizli") && integrityReason(null) === null &&
    /butunlukNeden: integrityReason\(getIntegrityOutcome\(\)\)/.test(saglik), neden);
  __resetIntegrityStateForTests();
  setIntegrityOutcome(inj, NOW);
  check("§7d lisans merdivenine girer: durum GECERSIZ + ek süre çapası", integrityStatusForState(true) === "GECERSIZ" && integrityAnchorMs(null) === NOW);
  __resetIntegrityStateForTests();
  const tespitSonda: Array<[string, Tespit]> = [
    ["NODE_OPTIONS okunmuyor", (a) => detectLoaderInjection(a, undefined)],
    ["alt çizgi eşlenmiyor", (a, n) => detectLoaderInjection(a.filter((x) => !x.includes("_")), n)],
    ["her bayrak enjeksiyon", (a, n) => [...detectLoaderInjection(a, n), ...(a.length || n ? [{ bayrak: "--x", kaynak: "execArgv" as const }] : [])]],
  ];
  for (const [ad, f] of tespitSonda) check(`§7 sonda: ${ad} → kırmızı`, tespitIhlalleri(f).length > 0);
  const denetimSonda: Array<[string, Denetim]> = [
    ["bayraklar yok sayılır", (g) => runIntegrityCheck({ ...g, runtimeFlags: { execArgv: [], nodeOptions: undefined } })],
    ["geliştirme kipi de korumalı sayılır", (g) => runIntegrityCheck({ ...g, required: true })],
  ];
  for (const [ad, f] of denetimSonda) check(`§7 sonda: ${ad} → kırmızı`, (await denetimIhlalleri(f, kok)).length > 0);
  check("§7 pozitif sonda: gerçek tespit + denetim → yeşil", tespitIhlalleri(detectLoaderInjection).length === 0 && (await denetimIhlalleri(runIntegrityCheck, kok)).length === 0);
}

async function main(): Promise<void> {
  console.log("=== Lisans bütünlük · künye · filigran · native bağlama ===");
  try {
    await bolum1(tsLicenseCore, "ts");
    const n = loadLicenseCoreFrom({ required: false, cwd: TEKS, env: {}, platform: process.platform, arch: process.arch });
    if (n.status.kaynak === "native" && n.status.kunye.testCapasi) await bolum1(n.core, "native");
    else ATLAMA.atla("§1 native kolu", "test çapalı native derlemesi yok — `cd native/lisans-cekirdek && npm run derle`", 13);
    await bolum1b();
    await bolum1c();
    await bolum1d();
    bolum2();
    bolum3();
    await bolum4();
    await bolum5();
    await bolum5b();
    await bolum6();
    await bolum7();
    const zincirCores: { core: LicenseCore; ek: string }[] = [{ core: tsLicenseCore, ek: "ts" }];
    if (n.status.kaynak === "native" && n.status.kunye.testCapasi) zincirCores.push({ core: n.core, ek: "native" });
    else ATLAMA.atla("§8 native kolu", "test çapalı native derlemesi yok — `cd native/lisans-cekirdek && npm run derle`", 8);
    const natDosya = nativeFileName(process.platform, process.arch);
    const natUretim = natDosya ? path.join(TEKS, "native", "lisans-cekirdek", "dist-uretim", natDosya) : null;
    const yukleyici =
      natDosya && natUretim && existsSync(natUretim)
        ? {
            keys: keysOf(A),
            paketKur: async (ad: string) => {
              const k = paket(ad);
              copyFileSync(natUretim, path.join(k, "native", natDosya));
              await imzala(k, A);
              return { kok: k, node: natUretim, dosya: natDosya };
            },
          }
        : null;
    if (!yukleyici) ATLAMA.atla("§8r–§8u yükleyici zinciri (gerçek .node)", "native üretim derlemesi yok — `cd native/lisans-cekirdek && npm run derle:uretim`", 4);
    await bolum8({ check, temp: TEMP, paketKur: async (ad) => { const k = paket(ad); await imzala(k, A); return k; }, girdi, yukleyici }, zincirCores);
  } finally {
    rmSync(TEMP, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error("❌ bekçi çöktü:", e);
  process.exit(1);
});
