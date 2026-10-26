// =============================================================================
// BEKÇİ — G3 KİP ALT SINIRI · B6 YABANCI İZ MERDİVENİ (`activation-trace.ts classifyForeignTraceDetail` ·
// `foreign-trace-epoch.ts` · `state-rules-trace.ts` yabancı iz dalı · `state.ts computeMode`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_kip_alt_siniri   (kendi _test DB'si; geçici kullanıcı açar,
// teardown'da siler — oturumlu kapı kararı DB'de oturum ister)
//
// Etkin kurulumda HAK alt sınırının (kira/kayıt/derleme gözleme indiremez) ölçüsü `test_lisans_durumu` §25'tedir; burada
// TEKRAR EDİLMEZ. Bu bekçi etkinleşmemiş kurulumu ölçer (lisans kimliği yok → HAK pini görülmez):
//   §1 ⭐ kip alt sınırı olmayan yabancı iz (gözlem kirası, pin yok) → kip gözlem, +60 g NORMAL, iş ucu açık (adnansahin
//      sınıfı: bugünkü davranış); epoch dosyası YAZILMAZ
//   §2 ⭐ zorla yabancı iz (KAYIP) → kip zorla; sahte saatle merdiven: +0 UYARI (`LISANS_IZI_KAYIP`) → +15 g EK_SURE →
//      +45 g KISITLI; BELIRSIZ kolu (küme okunamadı) da aynı merdiven
//   §3 ⭐ kira zorlama=false + iz kaydındaki HAK pini `kipAltSiniri: zorla` → kip zorla (alt sınır kiradan güçlü)
//   §4 ⭐ KISITLI'da kapı: GET 200 (rotaya) · yedek/dışa aktarma rotaya · yazma 403 `LICENSE_RESTRICTED`
//   §5 ⭐ epoch kalıcılığı: DB izi silinip geri yüklenince ve süreç yeniden başlayınca başlangıç LICENSE_DIR'den gelir
//      (kademe sürer); kurcalanmış epoch satırı (imza tutmuyor) kabul edilmez
//   §6 derleme sabiti kapalı (geliştirme) → merdiven yok, kip gözlem (sıfır fark)
//   ⭐ NEGATİF SONDA §7: `yabanciIz`i düşüren durum hesaplayıcısı §2 ölçüsünü kırmızıya düşürür; kip türetimini
//      gözleme sabitleyen sınıflayıcı §3 ölçüsünü kırmızıya düşürür
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { AuthService } from "../src/services/auth.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { licenseGate } from "../src/middlewares/license.middleware";
import { setPgClusterId, pgClusterDigest, __resetPgClusterForTests } from "../src/lib/license/pg-cluster";
import { LICENSE_FILES, loadLicenseStoreSync } from "../src/lib/license/store";
import { setLicenseTraceRow, TraceRowSchema } from "../src/lib/license/trace-row";
import { classifyForeignTraceDetail, type ForeignTraceDetail } from "../src/lib/license/activation-trace";
import { foreignTraceStartMs, __resetForeignTraceEpochForTests } from "../src/lib/license/foreign-trace-epoch";
import { signStateRecord } from "../src/lib/license/saat";
import { computeLicenseState, type LicenseState } from "../src/lib/license/state";
import type { LicenseStateInput } from "../src/lib/license/state-rules";
import {
  __resetLicenseRuntimeForTests,
  configureLicenseRuntimeForTests,
  getLicenseSnapshot,
  invalidateLicenseSnapshot,
  setActivationLockForTests,
  setLicenseDbFacts,
  setMeasuredFingerprint,
  type LicenseSnapshot,
} from "../src/lib/license/runtime";
import { DAY_MS, msToIso } from "../src/lib/license/protocol";
import { fiksturKur, kiraBas, type Fikstur } from "./lib/lisans-fikstur";
import { kapidanGecir, type Uc } from "./lib/lisans-kapi-surucu";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${!ok && detay ? ` — ${detay}` : ""}`);
}

const KUME = "7300000000000000001";
const dizinler: string[] = [];

/** Eski (kaybolmuş) kurulumun DB izi: satıcı kirası + o anahtarla imzalı durum kaydı (+ PG özeti, HAK pini). */
function yabanciIz(eski: Fikstur, g: { zorlama: boolean; pin?: "zorla"; pg?: boolean }): unknown {
  const kayit = {
    v: 1 as const,
    kurulumId: eski.kurulumId,
    kiraId: randomUUID(),
    birikenMs: 0,
    yazildi: msToIso(Date.now() - DAY_MS),
    yuksekSu: msToIso(Date.now() - DAY_MS),
    sonKiraZorlamasi: g.zorlama,
    sonYaptirim: null,
    sira: 3,
    ...(g.pg === false ? {} : { pgOzeti: pgClusterDigest(eski.kurulumId, KUME) }),
    ...(g.pin ? { sonHak: { hakId: randomUUID(), surum: 1, sinif: "URETIM", kokTuru: "kok", kipAltSiniri: g.pin } } : {}),
  };
  const durum = signStateRecord(kayit as Parameters<typeof signStateRecord>[0], eski.kurulum.privateKey, eski.kurulum.x);
  return { v: 1, kurulumId: eski.kurulumId, anahtar: eski.kurulum.x, durum, kira: kiraBas(eski, { zorlama: g.zorlama }) };
}

interface Kurulum {
  readonly dir: string;
  readonly snap: (nowMs?: number) => LicenseSnapshot;
}

/** Hiç etkinleşmemiş kurulum (temiz LICENSE_DIR) + başka kurulumun DB izi; `dir` verilirse aynı depo (yeniden başlatma). */
function kurulum(g: { eski: Fikstur; iz: unknown; kilit?: boolean; dir?: string; epochMs?: number }): Kurulum {
  __resetLicenseRuntimeForTests();
  const dir = g.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "g3-kip-"));
  if (!g.dir) dizinler.push(dir);
  const store = loadLicenseStoreSync({ dir });
  if (!store.key) throw new Error("kurulum anahtarı üretilemedi");
  configureLicenseRuntimeForTests({ roots: g.eski.kokler, vendorUrl: null });
  setLicenseDbFacts({ installationId: randomUUID(), firstOpenMs: Date.now() - 3 * DAY_MS, ledgerHighWaterMs: null });
  const tum = { f1: true, f2: true, f3: true, f4: true, f5: true };
  setMeasuredFingerprint({ digest: g.eski.parmakIzi, measured: tum, measuredAt: new Date().toISOString() });
  setLicenseTraceRow(g.iz);
  setActivationLockForTests(g.kilit ?? true);
  // "Sahte saat": imzalı başlangıcı geçmişe yazmak = o kadar gün önce görülmüş iz (kapı gerçek saatle okur).
  if (g.epochMs !== undefined) foreignTraceStartMs(g.eski.kurulumId, g.epochMs);
  invalidateLicenseSnapshot();
  return { dir, snap: (nowMs?: number) => getLicenseSnapshot(nowMs) };
}

const kademe = (s: LicenseSnapshot): string => `${s.state.kip}/${s.state.uygulananKademe}`;
const neden = (s: LicenseSnapshot, kod: string): boolean => s.state.nedenler.some((n) => n.kod === kod);
const epochDosyasi = (dir: string): string => path.join(dir, LICENSE_FILES.FOREIGN_TRACE_EPOCH);

const uc = (m: string, yol: string): Uc => ({ m, desen: yol, ornek: yol });
async function kapi(m: string, yol: string, token: string): Promise<{ rotaya: boolean; kod: unknown }> {
  const s = await kapidanGecir(licenseGate, uc(m, yol), token);
  const d = (s.hata as { details?: Record<string, unknown> } | undefined)?.details ?? null;
  return { rotaya: s.hata === undefined, kod: d?.code };
}

/** §2 ölçüsü: verilen durum hesaplayıcısı +45 g yabancı iz girdisinde KISITLI/zorla veriyor mu (sonda bozuk kopyayı koşar). */
function merdivenOlcusu(hesapla: (g: LicenseStateInput) => LicenseState, girdi: LicenseStateInput): boolean {
  const s = hesapla(girdi);
  return s.kip === "zorla" && s.uygulananKademe === "KISITLI";
}

// ── §1 ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function gozlemIzi(token: string): Promise<void> {
  console.log("\n§1 — kip alt sınırı olmayan yabancı iz (gözlem) → bugünkü davranış");
  const eski = fiksturKur(Date.now());
  setPgClusterId(KUME);
  const k = kurulum({ eski, iz: yabanciIz(eski, { zorlama: false }) });
  const s0 = k.snap();
  check("§1a ⭐ iz KAYIP, kilit yok, kip gözlem, NORMAL", s0.etkinlestirmeKilidi.neden === "IZ_KAYIP" && kademe(s0) === "gozlem/NORMAL", `${kademe(s0)} ${JSON.stringify(s0.etkinlestirmeKilidi)}`);
  const s60 = k.snap(Date.now() + 60 * DAY_MS);
  check("§1b ⭐ +60 g: hâlâ gözlem/NORMAL, merdiven bulgusu yok", kademe(s60) === "gozlem/NORMAL" && !neden(s60, "BELIRSIZLIK_SURUYOR"), kademe(s60));
  check("§1c gözlem izinde epoch dosyası yazılmaz", !fs.existsSync(epochDosyasi(k.dir)));
  kurulum({ eski, iz: yabanciIz(eski, { zorlama: false }), epochMs: Date.now() - 60 * DAY_MS });
  check("§1d ⭐ gözlem izinde iş ucu açık (POST /api/orders rotaya)", (await kapi("POST", "/api/orders", token)).rotaya);
}

// ── §2 / §3 ──────────────────────────────────────────────────────────────────────────────────────────────
function zorlaMerdiveni(): void {
  console.log("\n§2 — zorla yabancı iz → merdiven (uyarı → ek süre → kısıtlı)");
  const eski = fiksturKur(Date.now());
  setPgClusterId(KUME);
  const k = kurulum({ eski, iz: yabanciIz(eski, { zorlama: true }) });
  const t0 = Date.now();
  const s0 = k.snap(t0);
  check("§2a ⭐ KAYIP + zorla → kilit yok, kip ZORLA, UYARI (LISANS_IZI_KAYIP)", s0.etkinlestirmeKilidi.neden === "IZ_KAYIP" && kademe(s0) === "zorla/UYARI" && neden(s0, "LISANS_IZI_KAYIP"), `${kademe(s0)} ${JSON.stringify(s0.state.nedenler)}`);
  check("§2b epoch dosyası LICENSE_DIR'e yazıldı", fs.existsSync(epochDosyasi(k.dir)));
  const s15 = k.snap(t0 + 15 * DAY_MS);
  check("§2c ⭐ +15 g → EK_SURE (BELIRSIZLIK_SURUYOR)", kademe(s15) === "zorla/EK_SURE" && neden(s15, "BELIRSIZLIK_SURUYOR"), `${kademe(s15)} kalan=${s15.state.ekSureKalanGun}`);
  const s45 = k.snap(t0 + 45 * DAY_MS);
  check("§2d ⭐ +45 g → KISITLI", kademe(s45) === "zorla/KISITLI", kademe(s45));
  __resetPgClusterForTests();
  const b = kurulum({ eski, iz: yabanciIz(eski, { zorlama: true }) });
  const t1 = Date.now();
  b.snap(t1);
  const b45 = b.snap(t1 + 45 * DAY_MS);
  check("§2e ⭐ BELIRSIZ (küme okunamadı) + zorla → aynı merdiven, +45 g KISITLI", b45.etkinlestirmeKilidi.neden === "IZ_OLCULEMEDI" && kademe(b45) === "zorla/KISITLI", `${kademe(b45)} ${JSON.stringify(b45.etkinlestirmeKilidi)}`);
  setPgClusterId(KUME);
}

function pinZorla(): void {
  console.log("\n§3 — kira gözlem + iz kaydındaki HAK pini zorla");
  const eski = fiksturKur(Date.now());
  setPgClusterId(KUME);
  const iz = yabanciIz(eski, { zorlama: false, pin: "zorla" });
  const d = classifyForeignTraceDetail(TraceRowSchema.parse(iz), { roots: eski.kokler });
  check("§3a ⭐ sınıflayıcı: KAYIP + kip zorla (alt sınır kiradan güçlü)", d.sinif === "KAYIP" && d.kip === "zorla", JSON.stringify(d));
  const k = kurulum({ eski, iz, epochMs: Date.now() - 45 * DAY_MS });
  const s = k.snap();
  check("§3b ⭐ çalışma zamanı: +45 g zorla/KISITLI", kademe(s) === "zorla/KISITLI", kademe(s));
}

// ── §4 ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function kisitliKapi(token: string): Promise<void> {
  console.log("\n§4 — KISITLI'da kapı: okuma/yedek açık, yazma 403");
  const eski = fiksturKur(Date.now());
  setPgClusterId(KUME);
  const k = kurulum({ eski, iz: yabanciIz(eski, { zorlama: true }), epochMs: Date.now() - 45 * DAY_MS });
  check("§4a ön koşul: imzalı başlangıç 45 g önce → KISITLI", kademe(k.snap()) === "zorla/KISITLI", kademe(k.snap()));
  for (const [m, yol] of [["GET", "/api/orders"], ["GET", "/api/rolls"], ["POST", "/api/admin/backup"], ["GET", "/api/import/orders/export"]] as const) {
    check(`§4b ⭐ açık — ${m} ${yol}`, (await kapi(m, yol, token)).rotaya);
  }
  const y = await kapi("POST", "/api/orders", token);
  check("§4c ⭐ yazma → 403 LICENSE_RESTRICTED", !y.rotaya && y.kod === "LICENSE_RESTRICTED", JSON.stringify(y));
}

// ── §5 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function kalicilik(): void {
  console.log("\n§5 — epoch kalıcılığı (DB'den sıfırlanamaz)");
  const eski = fiksturKur(Date.now());
  setPgClusterId(KUME);
  const iz = yabanciIz(eski, { zorlama: true });
  const k = kurulum({ eski, iz, epochMs: Date.now() - 20 * DAY_MS });
  check("§5a ön koşul: 20 g → EK_SURE", kademe(k.snap()) === "zorla/EK_SURE", kademe(k.snap()));
  // DB izi silindi (YOK) ve aynı döküm geri yüklendi; süreç yeniden başladı (bellek sıfır), LICENSE_DIR aynı.
  setLicenseTraceRow(null);
  const yeniden = kurulum({ eski, iz, dir: k.dir });
  const s = yeniden.snap();
  check("§5b ⭐ DB izi geri yüklendi + yeniden başlatma → başlangıç LICENSE_DIR'den, EK_SURE sürer", kademe(s) === "zorla/EK_SURE", kademe(s));
  // Kurcalama: başlangıcı ileri al (imza tutmaz) → satır yok sayılır, sayaç kurcalanan değeri benimsemez.
  const dosya = JSON.parse(fs.readFileSync(epochDosyasi(k.dir), "utf8")) as { kayitlar: Array<{ baslangic: string }> };
  const ileri = msToIso(Date.now() - DAY_MS);
  dosya.kayitlar[0].baslangic = ileri;
  fs.writeFileSync(epochDosyasi(k.dir), JSON.stringify(dosya));
  __resetForeignTraceEpochForTests();
  const bas = foreignTraceStartMs(eski.kurulumId, Date.now());
  check("§5c kurcalanmış satır (imza tutmuyor) kabul edilmez", Math.abs(bas - Date.parse(ileri)) > 60_000, `bas=${msToIso(bas)}`);
}

// ── §6 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function kilitKapali(): void {
  console.log("\n§6 — derleme sabiti kapalı (geliştirme) → sıfır fark");
  const eski = fiksturKur(Date.now());
  setPgClusterId(KUME);
  const k = kurulum({ eski, iz: yabanciIz(eski, { zorlama: true }), kilit: false });
  k.snap();
  const s = k.snap(Date.now() + 45 * DAY_MS);
  check("§6a kilit kapalı: kip gözlem, NORMAL, epoch yazılmaz", kademe(s) === "gozlem/NORMAL" && !fs.existsSync(epochDosyasi(k.dir)), kademe(s));
}

// ── §7 negatif sonda ─────────────────────────────────────────────────────────────────────────────────────
function negatifSonda(): void {
  console.log("\n§7 — negatif sonda");
  const eski = fiksturKur(Date.now());
  setPgClusterId(KUME);
  const k = kurulum({ eski, iz: yabanciIz(eski, { zorlama: true }), epochMs: Date.now() - 45 * DAY_MS });
  const snap = k.snap();
  const girdi = snapshotInput(snap);
  check("§7a sonda ön koşulu: gerçek hesaplayıcı ölçüyü geçer", merdivenOlcusu(computeLicenseState, girdi));
  const bozuk = (g: LicenseStateInput): LicenseState => computeLicenseState({ ...g, yabanciIz: null });
  check("§7b ⭐ `yabanciIz`i düşüren hesaplayıcı §2 ölçüsüne takılır", !merdivenOlcusu(bozuk, girdi));
  const gozlemSabit = (row: unknown): ForeignTraceDetail => ({ ...classifyForeignTraceDetail(TraceRowSchema.parse(row), { roots: eski.kokler }), kip: "gozlem" });
  check("§7c ⭐ kipi gözleme sabitleyen sınıflayıcı §3a ölçüsüne takılır", gozlemSabit(yabanciIz(eski, { zorlama: false, pin: "zorla" })).kip !== "zorla");
}

/** Anlık görüntünün durum girdisi yeniden kurulmaz; ölçü için asgari yabancı iz girdisi (etkinleşmemiş, 45 g birikim). */
function snapshotInput(s: LicenseSnapshot): LicenseStateInput {
  return {
    kurulumId: null,
    kurulumAnahtarKimligi: null,
    hak: { status: "YOK" },
    kira: { status: "YOK" },
    saat: { duvarMs: s.computedAtMs, yuksekSuMs: 0, monotonik: null, durumDosyasiGecerli: false, kapaliKrediMs: 0 },
    parmakIziEslesme: "OLCULEMEDI",
    butunluk: "KAPSAM_DISI",
    derlemeTarihiMs: null,
    ilkAcilisMs: null,
    varsayilanKip: "gozlem",
    sonKiraZorlamasi: null,
    sonYaptirim: null,
    izler: { etkin: false, durumDosyasi: false, dbIzi: "YOK", dbIziKurulu: false, kayip: [] },
    belirsizlikMs: 45 * DAY_MS,
    yabanciIz: { kip: "zorla", baslangicMs: s.computedAtMs - 45 * DAY_MS },
  };
}

async function main(): Promise<void> {
  console.log("=== G3 kip alt sınırı · B6 yabancı iz merdiveni ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  AuditService.log = async () => undefined;
  AuditService.logEvent = async () => undefined;
  const ad = `TEST-g3-kip-${Date.now()}`;
  const u = await prisma.user.create({ data: { username: ad, passwordHash: await AuthService.hashPassword("Deneme-12345"), fullName: "TEST G3 Kip" }, select: { id: true } });
  try {
    const { token } = await AuthService.login(ad, "Deneme-12345");
    await gozlemIzi(token);
    zorlaMerdiveni();
    pinZorla();
    await kisitliKapi(token);
    kalicilik();
    kilitKapali();
    negatifSonda();
  } finally {
    await prisma.session.deleteMany({ where: { userId: u.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: u.id } }).catch(() => undefined);
    setActivationLockForTests(null);
    __resetPgClusterForTests();
    __resetLicenseRuntimeForTests();
    for (const d of dizinler) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
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
