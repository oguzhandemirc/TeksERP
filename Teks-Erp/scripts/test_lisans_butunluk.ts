// =============================================================================
// BEKÇİ — lisans Faz 2e: imzalı dosya listesi · derleme künyesi · filigran · native'e bağlama
// =============================================================================
// DB'siz. Geçici dizinlerde küçük paketler kurar, GEÇİCİ PAKET anahtarlarıyla imzalar (satıcı
// anahtarı gerekmez). NE ÖLÇER:
//   §1 imzalı liste: geçerli · kurcalanmış · eksik · FAZLA (kapsamda / kapsam dışında) · imzasız ·
//      yanlış anahtar · liste yok (zorunlu/geliştirme) · hazırlık anahtarı ÜRETİM'de · filigran
//   §2 çapa: PACKAGE_PUBLIC_KEYS yalnız paket kid'i, hazırlık kid'i sınıf kuralında
//   §3 merdiven + künye + çapa kalıcılığı (saf)
//   §4 native'e bağlama: motor çekirdekten geçer; zorunlu kipte TS'e düşme YOK; `.node` dlopen
//      ÖNCESİ imzalı listeye karşı (liste yok / yanlış anahtar / kurcalanmış → çekirdek YOK)
//   §5 imza aracı: öz-denetim, JWS tavanı, derleme künyesi tarihten
// Koşum: node ../scripts/agir-is.mjs -- npx tsx scripts/test_lisans_butunluk.ts
// =============================================================================
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPrivateKey, randomUUID } from "node:crypto";
import { atlamaDefteri } from "./lib/atlama";
import { generatePackageKey, signPackageDirectory } from "./lib/butunluk-imza";
import { signJws, type RootKey } from "../src/lib/license/protocol";
import { INTEGRITY_TYP, PACKAGE_PUBLIC_KEYS, type PackageKey } from "../src/lib/license/integrity";
import { INTEGRITY_FILE, INTEGRITY_SCOPE_DIRS, isStagingPackageKid } from "../src/lib/license/integrity-scope";
import { runIntegrityCheck, type IntegrityCheckInput } from "../src/lib/license/integrity-check";
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
  integrityRecordValue,
  integrityStatusForState,
  setIntegrityOutcome,
} from "../src/lib/license/integrity-state";
import type { IntegrityOutcome } from "../src/lib/license/integrity-check";

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

/** Küçük paket kökü: dist/ + native/ + kökte package.json + kapsam dışı logs/. */
function paket(ad: string): string {
  const kok = path.join(TEMP, ad);
  mkdirSync(path.join(kok, "dist", "tools"), { recursive: true });
  mkdirSync(path.join(kok, "native"), { recursive: true });
  mkdirSync(path.join(kok, "logs"), { recursive: true });
  writeFileSync(path.join(kok, "dist", "server.js"), "require('./server.jsc')\n");
  writeFileSync(path.join(kok, "dist", "server.jsc"), Buffer.alloc(2048, 7));
  writeFileSync(path.join(kok, "dist", "tools", "arac.cjs"), "module.exports = 1;\n");
  writeFileSync(path.join(kok, "native", "lisans-cekirdek.test.node"), Buffer.alloc(512, 3));
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
  return { root: kok, required: true, core: tsLicenseCore, keys: keysOf(A), entitlementClass: "URETIM", watermark: null, ...o };
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

  rmSync(path.join(k, INTEGRITY_FILE));
  const yokZ = await runIntegrityCheck(girdi(k, { core }));
  const yokG = await runIntegrityCheck(girdi(k, { core, required: false }));
  check(`§1i liste yok: korumalı pakette GECERSIZ BUTUNLUK_LISTE_YOK · geliştirmede KAPSAM_DISI (${ek})`, yokZ.durum === "GECERSIZ" && yokZ.kod === "BUTUNLUK_LISTE_YOK" && yokG.durum === "KAPSAM_DISI");
}

async function bolum1b(): Promise<void> {
  console.log("\n§1' hazırlık anahtarı sınıf kuralı + filigran");
  const k = paket("s1b");
  await imzala(k, H, { musteri: "testfabrika", paketId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b" });
  const g = (o: Partial<IntegrityCheckInput>) => runIntegrityCheck(girdi(k, { keys: keysOf(H), ...o }));
  const uretim = await g({ entitlementClass: "URETIM" });
  const test = await g({ entitlementClass: "TEST" });
  const demo = await g({ entitlementClass: "DEMO" });
  const bilinmez = await g({ entitlementClass: null });
  check("§1j hazırlık anahtarı: ÜRETİM'de GECERSIZ BUTUNLUK_HAZIRLIK_ANAHTARI, künye güvenilmez", uretim.durum === "GECERSIZ" && uretim.kod === "BUTUNLUK_HAZIRLIK_ANAHTARI" && uretim.kunye === null);
  check("§1k hazırlık anahtarı: TEST/DEMO'da GECERLI · sınıf bilinmiyorsa OLCULEMEDI", test.durum === "GECERLI" && demo.durum === "GECERLI" && bilinmez.durum === "OLCULEMEDI" && bilinmez.kod === "BUTUNLUK_SINIF_BILINMIYOR");
  const esit = await g({ entitlementClass: "TEST", watermark: { musteri: "testfabrika", kurulumId: null, paketId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", derlemeTarihi: null } });
  const baska = await g({ entitlementClass: "TEST", watermark: { musteri: "baskafabrika", kurulumId: null, paketId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", derlemeTarihi: null } });
  const baskaPaket = await g({ entitlementClass: "TEST", watermark: { musteri: "testfabrika", kurulumId: null, paketId: randomUUID(), derlemeTarihi: null } });
  check("§1l filigran: bayt kodu = imzalı künye → GECERLI · başka müşteri/paket → GECERSIZ BUTUNLUK_FILIGRAN", esit.durum === "GECERLI" && baska.kod === "BUTUNLUK_FILIGRAN" && baskaPaket.kod === "BUTUNLUK_FILIGRAN");
}

function bolum2(): void {
  console.log("\n§2 çapa");
  check("§2a PACKAGE_PUBLIC_KEYS dolu, her kid `paket-…`", PACKAGE_PUBLIC_KEYS.length > 0 && PACKAGE_PUBLIC_KEYS.every((k) => /^paket-[a-z0-9-]{1,40}$/.test(k.kid)));
  check("§2b hazırlık kid'i sınıf kuralında (paket-hazirlik*), üretim kid'i değil", isStagingPackageKid("paket-hazirlik") && isStagingPackageKid("paket-hazirlik-2") && !isStagingPackageKid("paket-2027") && !isStagingPackageKid("paket-hazirlikx"));
  check("§2c kapsam dizinleri native/ + dist/ + runtime/ içerir", ["dist", "native", "runtime"].every((d) => INTEGRITY_SCOPE_DIRS.includes(d)));
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-01T00:00:00.000Z");

function bolum3(): void {
  console.log("\n§3 merdiven · künye · çapa kalıcılığı (saf)");
  const bul = (o: { butunluk: IntegrityOutcome["durum"]; ilk?: number | null; basarisiz?: boolean }): Finding[] => {
    const out: Finding[] = [];
    evaluateIntegrity({ butunluk: o.butunluk, butunlukIlkUyusmazlikMs: o.ilk ?? null, sonYoklamaBasarisizMi: o.basarisiz ?? false }, NOW, out);
    return out;
  };
  const f0 = bul({ butunluk: "GECERSIZ" });
  const f1 = bul({ butunluk: "GECERSIZ", ilk: NOW - DAY });
  const f2 = bul({ butunluk: "GECERSIZ", ilk: NOW - 31 * DAY });
  const f3 = bul({ butunluk: "GECERSIZ", ilk: NOW - 31 * DAY, basarisiz: true });
  check("§3a çapa yoksa UYARI (BUTUNLUK_GECERSIZ)", f0.length === 1 && f0[0].code === "BUTUNLUK_GECERSIZ" && f0[0].tier === "UYARI");
  check("§3b ilk görülüşten 1 gün → EK_SURE, 29 gün kaldı", f1[0]?.tier === "EK_SURE" && f1[0]?.daysLeft === 29);
  check("§3c 30 gün geçti + yoklama sürüyor → EK_SURE (0 gün; iki anahtar)", f2[0]?.tier === "EK_SURE" && f2[0]?.daysLeft === 0);
  check("§3d 30 gün geçti + yoklama başarısız → KISITLI", f3[0]?.tier === "KISITLI");
  const olc = bul({ butunluk: "OLCULEMEDI" });
  check("§3e ölçülemedi → UYARI (BUTUNLUK_OLCULEMEDI) · GECERLI/KAPSAM_DISI bulgu yok", olc[0]?.code === "BUTUNLUK_OLCULEMEDI" && bul({ butunluk: "GECERLI" }).length === 0 && bul({ butunluk: "KAPSAM_DISI" }).length === 0);

  __resetIntegrityStateForTests();
  check("§3f ölçülmeden önce: korumalı pakette OLCULEMEDI, geliştirmede KAPSAM_DISI", integrityStatusForState(true) === "OLCULEMEDI" && integrityStatusForState(false) === "KAPSAM_DISI");
  const sonuc = (durum: IntegrityOutcome["durum"], derleme: string | null): IntegrityOutcome => ({
    durum, kod: null, kid: A.kid, rapor: null, fazla: [], fazlaSayisi: 0, denetlendi: new Date(NOW).toISOString(),
    kunye: derleme ? { derlemeTarihi: derleme, musteri: null, paketId: randomUUID(), surum: "2.12.0" } : null,
  });
  const kayit = (ilk: string | null): StateRecord => ({
    v: 1, kurulumId: randomUUID(), kiraId: randomUUID(), birikenMs: 0, yazildi: new Date(NOW).toISOString(), yuksekSu: new Date(NOW).toISOString(),
    sonKiraZorlamasi: null, sonYaptirim: null, sira: 1, butunlukIlk: ilk,
  });
  setIntegrityOutcome(sonuc("GECERSIZ", "2026-09-01T00:00:00.000Z"), NOW);
  const onGun = new Date(NOW - 10 * DAY).toISOString();
  check("§3g çapa = kayıttaki ile süreçtekinin ERKENİ (yeniden başlatma ek süreyi uzatmaz)", integrityAnchorMs(kayit(onGun)) === NOW - 10 * DAY && integrityAnchorMs(null) === NOW);
  check("§3h kayda yazılan: GECERSIZ → çapa", integrityRecordValue(kayit(onGun)) === onGun);
  check("§3i imzalı künyeden derleme tarihi okunur", buildDateMsForState() === Date.parse("2026-09-01T00:00:00.000Z"));
  setIntegrityOutcome(sonuc("OLCULEMEDI", null), NOW + DAY);
  check("§3j ölçülemedi: kayıttaki çapa KORUNUR (undefined) · künye yok → derleme tarihi null", integrityRecordValue(kayit(onGun)) === undefined && buildDateMsForState() === null);
  setIntegrityOutcome(sonuc("GECERLI", "2026-09-01T00:00:00.000Z"), NOW + 2 * DAY);
  check("§3k uyuşunca çapa sıfırlanır (kayda null)", integrityRecordValue(kayit(onGun)) === null && integrityAnchorMs(kayit(onGun)) === null);
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
  check("§4c korumalı derleme __TEKSERP_NATIVE_REQUIRED__=true + filigran sabitini tanımlar", /__TEKSERP_NATIVE_REQUIRED__:\s*'true'/.test(kb) && /__TEKSERP_FILIGRAN__:\s*JSON\.stringify/.test(kb));
  const pk = oku("../deploy/paketle.ps1");
  const kur = oku("../deploy/kur.ps1");
  check("§4d paketle.ps1 native'i app/native'e koyar (yoksa Fail) · kur.ps1 imzasız korumalı paketi reddeder", /Join-Path \$stage "native"/.test(pk) && /native lisans cekirdegi yok/.test(pk) && /Korumali paket IMZASIZ/.test(kur));

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
}

async function bolum5(): Promise<void> {
  console.log("\n§5 imza aracı");
  const kok = paket("s5");
  for (let i = 0; i < 400; i++) writeFileSync(path.join(kok, "dist", `parca-${String(i).padStart(3, "0")}.js`), `${i}\n`);
  let hata = "";
  try {
    await imzala(kok, A);
  } catch (e) {
    hata = e instanceof Error ? e.message : String(e);
  }
  check("§5a JWS 32 KB tavanını aşan liste imzalanmaz (paket kapsamı daraltılmalı)", /azami uzunluğu|bayt >/.test(hata), hata.slice(0, 80));
  const k2 = paket("s5b");
  const r = await imzala(k2, A, { derleme: "2027-01-02T03:04:05.000Z", musteri: "testfabrika" });
  check("§5b imzalı yük: derleme tarihi + müşteri + kapsam dosyaları (logs/ yok, butunluk.jws yok)", r.manifest.derlemeTarihi === "2027-01-02T03:04:05.000Z" && r.manifest.musteri === "testfabrika" && r.manifest.dosyalar.every((f) => !f.yol.startsWith("logs/") && f.yol !== INTEGRITY_FILE));
  const sahte = signJws({ typ: INTEGRITY_TYP, kid: A.kid, payload: { v: 1 }, privateKey: A.privateKey });
  writeFileSync(path.join(k2, INTEGRITY_FILE), sahte);
  const s = await runIntegrityCheck(girdi(k2));
  check("§5c şemaya uymayan imzalı yük → GECERSIZ (BELGE_*)", s.durum === "GECERSIZ" && (s.kod ?? "").startsWith("BELGE_"), `${s.kod}`);
}

async function main(): Promise<void> {
  console.log("=== Lisans bütünlük · künye · filigran · native bağlama ===");
  try {
    await bolum1(tsLicenseCore, "ts");
    const n = loadLicenseCoreFrom({ required: false, cwd: TEKS, env: {}, platform: process.platform, arch: process.arch });
    if (n.status.kaynak === "native" && n.status.kunye.testCapasi) await bolum1(n.core, "native");
    else ATLAMA.atla("§1 native kolu", "test çapalı native derlemesi yok — `cd native/lisans-cekirdek && npm run derle`", 9);
    await bolum1b();
    bolum2();
    bolum3();
    await bolum4();
    await bolum5();
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
