// =============================================================================
// BEKÇİ — LİSANS KİLİT KAÇAKLARI (Bölge 3 güvenlik denetimi B1 · B2 · B4 düzeltmeleri)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_kilit_kacaklari   (kendi _test DB'si; geçici LICENSE_DIR'ler,
// geçici kullanıcılar teardown'da silinir). Kilit G2 bekçisi gibi süreç içinde açılır (`setActivationLockForTests(true)`
// = korumalı derleme sabiti); kapı kararı gerçek `licenseGate` + gerçek oturumla.
//
// NE ÖLÇER:
//   §1 ⭐ B1 bekleyen taşıma etkin SAYMAZ: elle yazılmış imzasız `tasima.json` (BEKLIYOR ya da ONAYLANDI) kilidi
//      kaldırmaz (ETKINLESMEDI, iş ucu 403); meşru API yolu (`POST /api/license/tasima-talebi`, satıcı BEKLIYOR) da
//      kaldırmaz; bekleyen talebin durumu etkin olmayan kurulumda da yoklanır (TASIMA_ONAYI_BEKLIYOR · RED → dosya düşer)
//   §2 ⭐ B2 kullanılamayan lisans deposu (APP_ICINDE · YEDEK_ICINDE · YAZILAMADI · DB izsiz OKUNAMADI) → KURULUM_HATASI:
//      iş ucu 403, lisans ekranı + "verilerimi al" açık; etkin K4 kurulumda dizin hilesi kademe kapısını düşürmez;
//      kilit kapalı derlemede sıfır fark; G12 (anahtar okunamaz + DB izi) aynen
//   §3 ⭐ B4 G1 mührü TOTP'yi kapsar (denetim ölçüsünün TERSİ): mühürlü + mandallı + geçişi bitmiş kurulumda DB'den
//      TOTP sırrı yazmak ya da gerçek 2FA'nın `totpEnabledAt`ini boşaltmak mührü bozar → yetki yok, giriş 403
//
// NEGATİF SONDA (elle, ölçüldü): `isActivated`e bekleyen taşıma dalı geri konunca §1b/§1c/§1f kırmızı;
//   `pollOnce`ta taşıma yoklaması `activated` kapısının ARKASINA alınınca §1g/§1h kırmızı.
//   Sınıflayıcıdan `setupError` dalı silinince ya da kapı `durumHazir` değilken kilide bakmadan geçirince §2b×4 + §2e
//   kırmızı; KURULUM_HATASI'nda "verilerimi al" kapatılınca §2c×4 kırmızı. `credentialDigest`ten TOTP satırları
//   çıkarılınca §3b/§3c kırmızı (denetimdeki açık geri döner).
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicKey, randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { AuthService, resetRequestPermissionCacheForTest } from "../src/services/auth.service";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { licenseGate } from "../src/middlewares/license.middleware";
import { LICENSE_FILES, loadLicenseStoreSync } from "../src/lib/license/store";
import { setLicenseTraceRow } from "../src/lib/license/trace-row";
import { flushLicenseTraceWrites } from "../src/lib/license/accumulation";
import { setEgressTrustForTests } from "../src/lib/http-egress";
import {
  __resetLicenseRuntimeForTests,
  configureLicenseRuntimeForTests,
  getLicenseSnapshot,
  invalidateLicenseSnapshot,
  setActivationLockForTests,
  setLicenseDbFacts,
  setMeasuredFingerprint,
} from "../src/lib/license/runtime";
import { requestTransfer } from "../src/services/license.service";
import { pollLicenseOnce } from "../src/services/license-sync.service";
import { licenseStoreSetupError } from "../src/lib/license/snapshot-parts";
import { egressTransport } from "../src/services/helpers/license-wire.helper";
import { DAY_MS, ExemptionSchema, TYP, installationKeyId, msToIso, signDocument } from "../src/lib/license/protocol";
import { signStateRecord, verifyStateRecordSignature } from "../src/lib/license/saat";
import { fiksturKur, type Fikstur } from "./lib/lisans-fikstur";
import { sahteSaticiBaslat, type SahteSatici } from "./lib/lisans-sahte-satici";
import { kabulEt, temizleKabuller } from "./lib/lisans-kabul-fikstur";
import { kapidanGecir } from "./lib/lisans-kapi-surucu";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { totpCodeForStep, totpStep, generateTotpSecret } from "../src/services/totp.service";
import { TotpAccountService } from "../src/services/totp-account.service";
import {
  isSystemAccountAuthorized,
  migrateSealsToV2,
  resetSystemAccountSealCacheForTest,
  SEAL_ROW_SELECT,
  sealStatus,
  SYSTEM_ACCOUNT_LATCH_FILE,
  writeLatch,
  writeSeal,
  type SealRow,
} from "../src/services/helpers/system-account-seal.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const dizinler: string[] = [];
const geciciDizin = (ad: string): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `denetim-${ad}-`));
  dizinler.push(d);
  return d;
};
const saticilar: SahteSatici[] = [];
const fiksturler: string[] = [];
const ENV_YEDEK = { LICENSE_DIR: process.env.LICENSE_DIR, BACKUP_DIR: process.env.BACKUP_DIR };

async function kapi(token: string | null, m = "POST", yol = "/api/orders"): Promise<string> {
  const s = await kapidanGecir(licenseGate, { m, desen: yol, ornek: yol }, token);
  if (s.hata === undefined) return "ROTAYA";
  const d = (s.hata as { details?: Record<string, unknown> }).details ?? {};
  return `403:${String(d.code)}/${String(d.sinif ?? "")}`;
}
const kilit = (): string => {
  const s = getLicenseSnapshot();
  return `${s.etkinlestirmeKilidi.sinif}/${s.etkinlestirmeKilidi.neden}`;
};

/** Hiç etkinleşmemiş kurulum: DB izi yok, kimlik/HAK/kira yok, kilit AÇIK (korumalı derleme). */
async function taze(f: Fikstur, dir?: string): Promise<string> {
  // Önceki kurulumun kuyruktaki iz yazımı sıfırlamadan SONRA onaylanıp belleğe geri dönmesin.
  await flushLicenseTraceWrites();
  __resetLicenseRuntimeForTests();
  const d = dir ?? geciciDizin("taze");
  if (dir === undefined) loadLicenseStoreSync({ dir: d });
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: null });
  setLicenseDbFacts({ installationId: randomUUID(), firstOpenMs: Date.now() - 3 * DAY_MS, ledgerHighWaterMs: null });
  setMeasuredFingerprint({ digest: f.parmakIzi, measured: { f1: true, f2: true, f3: true, f4: true, f5: true }, measuredAt: new Date().toISOString() });
  setLicenseTraceRow(null);
  setActivationLockForTests(true);
  invalidateLicenseSnapshot();
  return d;
}

// ── §1 B1 ──────────────────────────────────────────────────────────────────────────────────────────────────
const tasimaYaz = (dir: string, durum?: "ONAYLANDI"): void => {
  fs.writeFileSync(path.join(dir, LICENSE_FILES.TRANSFER), JSON.stringify({ v: 1, talepId: randomUUID(), istendi: new Date().toISOString(), gerekce: null, ...(durum ? { durum } : {}) }));
  loadLicenseStoreSync({ dir });
  invalidateLicenseSnapshot();
};

async function b1(token: string): Promise<void> {
  console.log("\n§1 — B1 bekleyen taşıma etkin saymaz");
  const f = fiksturKur(Date.now());
  const dir = await taze(f);
  check("§1a zemin: taze kurulum ETKINLESMEDI, iş ucu 403", kilit() === "ETKINLESMEDI/IZ_YOK" && (await kapi(token)).startsWith("403:LICENSE_NOT_ACTIVATED"), `${kilit()} · ${await kapi(token)}`);

  tasimaYaz(dir);
  const s = getLicenseSnapshot();
  const k = await kapi(token);
  check("§1b ⭐ elle yazılmış imzasız tasima.json (BEKLIYOR) → etkin değil, kilit ETKINLESMEDI, iş ucu 403",
    !s.activated && kilit() === "ETKINLESMEDI/IZ_YOK" && k.startsWith("403:LICENSE_NOT_ACTIVATED"), `activated=${s.activated} kilit=${kilit()} kapı=${k}`);
  for (const [m, yol] of [["GET", "/api/rolls"], ["POST", "/api/shipping/shipments"]] as const) {
    check(`§1c ⭐ ${m} ${yol} kilitte 403`, (await kapi(token, m, yol)).startsWith("403:LICENSE_NOT_ACTIVATED"));
  }
  tasimaYaz(dir, "ONAYLANDI");
  check("§1d durum ONAYLANDI yazılırsa da kilit sürer (kod girilmeden etkinlik yok)", kilit() === "ETKINLESMEDI/IZ_YOK", kilit());

  // Meşru API yolu: kilit altında açık `POST /api/license/tasima-talebi` → satıcı BEKLIYOR.
  await flushLicenseTraceWrites();
  __resetLicenseRuntimeForTests();
  const d2 = geciciDizin("tasima-api");
  const key = loadLicenseStoreSync({ dir: d2 }).key;
  if (!key) throw new Error("anahtar yok");
  const f0 = fiksturKur(Date.now());
  const f2: Fikstur = { ...f0, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  const sat = await sahteSaticiBaslat(f2);
  saticilar.push(sat);
  sat.tasimaDurumu = "BEKLIYOR";
  await taze(f2, d2);
  configureLicenseRuntimeForTests({ roots: f2.kokler, vendorUrl: sat.url });
  setEgressTrustForTests(sat.ca);
  try {
    await kabulEt();
    const once = kilit();
    const kapiAcikMi = await kapi(token, "POST", "/api/license/tasima-talebi");
    const r = await requestTransfer(null, null);
    check("§1e zemin: tasima-talebi ucu kilit altında AÇIK; talep BEKLIYOR, lisans yok",
      once === "ETKINLESMEDI/IZ_YOK" && kapiAcikMi === "ROTAYA" && r.durum === "BEKLIYOR" && sat.sayac.tasima === 1 && sat.sayac.etkinlestir === 0, `${once} ${kapiAcikMi} ${r.durum} sayac=${JSON.stringify(sat.sayac)}`);
    check("§1f ⭐ satıcı onayı olmadan (BEKLIYOR) kilit KALKMAZ, iş ucu 403", kilit() === "ETKINLESMEDI/IZ_YOK" && (await kapi(token)).startsWith("403:LICENSE_NOT_ACTIVATED"), `${kilit()} · ${await kapi(token)}`);
    const p = await pollLicenseOnce(egressTransport);
    check("§1g ⭐ etkin olmayan kurulum bekleyen talebin durumunu yoklar (TASIMA_ONAYI_BEKLIYOR)",
      p.outcome === "BASARISIZ" && p.code === "TASIMA_ONAYI_BEKLIYOR" && sat.sayac.tasima === 2, `${p.outcome} ${p.code ?? ""} sayac=${sat.sayac.tasima}`);
    sat.tasimaDurumu = "REDDEDILDI";
    const p2 = await pollLicenseOnce(egressTransport);
    check("§1h satıcı reddedince yoklama talebi düşürür, kilit sürer",
      p2.code === "TASIMA_REDDEDILDI" && loadLicenseStoreSync({ dir: d2 }).transfer === null && kilit() === "ETKINLESMEDI/IZ_YOK", `${p2.code ?? ""} ${kilit()}`);
  } finally {
    setEgressTrustForTests(null);
  }
}

// ── §2 B2 ──────────────────────────────────────────────────────────────────────────────────────────────────
const VERI_UCLARI: ReadonlyArray<readonly [string, string]> = [
  ["POST", "/api/admin/backup"],
  ["GET", "/api/admin/backups"],
  ["GET", "/api/import/customers/export"],
  ["GET", "/api/license/detay"],
  ["POST", "/api/license/etkinlestir"],
];

function ortamGeriYukle(): void {
  if (ENV_YEDEK.LICENSE_DIR === undefined) delete process.env.LICENSE_DIR;
  else process.env.LICENSE_DIR = ENV_YEDEK.LICENSE_DIR;
  if (ENV_YEDEK.BACKUP_DIR === undefined) delete process.env.BACKUP_DIR;
  else process.env.BACKUP_DIR = ENV_YEDEK.BACKUP_DIR;
}

async function b2(token: string): Promise<void> {
  console.log("\n§2 — B2 kullanılamayan lisans deposu = KURULUM_HATASI (fail-closed, yalnız korumalı derlemede)");
  check("§2a yüklem: OKUNAMADI + DB izinden anahtar (G12) hata DEĞİL · iz henüz okunmadıysa hata DEĞİL · izsiz hata · sorunsuz depo hata değil",
    !licenseStoreSetupError({ problem: "OKUNAMADI" } as never, "kid", true) &&
    !licenseStoreSetupError({ problem: "OKUNAMADI" } as never, null, false) &&
    licenseStoreSetupError({ problem: "OKUNAMADI" } as never, null, true) &&
    licenseStoreSetupError({ problem: "APP_ICINDE" } as never, "kid", false) &&
    !licenseStoreSetupError({ problem: null } as never, null, true) &&
    !licenseStoreSetupError(null, null, true));
  const f = fiksturKur(Date.now());
  const yedek = geciciDizin("yedek");
  const dosya = path.join(geciciDizin("dosya"), "duz-dosya");
  fs.writeFileSync(dosya, "x");
  const buyuk = geciciDizin("buyuk");
  fs.writeFileSync(path.join(buyuk, LICENSE_FILES.KEY), "x".repeat(9 * 1024));
  const vakalar: Array<[string, () => void]> = [
    ["APP_ICINDE (program dizini altı)", () => { process.env.LICENSE_DIR = path.join(process.cwd(), "kilit-kacak-yok-dizin"); }],
    ["YEDEK_ICINDE (BACKUP_DIR altı)", () => { process.env.BACKUP_DIR = yedek; process.env.LICENSE_DIR = path.join(yedek, "lisans"); }],
    ["YAZILAMADI (yol bir dosyanın altında)", () => { process.env.LICENSE_DIR = path.join(dosya, "lisans"); }],
    ["OKUNAMADI (anahtar dosyası > 8 KB, DB izi yok)", () => { process.env.LICENSE_DIR = buyuk; }],
  ];
  try {
    for (const [ad, kur] of vakalar) {
      delete process.env.BACKUP_DIR;
      kur();
      const s0 = loadLicenseStoreSync();
      await taze(f, s0.dir);
      const k = await kapi(token);
      check(`§2b ⭐ ${ad}: problem=${s0.problem} → kilit KURULUM_HATASI, iş ucu 403`,
        kilit() === "KURULUM_HATASI/DEPO_KULLANILAMAZ" && k === "403:LICENSE_NOT_ACTIVATED/KURULUM_HATASI", `kilit=${kilit()} kapı=${k} durumHazir=${getLicenseSnapshot().durumHazir}`);
      const kapali: string[] = [];
      for (const [m, yol] of VERI_UCLARI) if ((await kapi(token, m, yol)) !== "ROTAYA") kapali.push(`${m} ${yol}`);
      check(`§2c ${ad}: lisans ekranı + 'verilerimi al' (yedek · dışa aktarma) açık`, kapali.length === 0, kapali.join(" | "));
    }
    // Kilit kapalı (geliştirme/gözlem derlemesi): davranış değişmez.
    delete process.env.BACKUP_DIR;
    process.env.LICENSE_DIR = path.join(process.cwd(), "kilit-kacak-yok-dizin");
    await taze(f, loadLicenseStoreSync().dir);
    setActivationLockForTests(false);
    check("§2d kilit kapalı derlemede kötü dizin → YOK/KAPALI, iş ucu rotaya (sıfır fark)", kilit() === "YOK/KAPALI" && (await kapi(token)) === "ROTAYA", `${kilit()} ${await kapi(token)}`);
    // Etkin + zorlanan (K4) kurulum: dizin hilesi kademe kapısını da düşürmez.
    const kip = lisansKipKur({ zorlama: true, kademe: "K4" });
    setActivationLockForTests(true);
    const once = await kapi(token);
    process.env.LICENSE_DIR = path.join(process.cwd(), "kilit-kacak-yok-dizin");
    loadLicenseStoreSync();
    invalidateLicenseSnapshot();
    const sonra = await kapi(token);
    check("§2e ⭐ etkin kurulum zorla K4: doğru dizinde 403 LICENSE_RESTRICTED; LICENSE_DIR program dizinine → yine 403 (KURULUM_HATASI)",
      once.startsWith("403:LICENSE_RESTRICTED") && sonra === "403:LICENSE_NOT_ACTIVATED/KURULUM_HATASI", `önce=${once} (uygulanan=${kip.snap.state.uygulananKademe}) sonra=${sonra}`);
    temizleLisansKipDizini();
    if (process.platform !== "win32" && process.getuid?.() !== 0) {
      lisansKipKur({ zorlama: true, kademe: "K4", anahtarOkunamaz: true });
      setActivationLockForTests(true);
      const g12 = await kapi(token);
      check("§2f G12 aynen: anahtar okunamaz + DB izi → kurulum hatası DEĞİL, kilit YOK, kademe kararı sürer (LICENSE_RESTRICTED)",
        kilit() === "YOK/ETKIN" && g12.startsWith("403:LICENSE_RESTRICTED"), `${kilit()} ${g12}`);
      temizleLisansKipDizini();
    }
    check("§2g APP_ICINDE vakası program dizininde dosya yaratmadı", !fs.existsSync(path.join(process.cwd(), "kilit-kacak-yok-dizin")));
  } finally {
    ortamGeriYukle();
  }
}

// ── §3 B4 ──────────────────────────────────────────────────────────────────────────────────────────────────
async function b4(): Promise<void> {
  console.log("\n§3 — B4 G1 mührü TOTP'yi kapsar");
  const dir = geciciDizin("b4");
  loadLicenseStoreSync({ dir });
  process.env.LICENSE_DIR = dir;
  resetSystemAccountSealCacheForTest();
  const ad = `TEST-kilit-b4-${Date.now()}`;
  const parola = "Deneme-b4-12345";
  const sa = (await prisma.user.create({
    data: { username: ad, passwordHash: await AuthService.hashPassword(parola), fullName: "TEST b4", isSystemAccount: true },
    select: { id: true },
  })).id;
  fiksturler.push(sa);
  const yaz = await writeSeal(prisma, sa);
  if (yaz.durum === "MUHURLENDI") writeLatch(yaz.kid);
  const gecis = await migrateSealsToV2();
  const row = async (): Promise<SealRow> => {
    resetSystemAccountSealCacheForTest();
    return prisma.user.findUniqueOrThrow({ where: { id: sa }, select: SEAL_ROW_SELECT });
  };
  const giris = async (): Promise<string> => {
    try {
      await AuthService.login(ad, parola, { clientType: "electron" } as never);
      return "200";
    } catch (e) {
      return e instanceof AppError ? `${e.statusCode}:${String((e.details as { code?: string } | undefined)?.code ?? "")}` : String(e);
    }
  };
  check("§3a zemin: mühürlü + mandal VAR + geçiş işareti; giriş 200",
    yaz.durum === "MUHURLENDI" && fs.existsSync(path.join(dir, SYSTEM_ACCOUNT_LATCH_FILE)) && gecis.durum === "TAMAM" &&
      sealStatus(await row()) === "GECERLI" && (await giris()) === "200",
    `${yaz.durum} ${gecis.durum}`);

  await prisma.user.update({ where: { id: sa }, data: { totpSecret: generateTotpSecret(), totpEnabledAt: new Date() } });
  const r1 = await row();
  check("§3b ⭐ DB'den TOTP sırrı yazılınca mühür BOZUK, yetki yok, giriş 403 SYSTEM_ACCOUNT_SEAL_INVALID",
    sealStatus(r1) === "BOZUK" && !isSystemAccountAuthorized(r1) && (await giris()) === "403:SYSTEM_ACCOUNT_SEAL_INVALID", `${sealStatus(r1)} ${await giris()}`);
  await prisma.user.update({ where: { id: sa }, data: { totpSecret: null, totpEnabledAt: null } });

  const w = await TotpAccountService.openWindow({ userId: sa, openedById: sa });
  await TotpAccountService.consumeWindow(w.token, totpCodeForStep(w.secret, totpStep()));
  const r2 = await row();
  check("§3c zemin: meşru 2FA kurulumu sonrası mühür GECERLI", sealStatus(r2) === "GECERLI" && isSystemAccountAuthorized(r2), sealStatus(r2));
  await prisma.user.update({ where: { id: sa }, data: { totpEnabledAt: null } });
  const r3 = await row();
  check("§3c ⭐ DB'den `totpEnabledAt` boşaltılınca (2FA'yı sessizce kapatma) mühür BOZUK, giriş 403",
    sealStatus(r3) === "BOZUK" && !isSystemAccountAuthorized(r3) && (await giris()) === "403:SYSTEM_ACCOUNT_SEAL_INVALID", `${sealStatus(r3)} ${await giris()}`);
}

async function main(): Promise<void> {
  console.log("=== Lisans kilit kaçakları (denetim B1 · B2 · B4) ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  AuditService.log = async () => undefined;
  AuditService.logEvent = async () => undefined;
  const ad = `TEST-kilit-kacak-${Date.now()}`;
  const u = await prisma.user.create({ data: { username: ad, passwordHash: await AuthService.hashPassword("Deneme-12345"), fullName: "TEST denetim" }, select: { id: true } });
  fiksturler.push(u.id);
  try {
    const { token } = await AuthService.login(ad, "Deneme-12345");
    await b1(token);
    await b2(token);
    await b4();
  } finally {
    for (const s of saticilar) await s.kapat().catch(() => undefined);
    await temizleKabuller().catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: fiksturler } } }).catch(() => undefined);
    await prisma.workSession.deleteMany({ where: { userId: { in: fiksturler } } }).catch(() => undefined);
    await prisma.totpEnrollment.deleteMany({ where: { userId: { in: fiksturler } } }).catch(() => undefined);
    await prisma.user.updateMany({ where: { id: { in: fiksturler } }, data: { isSystemAccount: false, systemAccountSeal: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: fiksturler } } }).catch(() => undefined);
    setActivationLockForTests(null);
    for (const d of dizinler) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} kaldı ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
