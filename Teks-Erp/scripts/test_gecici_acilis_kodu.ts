// =============================================================================
// BEKÇİ — YAZARAK ETKİNLEŞTİRME, fabrika tarafı (`temp-opening.ts` · `license-temp-code.service.ts` ·
// `activation-lock.ts` GECICI · `state-rules-time.ts` geçici açılış çapası/uyarısı · `state.ts computeMode`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts gecici_acilis_kodu   (kendi _test DB'si; geçici kullanıcı açar, siler)
//
//   §1 istek kodu: TI-… biçimi, tekrar okumada AYNI, yenileyince farklı, LICENSE_DIR'de
//   §2 ⭐ geçerli kod → kilit YOK (neden GECICI, sınıf YOK — eski panel "YOK" görür), kip zorla, iş ucu açık;
//      istek kodu yenilendi; durum özeti `gecici` alanı uçla aynı
//   §3 ⭐ retler (400 TEMP_CODE_INVALID): yanlış imza · başka kurulum · süresi geçmiş · tekrar · sağlama · karakter
//      (konum) · dar kök (IMZACI); etkin kurulumda 409
//   §4 ⭐ süre sonu merdiveni (sahte saat): bitişe >7 g uyarısız · ≤7 g UYARI bandı · bitiş+1 g EK_SURE ·
//      bitiş+31 g KISITLI; KISITLI'da GET açık, yazma 403 LICENSE_RESTRICTED
//   §5 kopyalanan açılış dosyası başka kurulum anahtarında geçmez · kurcalanan bitiş imzadan düşer
//   §6 ⭐ tam etkinleştirme geçici kaydı kapatır (kapanış yazılır, kilit geri ETKINLESMEDI'ye değil — etkin yol)
//   §7 ⭐ ayak izinde düz kod yok (son 4 + bitiş)
//   §8 tüketim bildirimi kuyruğu: düşerse kalır, sonra iletilir (idempotent, özet)
//   §9 kilit kapalı derleme: kod kabul edilir, merdiven yok (gözlem, sıfır fark)
//   ⭐ NEGATİF SONDA §10: `geciciAcilis`i düşüren hesaplayıcı §4 KISITLI ölçüsünü, `temp`i yok sayan sınıflayıcı §2
//      kilit ölçüsünü kırmızıya düşürür
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, sign } from "node:crypto";
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { AuthService } from "../src/services/auth.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { licenseGate } from "../src/middlewares/license.middleware";
import { classifyActivationLock, type ActivationLockInput } from "../src/lib/license/activation-lock";
import { loadLicenseStoreSync } from "../src/lib/license/store";
import { TEMP_FILES } from "../src/lib/license/temp-opening-files";
import { setLicenseTraceRow } from "../src/lib/license/trace-row";
import { computeLicenseState, type LicenseState } from "../src/lib/license/state";
import type { LicenseStateInput } from "../src/lib/license/state-rules";
import { checkTempCode, storeTempOpening } from "../src/lib/license/temp-opening";
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
import {
  DAY_MS,
  LICENSE_CLASSES,
  b64uEncode,
  dayOfMs,
  encodeTempOpeningCode,
  formatTempOpeningCode,
  normalizeTempText,
  tempOpeningSigningInput,
  type RootKey,
} from "../src/lib/license/protocol";
import { acceptTempCode, flushTempConsumption, getTempRequest, renewTempRequestCode } from "../src/services/license-temp-code.service";
import { getLicenseStatus } from "../src/services/license-view.service";
import { closeTempOnActivation } from "../src/services/license-trail.service";
import type { VendorTransport } from "../src/services/helpers/license-wire.helper";
import { anahtarUret, fiksturKur, type TestAnahtari } from "./lib/lisans-fikstur";
import { kapidanGecir } from "./lib/lisans-kapi-surucu";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${!ok && detay ? ` — ${detay}` : ""}`);
}

const dizinler: string[] = [];
// Fikstür kökleri (`kok-fikstur-…`) koda sığmaz: koda sığan bir üretim kökü ve bir dar (TEST/DEMO) kök eklenir.
const KOK = anahtarUret("kok-2026-9");
const DAR = anahtarUret("kok-2026-10");
const SAHTE = anahtarUret("kok-2026-9");
const sayac = { kodId: 100 };

function kokler(): RootKey[] {
  return [
    ...fiksturKur(Date.now()).kokler,
    { kid: KOK.kid, x: KOK.x, classes: [...LICENSE_CLASSES] },
    { kid: DAR.kid, x: DAR.x, classes: ["TEST", "DEMO"] },
  ];
}

/** Hiç etkinleşmemiş kurulum (temiz LICENSE_DIR, DB izi yok); `dir` verilirse aynı depo. */
function kurulum(g: { kilit?: boolean; dir?: string; vendorUrl?: string | null } = {}): string {
  __resetLicenseRuntimeForTests();
  const dir = g.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "gecici-kod-"));
  if (!g.dir) dizinler.push(dir);
  const store = loadLicenseStoreSync({ dir });
  if (!store.key) throw new Error("kurulum anahtarı üretilemedi");
  configureLicenseRuntimeForTests({ roots: kokler(), vendorUrl: g.vendorUrl ?? null });
  setLicenseDbFacts({ installationId: randomUUID(), firstOpenMs: Date.now() - 3 * DAY_MS, ledgerHighWaterMs: null });
  const f = fiksturKur(Date.now());
  setMeasuredFingerprint({ digest: f.parmakIzi, measured: { f1: true, f2: true, f3: true, f4: true, f5: true }, measuredAt: new Date().toISOString() });
  setLicenseTraceRow(null);
  setActivationLockForTests(g.kilit ?? true);
  invalidateLicenseSnapshot();
  return dir;
}

/** Satıcının yapacağı: istek koduna kökle imzalı açılış kodu (`gun` = bugünden kaç gün sonra biter; negatif = geçmiş). */
function kodBas(istekGosterim: string, gun: number, g: { imzalayan?: TestAnahtari; kid?: string } = {}): string {
  const doc = { v: 1 as const, istekKodu: normalizeTempText(istekGosterim, "TI"), kodId: sayac.kodId++, bitisGunu: dayOfMs(Date.now()) + gun };
  const kid = g.kid ?? KOK.kid;
  const input = tempOpeningSigningInput(doc, kid);
  const imza = sign(null, Buffer.from(input, "ascii"), (g.imzalayan ?? KOK).privateKey);
  return formatTempOpeningCode(encodeTempOpeningCode(`${input}.${b64uEncode(imza)}`, doc, kid));
}

const snap = (nowMs?: number): LicenseSnapshot => getLicenseSnapshot(nowMs);
const kademe = (s: LicenseSnapshot): string => `${s.state.kip}/${s.state.uygulananKademe}`;
const neden = (s: LicenseSnapshot, kod: string): boolean => s.state.nedenler.some((n) => n.kod === kod);

function ret(fn: () => unknown): { status: number; code: unknown; neden: unknown; konum: unknown; mesaj: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; message?: string; details?: Record<string, unknown> };
    return { status: err.statusCode ?? 0, code: err.details?.code, neden: err.details?.neden, konum: err.details?.konum, mesaj: err.message ?? "" };
  }
}

async function kapi(m: string, yol: string, token: string): Promise<{ rotaya: boolean; kod: unknown }> {
  const s = await kapidanGecir(licenseGate, { m, desen: yol, ornek: yol }, token);
  const d = (s.hata as { details?: Record<string, unknown> } | undefined)?.details ?? null;
  return { rotaya: s.hata === undefined, kod: d?.code };
}

// ── §1 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function istekKodu(): void {
  console.log("\n§1 — istek kodu");
  const dir = kurulum();
  const a = getTempRequest();
  const b = getTempRequest();
  check("§1a biçim TI-XXXX ×6", /^TI(-[0-9A-Z]{4}){6}$/.test(a.istekKodu), a.istekKodu);
  check("§1b ⭐ tekrar okumada AYNI (telefonda okunan kod kaybolmaz)", a.istekKodu === b.istekKodu);
  check("§1c LICENSE_DIR'de bekleyen ek", fs.existsSync(path.join(dir, TEMP_FILES.REQUEST)));
  const c = renewTempRequestCode(null);
  check("§1d yenileyince farklı", c.istekKodu !== a.istekKodu);
  const eski = kodBas(a.istekKodu, 30);
  check("§1e eski isteğe verilen kod yenilemeden sonra IMZA ile düşer", ret(() => acceptTempCode(eski, null))?.neden === "IMZA");
}

// ── §2 ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function gecerliKod(token: string): Promise<void> {
  console.log("\n§2 — geçerli kod → geçici etkin");
  kurulum();
  const s0 = snap();
  check("§2a ön koşul: kilit ETKINLESMEDI, iş ucu kapalı", s0.etkinlestirmeKilidi.sinif === "ETKINLESMEDI" && !(await kapi("POST", "/api/orders", token)).rotaya);
  const istek = getTempRequest().istekKodu;
  // Telefonla okunurken küçük harf, boşluk, O/I karışıklığı: düzeltilir.
  const kod = kodBas(istek, 30).toLowerCase().replace(/-/g, " ");
  const v = acceptTempCode(kod, null);
  const s = snap();
  check("§2b ⭐ kilit sınıfı YOK, neden GECICI", s.etkinlestirmeKilidi.sinif === "YOK" && s.etkinlestirmeKilidi.neden === "GECICI", JSON.stringify(s.etkinlestirmeKilidi));
  check("§2c ⭐ kip zorla, kısıtlı değil, bitiş ≈ +30 g", s.state.kip === "zorla" && s.state.uygulananKademe !== "KISITLI" && v.gecici !== null && v.gecici.kalanGun >= 30 && v.gecici.kalanGun <= 31, `${kademe(s)} ${JSON.stringify(v.gecici)}`);
  check("§2d ⭐ iş ucu açık (POST /api/orders rotaya)", (await kapi("POST", "/api/orders", token)).rotaya);
  check("§2e istek kodu tüketildi → yenilendi", v.istekKodu !== istek);
  check("§2f geçici etkin kurulum etkin SAYILMAZ (tam etkinleştirme açık kalır)", !s.activated && s.licenseId === null);
  // Panelin geçici bandı durum özetinden okur: istek kodu ucuyla AYNI görünüm.
  const durum = getLicenseStatus(true);
  check("§2g ⭐ GET /durum `gecici` = uçtaki görünüm (bitiş, kalan gün, son 4)", durum.ayrinti && JSON.stringify(durum.gecici) === JSON.stringify(v.gecici), JSON.stringify(durum.ayrinti ? durum.gecici : null));
}

// ── §3 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function retler(): void {
  console.log("\n§3 — retler");
  kurulum();
  const istek = getTempRequest().istekKodu;
  const r1 = ret(() => acceptTempCode(kodBas(istek, 30, { imzalayan: SAHTE }), null));
  check("§3a ⭐ yanlış imza → 400 TEMP_CODE_INVALID/IMZA", r1?.status === 400 && r1.code === "TEMP_CODE_INVALID" && r1.neden === "IMZA", JSON.stringify(r1));
  const baskaDir = kurulum();
  const baskaIstek = getTempRequest().istekKodu;
  const baskaKod = kodBas(baskaIstek, 30);
  kurulum({ dir: dizinler[dizinler.length - 2] });
  check("§3b ⭐ başka kurulumun koduyla → IMZA (istek kodu imzanın parçası)", ret(() => acceptTempCode(baskaKod, null))?.neden === "IMZA" && baskaDir !== "");
  const r3 = ret(() => acceptTempCode(kodBas(istek, -1), null));
  check("§3c ⭐ süresi geçmiş → SURESI_GECMIS", r3?.neden === "SURESI_GECMIS", JSON.stringify(r3));
  const kod = kodBas(istek, 20);
  // Sağlama karakterinin kendisi değişir: veri karakterini değiştirmek 1/32 olasılıkla sağlamayı yine tutturur.
  const bozuk = kod.slice(0, -1) + (kod.endsWith("A") ? "B" : "A");
  check("§3d yazım hatası → SAGLAMA", ret(() => acceptTempCode(bozuk, null))?.neden === "SAGLAMA");
  const harf = kod.slice(0, 9) + "U" + kod.slice(10);
  const r5 = ret(() => acceptTempCode(harf, null));
  check("§3e yanlış karakter → KARAKTER + konum + grup/karakter metni", r5?.neden === "KARAKTER" && typeof r5.konum === "number" && /grup/.test(r5.mesaj), JSON.stringify(r5));
  check("§3f dar kök (TEST/DEMO) geçici kod imzalayamaz → IMZACI", ret(() => acceptTempCode(kodBas(istek, 30, { imzalayan: DAR, kid: DAR.kid }), null))?.neden === "IMZACI");
  acceptTempCode(kod, null);
  const r7 = ret(() => acceptTempCode(kod, null));
  check("§3g ⭐ tekrar kullanım → TEKRAR", r7?.neden === "TEKRAR", JSON.stringify(r7));
  // Saat geri alınarak süresi geçmiş kod canlandırılamaz: kontrol güvenilir saatle (yüksek su) yapılır.
  setLicenseDbFacts({ ledgerHighWaterMs: Date.now() + 5 * DAY_MS });
  const yeni = getTempRequest().istekKodu;
  const r8 = ret(() => acceptTempCode(kodBas(yeni, 2), null));
  check("§3h saat geri: yüksek su bitişten sonraysa SURESI_GECMIS", r8?.neden === "SURESI_GECMIS", JSON.stringify(r8));
}

// ── §4 ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function merdiven(token: string): Promise<void> {
  console.log("\n§4 — süre sonu merdiveni (sahte saat)");
  kurulum();
  acceptTempCode(kodBas(getTempRequest().istekKodu, 20), null);
  const t = snap().gecici;
  if (!t) {
    check("§4 ön koşul: geçici etkin", false);
    return;
  }
  const e = t.endMs;
  const s10 = snap(e - 10 * DAY_MS);
  check("§4a bitişe 10 g: uyarı bandı yok", !neden(s10, "GECICI_KOD_BITIYOR") && s10.state.uygulananKademe !== "EK_SURE", kademe(s10));
  const s3 = snap(e - 3 * DAY_MS);
  check("§4b ⭐ bitişe 3 g: GECICI_KOD_BITIYOR UYARI + bant", kademe(s3) === "zorla/UYARI" && neden(s3, "GECICI_KOD_BITIYOR") && Boolean(s3.state.uygulanan.bant), `${kademe(s3)} ${JSON.stringify(s3.state.nedenler)}`);
  const s1 = snap(e + DAY_MS);
  check("§4c ⭐ bitiş+1 g: EK_SURE (GECICI_KOD_BITTI), ~29 g kaldı", kademe(s1) === "zorla/EK_SURE" && neden(s1, "GECICI_KOD_BITTI") && s1.state.ekSureKalanGun === 29, `${kademe(s1)} kalan=${s1.state.ekSureKalanGun}`);
  const s31 = snap(e + 31 * DAY_MS);
  check("§4d ⭐ bitiş+31 g: KISITLI", kademe(s31) === "zorla/KISITLI", kademe(s31));
  check("§4e KISITLI'da da kilit YOK (veri erişimi kademeden)", s31.etkinlestirmeKilidi.sinif === "YOK");
  // Kapı gerçek saatle okur: bitişi 40 gün önce olan imzalı kayıt doğrudan yazılır (kabul ucu süresi geçmişi reddeder).
  kurulum();
  const istek = getTempRequest().istekKodu;
  const c = checkTempCode(kodBas(istek, 5), { roots: kokler(), nowMs: Date.now() });
  if (!c.ok) {
    check("§4f ön koşul: kod denetimi", false, c.neden);
    return;
  }
  const gecmis = checkTempCode(kodBas(istek, -40), { roots: kokler(), nowMs: Date.now() - 60 * DAY_MS });
  if (!gecmis.ok) {
    check("§4f ön koşul: geçmiş kod denetimi (geçmiş saatle)", false, gecmis.neden);
    return;
  }
  storeTempOpening(gecmis.value);
  invalidateLicenseSnapshot();
  check("§4f ön koşul: bitişi 40 g önce → KISITLI", kademe(snap()) === "zorla/KISITLI", kademe(snap()));
  for (const [m, yol] of [["GET", "/api/orders"], ["POST", "/api/admin/backup"]] as const) {
    check(`§4g ⭐ açık — ${m} ${yol}`, (await kapi(m, yol, token)).rotaya);
  }
  const y = await kapi("POST", "/api/orders", token);
  check("§4h ⭐ yazma → 403 LICENSE_RESTRICTED", !y.rotaya && y.kod === "LICENSE_RESTRICTED", JSON.stringify(y));
}

// ── §5 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function kopyaVeKurcalama(): void {
  console.log("\n§5 — kopyalanan / kurcalanan açılış dosyası");
  const a = kurulum();
  acceptTempCode(kodBas(getTempRequest().istekKodu, 30), null);
  check("§5a ön koşul: A geçici etkin", snap().gecici !== null);
  const dosya = fs.readFileSync(path.join(a, TEMP_FILES.OPENING), "utf8");
  const b = kurulum();
  fs.writeFileSync(path.join(b, TEMP_FILES.OPENING), dosya);
  invalidateLicenseSnapshot();
  const sb = snap();
  check("§5b ⭐ dosya başka kurulum anahtarında geçmez (kilit ETKINLESMEDI)", sb.gecici === null && sb.etkinlestirmeKilidi.sinif === "ETKINLESMEDI", JSON.stringify(sb.etkinlestirmeKilidi));
  const kayit = JSON.parse(dosya) as { bitisGunu: number };
  kayit.bitisGunu += 365;
  fs.writeFileSync(path.join(a, TEMP_FILES.OPENING), JSON.stringify(kayit));
  kurulum({ dir: a });
  check("§5c ⭐ bitişi ileri alınmış kayıt imzadan düşer", snap().gecici === null && snap().etkinlestirmeKilidi.sinif === "ETKINLESMEDI");
}

// ── §6 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function tamEtkinlestirme(): void {
  console.log("\n§6 — tam etkinleştirme geçici kaydı kapatır");
  const dir = kurulum();
  acceptTempCode(kodBas(getTempRequest().istekKodu, 30), null);
  closeTempOnActivation(null);
  const k = JSON.parse(fs.readFileSync(path.join(dir, TEMP_FILES.OPENING), "utf8")) as { kapandi: string | null; kapanisNedeni: string | null };
  invalidateLicenseSnapshot();
  check("§6a ⭐ kapanış anı + neden yazıldı, dosya silinmedi", k.kapandi !== null && k.kapanisNedeni === "TAM_ETKINLESTIRME");
  check("§6b kapanan kayıt geçici etkinlik vermez", snap().gecici === null);
  const src = fs.readFileSync(path.join(__dirname, "../src/services/license-sync.service.ts"), "utf8");
  const blok = /if \(firstActivation\) closeTempOnActivation\(g\.userId\);/.test(src);
  check("§6c ⭐ kira kabulü (karekod · internet · dosya · taşıma) ilk etkinleşmede kapatır", blok);
  const rt = fs.readFileSync(path.join(__dirname, "../src/lib/license/snapshot-parts.ts"), "utf8");
  check("§6d etkin kurulumda geçici okunmaz (`activated ? null`)", /const temp = activated \? null : activeTempOpening/.test(rt));
}

// ── §7 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function ayakIzi(kayitlar: unknown[]): void {
  console.log("\n§7 — ayak izinde düz kod yok");
  kurulum();
  kayitlar.length = 0;
  const kod = kodBas(getTempRequest().istekKodu, 30);
  ret(() => acceptTempCode(kod.slice(0, 20) + "0" + kod.slice(21), null));
  acceptTempCode(kod, null);
  const govde = normalizeTempText(kod, "TG");
  const metin = JSON.stringify(kayitlar);
  check("§7a iki satır (ret + kabul) yazıldı", kayitlar.length >= 2, String(kayitlar.length));
  check("§7b ⭐ düz kod (ya da 12+ karakterlik parçası) yok", !metin.includes(govde.slice(0, 12)) && !metin.includes(govde.slice(40, 52)) && !metin.includes(govde.slice(-12)));
  check("§7c kabul satırı son 4 + bitiş taşır", metin.includes(`"kodSonu":"${govde.slice(-4)}"`) && /"bitis":"\d{4}-/.test(metin));
}

// ── §8 ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function bildirim(): Promise<void> {
  console.log("\n§8 — tüketim bildirimi kuyruğu");
  const dir = kurulum({ vendorUrl: "http://satici.test" });
  const giden: Array<{ url: string; body: string }> = [];
  let ag = false;
  const tasiyici: VendorTransport = async (req) => {
    giden.push({ url: req.url, body: String(req.body) });
    if (!ag) throw new Error("ağ yok");
    return { status: 200, body: JSON.stringify({ v: 1, tanindi: 1, yeni: 1 }), headers: {} } as Awaited<ReturnType<VendorTransport>>;
  };
  acceptTempCode(kodBas(getTempRequest().istekKodu, 30), null);
  await new Promise((r) => setTimeout(r, 50));
  const n0 = await flushTempConsumption(tasiyici);
  const t0 = JSON.parse(fs.readFileSync(path.join(dir, TEMP_FILES.CONSUMED), "utf8")) as { kayitlar: Array<{ bildirildi: string | null; ozet: string }> };
  check("§8a ağ yok → kuyrukta kalır (bildirildi null)", n0 === 0 && t0.kayitlar.every((r) => r.bildirildi === null));
  ag = true;
  const n1 = await flushTempConsumption(tasiyici);
  const t1 = JSON.parse(fs.readFileSync(path.join(dir, TEMP_FILES.CONSUMED), "utf8")) as { kayitlar: Array<{ bildirildi: string | null; ozet: string }> };
  const son = giden[giden.length - 1];
  check("§8b ⭐ ağ gelince iletildi, işaretlendi", n1 === 1 && t1.kayitlar.every((r) => r.bildirildi !== null), `n1=${n1}`);
  check("§8c uç /v1/gecici-kod/tuketildi, gövdede yalnız özet", son.url.endsWith("/v1/gecici-kod/tuketildi") && son.body.includes(t1.kayitlar[0].ozet) && !/TG-/.test(son.body));
  const n2 = await flushTempConsumption(tasiyici);
  check("§8d bildirilmiş özet yeniden gönderilmez", n2 === 0);
}

// ── §9 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function kilitKapali(): void {
  console.log("\n§9 — kilit kapalı derleme → sıfır fark");
  kurulum({ kilit: false });
  acceptTempCode(kodBas(getTempRequest().istekKodu, 2), null);
  const s = snap(Date.now() + 60 * DAY_MS);
  check("§9a kip gözlem, NORMAL, kilit YOK/KAPALI", kademe(s) === "gozlem/NORMAL" && s.etkinlestirmeKilidi.neden === "KAPALI", `${kademe(s)} ${JSON.stringify(s.etkinlestirmeKilidi)}`);
}

// ── §10 negatif sonda ─────────────────────────────────────────────────────────────────────────────────────
function negatifSonda(): void {
  console.log("\n§10 — negatif sonda");
  const now = Date.now();
  const girdi: LicenseStateInput = {
    kurulumId: null,
    kurulumAnahtarKimligi: null,
    hak: { status: "YOK" },
    kira: { status: "YOK" },
    saat: { duvarMs: now, yuksekSuMs: 0, monotonik: null, durumDosyasiGecerli: false, kapaliKrediMs: 0 },
    parmakIziEslesme: "OLCULEMEDI",
    butunluk: "KAPSAM_DISI",
    derlemeTarihiMs: null,
    ilkAcilisMs: now - DAY_MS,
    varsayilanKip: "gozlem",
    sonKiraZorlamasi: null,
    sonYaptirim: null,
    geciciAcilis: { bitisMs: now - 31 * DAY_MS },
  };
  const olcu = (h: (g: LicenseStateInput) => LicenseState): boolean => {
    const s = h(girdi);
    return s.kip === "zorla" && s.uygulananKademe === "KISITLI";
  };
  check("§10a sonda ön koşulu: gerçek hesaplayıcı ölçüyü geçer", olcu(computeLicenseState));
  check("§10b ⭐ `geciciAcilis`i düşüren hesaplayıcı §4 ölçüsüne takılır", !olcu((g) => computeLicenseState({ ...g, geciciAcilis: null })));
  const kilitGirdisi: ActivationLockInput = { enabled: true, setupError: false, ready: true, activated: false, exempt: false, temp: true, trace: "YOK" };
  const kilitOlcu = (f: (i: ActivationLockInput) => { sinif: string; neden: string }): boolean => {
    const d = f(kilitGirdisi);
    return d.sinif === "YOK" && d.neden === "GECICI";
  };
  check("§10c sonda ön koşulu: gerçek sınıflayıcı GECICI verir", kilitOlcu(classifyActivationLock));
  check("§10d ⭐ `temp`i yok sayan sınıflayıcı §2 ölçüsüne takılır", !kilitOlcu((i) => classifyActivationLock({ ...i, temp: false })));
}

async function main(): Promise<void> {
  console.log("=== Yazarak etkinleştirme — geçici açılış kodu (fabrika) ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const kayitlar: unknown[] = [];
  AuditService.log = async () => undefined;
  AuditService.logEvent = async (e: unknown) => {
    kayitlar.push(e);
    return undefined as never;
  };
  const ad = `TEST-gecici-kod-${Date.now()}`;
  const u = await prisma.user.create({ data: { username: ad, passwordHash: await AuthService.hashPassword("Deneme-12345"), fullName: "TEST Geçici Kod" }, select: { id: true } });
  try {
    const { token } = await AuthService.login(ad, "Deneme-12345");
    istekKodu();
    await gecerliKod(token);
    retler();
    await merdiven(token);
    kopyaVeKurcalama();
    tamEtkinlestirme();
    ayakIzi(kayitlar);
    await bildirim();
    kilitKapali();
    negatifSonda();
  } finally {
    await prisma.session.deleteMany({ where: { userId: u.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: u.id } }).catch(() => undefined);
    setActivationLockForTests(null);
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
