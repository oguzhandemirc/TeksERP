// =============================================================================
// BEKÇİ — HATA RAPORLARI (plan 3.6), fabrika tarafı
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts hata_raporu_fabrika   (kendi _test DB'si)
//
// NE ÖLÇER: ① varsayılan KAPALI — onay yoksa hiçbir hata toplanmaz, kuyruğa yazılmaz, satıcıya istek GİTMEZ
// (5xx ara katmanı ve istemci ucu dahil) · ② arındırıcı: mesaj metni, UUID'li yol, kullanıcı dizini
// (`C:\Users\…`, `/home/…`, `/Users/…`), sorgu dizesi rapora girmez · ③ giden gövde KATI protokol şemasına
// uyar, allowlist dışı anahtar taşımaz, istek kurulum imzalı (amaç `hata-raporu`) · ④ başarısız gönderim aynı
// `partiId` ile yeniden denenir · ⑤ onay geri alınınca bekleyen silinir, istek gitmez · ⑥ bellek/kuyruk tavanı
// fazlayı yalnız SAYAR · ⑦ budama · ⑧ istemci ucu KATI (tanınmayan anahtar 400), hız sınırı, ham ayar ucu
// onay anahtarını reddeder · ⑨ 5xx (503 hariç) kaydı uç ŞABLONUYLA; 4xx kaydedilmez.
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı): H1 `recordError`ün onay kapısı kaldırıldı → §1g ❌ ·
//   H1b boşaltma + gönderim kapıları da kaldırıldı → §1b/§1d ❌ ·
//   H2 `toStackFrames` ham satırları döndürdü / `toRouteTemplate` yolu olduğu gibi bıraktı → §2 ❌.
// =============================================================================
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { createPublicKey, randomUUID } from "node:crypto";
import express, { Router } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { loadLicenseStoreSync } from "../src/lib/license/store";
import { configureLicenseRuntimeForTests, setLicenseDbFacts, setMeasuredFingerprint } from "../src/lib/license/runtime";
import { ErrorReportRequestSchema, REQUEST_HEADER, verifyRequest, type Fingerprint } from "../src/lib/license/protocol";
import { acceptLicenseResponse } from "../src/services/license-sync.service";
import type { VendorTransport } from "../src/services/helpers/license-wire.helper";
import {
  ERROR_BUFFER_MAX_GROUPS,
  ERROR_QUEUE_MAX_GROUPS,
  ERROR_REPORT_CONSENT_KEY,
  ERROR_SENT_KEEP_DAYS,
  ERROR_UNSENT_KEEP_DAYS,
  buildErrorReportEntry,
  flushErrorReports,
  loadErrorReportConsent,
  pruneErrorReports,
  recordError,
  recordServerError,
  resetErrorReportStateForTest,
  sendErrorReports,
  setErrorReportConsent,
} from "../src/services/error-report.service";
import { CLIENT_ERROR_PER_MINUTE, resetClientErrorRateForTest } from "../src/routes/error-report.routes";
import { errorHandler } from "../src/middlewares/error.middleware";
import { AppError } from "../src/utils/app-error";
import { isOpenInTier } from "../src/constants/license-routes";
import { isReservedSettingKey, SETTINGS_PASSWORD_HASH_KEY } from "../src/constants/reserved-settings";
import app from "../src/app";
import { fiksturKur, hakBas, kiraBas, type Fikstur } from "./lib/lisans-fikstur";
import { ensureTestAdmin } from "./fixture-test-user";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

AuditService.logEvent = async () => undefined;
AuditService.log = async () => undefined;
const KOK = fs.mkdtempSync(path.join(os.tmpdir(), "hata-raporu-"));
const BASLANGIC = new Date(Date.now() - 1000);
const GIZLI = "gizli-musteri-ahmet-yilmaz";
const UUID_ORNEK = "3f2b8c1e-9d4a-4e6b-8a1c-2f5e7d9b0a13";
const ISO_ORNEK = new Date().toISOString();

interface Gonderim {
  readonly baslik: string;
  readonly govde: string;
}

/** Sahte satıcı: gövdeyi + imzalı başlığı kaydeder; `bozuk` ise ağ hatası taklidi. */
function sahteSatici(kayit: Gonderim[], g: { bozuk?: boolean } = {}): VendorTransport {
  return async (req) => {
    kayit.push({ baslik: req.headers[REQUEST_HEADER] ?? "", govde: req.body ?? "" });
    if (g.bozuk) throw new Error("ağ yok");
    const b = JSON.parse(req.body ?? "{}") as { partiId: string; kayitlar: unknown[] };
    return { status: 200, body: JSON.stringify({ v: 1, partiId: b.partiId, kabul: b.kayitlar.length }) };
  };
}

async function kur(): Promise<Fikstur> {
  const key = loadLicenseStoreSync({ dir: path.join(KOK, "lisans") }).key;
  if (!key) throw new Error("depo anahtarı yok");
  const f0 = fiksturKur(Date.now());
  const f: Fikstur = { ...f0, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: "https://satici.test" });
  setLicenseDbFacts({ installationId: randomUUID(), firstOpenMs: Date.now() - 86_400_000, ledgerHighWaterMs: null });
  setMeasuredFingerprint({ digest: f.parmakIzi as Fingerprint, measured: { f1: true, f2: true, f3: true, f4: true, f5: true }, measuredAt: new Date().toISOString() });
  await acceptLicenseResponse({ v: 1, hak: hakBas(f), kira: kiraBas(f, { zorlama: false }), indirmeBelirtecleri: [], sunucuSaati: new Date().toISOString(), kurulumId: f.kurulumId }, "cevrimdisi", "TASINMIS");
  return f;
}

/** Ham, kirli bir hata — arındırıcının atması gereken her şeyi taşır. */
function kirliHata(): Error {
  const e = new TypeError(`${GIZLI} için ${UUID_ORNEK} kaydı okunamadı`);
  e.stack = [
    `TypeError: ${GIZLI} için kayıt okunamadı`,
    "    at rollService.find (C:\\Users\\ahmet\\TeksERP\\src\\services\\roll.service.ts:42:7)",
    "    at handler (/home/mehmet/app/dist/routes/roll.routes.js:10:3)",
    "    at Object.<anonymous> (/Users/zeynep/proje/node_modules/express/lib/router.js:5:1)",
    "    at http://192.168.1.20:5174/assets/index-abc.js?token=xyz:100:20",
  ].join("\n");
  return e;
}

const SIZMAMALI = [GIZLI, UUID_ORNEK, "ahmet", "mehmet", "zeynep", "Users", "home", "192.168", "token=", "xyz", "kayıt okunamadı"];

function sizinti(metin: string): string[] {
  return SIZMAMALI.filter((s) => metin.includes(s));
}

async function kuyruk() {
  return prisma.errorReportEntry.findMany({ where: { createdAt: { gte: BASLANGIC } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

async function main(): Promise<void> {
  const onayFoto = await prisma.systemSetting.findUnique({ where: { key: ERROR_REPORT_CONSENT_KEY } });
  const server = app.listen(0, "127.0.0.1");
  const mini = express();
  const miniServer = mini.listen(0, "127.0.0.1");
  try {
    const f = await kur();
    const admin = await ensureTestAdmin();
    await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())));
    await new Promise<void>((r) => (miniServer.listening ? r() : miniServer.once("listening", () => r())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (method: string, p: string, token: string | null, body?: unknown, ek: Record<string, string> = {}) => {
      const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", ...ek, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      let parsed: { data?: Record<string, unknown>; error?: { details?: { code?: string } }; details?: { code?: string } } = {};
      try {
        parsed = (await r.json()) as typeof parsed;
      } catch {
        /* boş gövde */
      }
      return { status: r.status, body: parsed };
    };
    const giris = await call("POST", "/api/auth/login", null, { username: admin.username, password: admin.password });
    const tok = (giris.body.data as { token?: string } | undefined)?.token ?? null;
    if (!tok) throw new Error(`giriş başarısız (${giris.status})`);

    // 5xx ara katmanı için küçük uygulama: iç içe yönlendirici (önek geri sarma durumu) + hata ara katmanı.
    const r = Router();
    r.get("/:id/patla", () => {
      throw kirliHata();
    });
    r.get("/:id/istemci-hatasi", () => {
      throw AppError.badRequest(`${GIZLI} geçersiz`);
    });
    r.get("/:id/mesgul", () => {
      throw new AppError("meşgul", 503);
    });
    mini.use("/api/deneme-kayit", r);
    mini.use(errorHandler);
    const miniBase = `http://127.0.0.1:${(miniServer.address() as AddressInfo).port}`;
    const miniCagir = async (p: string) => (await fetch(`${miniBase}${p}`)).status;

    // ── §1 varsayılan KAPALI ────────────────────────────────────────────────
    console.log("§1 onay yoksa hiçbir şey toplanmaz / gönderilmez");
    await prisma.systemSetting.deleteMany({ where: { key: ERROR_REPORT_CONSENT_KEY } });
    resetErrorReportStateForTest();
    resetClientErrorRateForTest();
    check("§1a ⭐ onay satırı yok → kapalı", (await loadErrorReportConsent()) === false);
    recordServerError(kirliHata(), { route: "/api/rolls/:id" });
    recordError({ source: "panel", code: "X", stack: kirliHata().stack });
    const s1 = await miniCagir(`/api/deneme-kayit/${UUID_ORNEK}/patla`);
    const i1 = await call("POST", "/api/hata-raporlari/istemci", tok, { kaynak: "panel", sinif: "TypeError", yigin: kirliHata().stack });
    await new Promise((res) => setTimeout(res, 50));
    await flushErrorReports();
    const g1: Gonderim[] = [];
    const o1 = await sendErrorReports(sahteSatici(g1));
    check("§1b ⭐ onaysız: 5xx + süreç + istemci hatası kuyruğa HİÇ satır yazmaz", s1 === 500 && (await kuyruk()).length === 0, `durum ${s1}, satır ${(await kuyruk()).length}`);
    check("§1c ⭐ onaysız: istemci ucu alindi=false", i1.status === 200 && i1.body.data?.["alindi"] === false, JSON.stringify(i1.body.data));
    check("§1d ⭐ onaysız: gönderim ONAY_YOK ve satıcıya istek YOK", o1 === "ONAY_YOK" && g1.length === 0, `${o1} · ${g1.length}`);
    await prisma.systemSetting.create({ data: { key: ERROR_REPORT_CONSENT_KEY, value: { enabled: false } } });
    check("§1e onay satırı `enabled:false` → kapalı", (await loadErrorReportConsent()) === false && (await sendErrorReports(sahteSatici(g1))) === "ONAY_YOK" && g1.length === 0);
    await prisma.systemSetting.update({ where: { key: ERROR_REPORT_CONSENT_KEY }, data: { value: "true" } });
    check("§1f biçimsiz onay değeri (düz \"true\") → kapalı (fail-closed)", (await loadErrorReportConsent()) === false);
    recordServerError(kirliHata(), { route: "/api/rolls/:id" });
    await miniCagir(`/api/deneme-kayit/${UUID_ORNEK}/patla`);
    await new Promise((res) => setTimeout(res, 50));
    await setErrorReportConsent(true, admin.id);
    await flushErrorReports();
    check("§1g ⭐ onaysızken görülen hata bellekte de TUTULMAZ (onay sonradan verilince geçmiş gitmez)", (await kuyruk()).length === 0, `satır ${(await kuyruk()).length}`);
    await setErrorReportConsent(false, admin.id);

    // ── §2 arındırıcı ───────────────────────────────────────────────────────
    console.log("\n§2 arındırıcı: mesaj, kimlik, kullanıcı dizini, sorgu girmez");
    const e2 = buildErrorReportEntry({ source: "sunucu", code: "P2025", errorClass: "TypeError", route: `/api/rolls/${UUID_ORNEK}/print?musteri=${GIZLI}`, stack: kirliHata().stack });
    const e2Metin = JSON.stringify(e2);
    check("§2a ⭐ kayıt doğar, sızıntı yok", e2 !== null && sizinti(e2Metin).length === 0, sizinti(e2Metin).join(", "));
    check("§2b ⭐ yol ŞABLONA iner (UUID → :p, sorgu atılır)", e2?.yol === "/api/rolls/:p/print", String(e2?.yol));
    check("§2c ⭐ yığın yalnız GÖRELİ dosya:satır", (e2?.yigin.length ?? 0) > 0 && (e2?.yigin ?? []).every((x) => /^[A-Za-z0-9_@.\-/]+:\d+$/.test(x) && !x.startsWith("/")), (e2?.yigin ?? []).join(" | "));
    check("§2d serbest metinli kod/sınıf sabit etikete düşer", buildErrorReportEntry({ source: "panel", code: `${GIZLI} kod`, errorClass: `${GIZLI} sinif` })?.kod === "UNHANDLED" && buildErrorReportEntry({ source: "panel", errorClass: "a b c" })?.sinif === "Error");
    check("§2e harf-tire görünümlü olmayan her yol parçası :p (kod/barkod)", buildErrorReportEntry({ source: "panel", route: "/sevkiyat/TEKS-00012/42" })?.yol === "/sevkiyat/:p/:p");

    // ── §3 onaylı akış + gövde + imza ───────────────────────────────────────
    console.log("\n§3 onaylı: kuyruk → imzalı, allowlist gövde");
    await setErrorReportConsent(true, admin.id);
    const onayGoruntu = await prisma.systemSetting.findUniqueOrThrow({ where: { key: ERROR_REPORT_CONSENT_KEY } });
    check("§3a onay kim/ne zaman ile yazılır", onayGoruntu.updatedById === admin.id && (await loadErrorReportConsent()) === true);
    const s3 = await miniCagir(`/api/deneme-kayit/${UUID_ORNEK}/patla`);
    const s3b = await miniCagir(`/api/deneme-kayit/${UUID_ORNEK}/istemci-hatasi`);
    const s3c = await miniCagir(`/api/deneme-kayit/${UUID_ORNEK}/mesgul`);
    recordServerError(kirliHata(), { component: "surec", code: "UNHANDLED_REJECTION" });
    await new Promise((res) => setTimeout(res, 50));
    await flushErrorReports();
    const k3 = await kuyruk();
    const sunucu5xx = k3.find((x) => x.component !== "surec");
    check("§3b ⭐ 5xx kaydı uç ŞABLONUYLA (önek geri sarılsa da)", s3 === 500 && sunucu5xx?.routeTemplate === "/api/deneme-kayit/:id/patla" && sunucu5xx.component === "deneme-kayit", `${sunucu5xx?.routeTemplate} ${sunucu5xx?.component}`);
    check("§3c ⭐ 4xx ve 503 kaydedilmez", s3b === 400 && s3c === 503 && k3.length === 2, `satır ${k3.length}`);
    check("§3d süreç hatası bileşen `surec`, kod UNHANDLED_REJECTION", k3.some((x) => x.component === "surec" && x.code === "UNHANDLED_REJECTION"));
    check("§3e ⭐ kuyruk satırında sızıntı yok", sizinti(JSON.stringify(k3)).length === 0, sizinti(JSON.stringify(k3)).join(", "));
    const g3: Gonderim[] = [];
    const o3 = await sendErrorReports(sahteSatici(g3));
    const govde3 = JSON.parse(g3[0]?.govde ?? "{}") as Record<string, unknown>;
    const p3 = ErrorReportRequestSchema.safeParse(govde3);
    check("§3f ⭐ GONDERILDI, tek istek, gövde KATI protokol şemasından geçer", o3 === "GONDERILDI" && g3.length === 1 && p3.success, `${o3} · ${g3.length}`);
    const IZINLI = new Set(["kaynak", "surum", "kod", "sinif", "bilesen", "yol", "yigin", "ilk", "son", "sayi"]);
    const disari = p3.success ? p3.data.kayitlar.flatMap((k) => Object.keys(k).filter((a) => !IZINLI.has(a))) : ["?"];
    check("§3g ⭐ kayıtlarda allowlist dışı anahtar YOK; gövde üst anahtarları v/partiId/kayitlar/dusurulen", disari.length === 0 && Object.keys(govde3).sort().join(",") === "dusurulen,kayitlar,partiId,v", disari.join(","));
    check("§3h ⭐ giden gövdede sızıntı yok", sizinti(g3[0]?.govde ?? "").length === 0, sizinti(g3[0]?.govde ?? "").join(", "));
    const imza = verifyRequest(g3[0]?.baslik, { publicKeyX: f.kurulum.x, body: Buffer.from(g3[0]?.govde ?? ""), nowMs: Date.now(), purposes: ["hata-raporu"], installationId: f.kurulumId });
    check("§3i ⭐ istek KURULUM imzalı, amaç `hata-raporu`", imza.ok, imza.ok ? "" : imza.code);
    const imzaYokla = verifyRequest(g3[0]?.baslik, { publicKeyX: f.kurulum.x, body: Buffer.from(g3[0]?.govde ?? ""), nowMs: Date.now(), purposes: ["yokla"], installationId: f.kurulumId });
    check("§3j amaç yoklamaya karışmaz (yokla amacıyla doğrulanmaz)", !imzaYokla.ok);
    check("§3k gönderilmiş satır sentAt dolu, ikinci gönderim BOS", (await kuyruk()).every((x) => x.sentAt !== null) && (await sendErrorReports(sahteSatici(g3))) === "BOS" && g3.length === 1);

    // ── §4 yeniden deneme aynı partiId ──────────────────────────────────────
    console.log("\n§4 başarısız gönderim aynı partiId ile yeniden denenir");
    recordError({ source: "panel", code: "PANEL_X", errorClass: "RangeError", route: "/sevkiyat" });
    const g4: Gonderim[] = [];
    const o4a = await sendErrorReports(sahteSatici(g4, { bozuk: true }));
    const parti1 = (JSON.parse(g4[0]?.govde ?? "{}") as { partiId?: string }).partiId;
    const bekleyen4 = (await kuyruk()).filter((x) => x.sentAt === null);
    check("§4a ağ hatası → BEKLIYOR, satır gönderilmemiş, sayaç + hata KODU", o4a === "BEKLIYOR" && bekleyen4.length === 1 && bekleyen4[0]?.sendAttempts === 1 && (bekleyen4[0]?.lastErrorCode ?? "").length > 0, `${o4a} ${bekleyen4[0]?.lastErrorCode}`);
    recordError({ source: "panel", code: "PANEL_Y", route: "/stok" });
    const o4b = await sendErrorReports(sahteSatici(g4));
    const govde4b = JSON.parse(g4[1]?.govde ?? "{}") as { partiId?: string; kayitlar?: Array<{ kod: string }> };
    check("§4b ⭐ yeniden deneme AYNI partiId, yalnız o partinin kaydı", o4b === "GONDERILDI" && govde4b.partiId === parti1 && govde4b.kayitlar?.length === 1 && govde4b.kayitlar[0]?.kod === "PANEL_X", `${parti1} → ${govde4b.partiId}`);
    const o4c = await sendErrorReports(sahteSatici(g4));
    const govde4c = JSON.parse(g4[2]?.govde ?? "{}") as { partiId?: string; kayitlar?: Array<{ kod: string }> };
    check("§4c sonraki parti YENİ partiId ile bekleyeni götürür", o4c === "GONDERILDI" && govde4c.partiId !== parti1 && govde4c.kayitlar?.[0]?.kod === "PANEL_Y");

    // ── §5 onay geri alınınca bekleyen silinir ──────────────────────────────
    console.log("\n§5 onay geri alınınca hiçbir şey gitmez");
    recordError({ source: "tablet", code: "TABLET_Z" });
    await flushErrorReports();
    recordError({ source: "tablet", code: "TABLET_BELLEK" });
    await setErrorReportConsent(false, admin.id);
    const g5: Gonderim[] = [];
    const o5 = await sendErrorReports(sahteSatici(g5));
    await flushErrorReports();
    check("§5a ⭐ geri alma: gönderilmemiş satır + bellek silinir", (await kuyruk()).filter((x) => x.sentAt === null).length === 0);
    check("§5b ⭐ geri alma sonrası ONAY_YOK, istek YOK", o5 === "ONAY_YOK" && g5.length === 0);
    recordError({ source: "tablet", code: "TABLET_SONRA" });
    await flushErrorReports();
    check("§5c geri alma sonrası yeni hata toplanmaz", !(await kuyruk()).some((x) => x.code === "TABLET_SONRA"));

    // ── §6 tavanlar ─────────────────────────────────────────────────────────
    console.log("\n§6 tavanlar fazlayı yalnız sayar");
    await setErrorReportConsent(true, admin.id);
    for (let i = 0; i < ERROR_BUFFER_MAX_GROUPS + 5; i++) recordError({ source: "panel", code: `TAVAN_${i}` });
    const yazilan6 = await flushErrorReports();
    check("§6a ⭐ bellek tavanı: en çok ERROR_BUFFER_MAX_GROUPS grup kuyruğa", yazilan6 === ERROR_BUFFER_MAX_GROUPS, String(yazilan6));
    for (let i = 0; i < 3; i++) recordError({ source: "panel", code: "TAVAN_0" });
    await flushErrorReports();
    check("§6b aynı grup yeni satır açmaz, sayaç artar", (await kuyruk()).filter((x) => x.code === "TAVAN_0").map((x) => x.count).join(",") === "4");
    const doldur = ERROR_QUEUE_MAX_GROUPS - (await prisma.errorReportEntry.count({ where: { sentAt: null } }));
    await prisma.errorReportEntry.createMany({
      data: Array.from({ length: doldur }, (_, i) => {
        const k = `dolgu-${randomUUID()}-${i}`;
        return { pendingKey: k, groupKey: k, source: "panel", version: "1.0.0", code: "DOLGU", errorClass: "Error", component: "bilinmiyor", routeTemplate: null, stackFrames: [], count: 1, firstAt: new Date(), lastAt: new Date() };
      }),
    });
    recordError({ source: "panel", code: "KUYRUK_TASTI" });
    await flushErrorReports();
    check("§6c ⭐ kuyruk tavanı: yeni grup yazılmaz", !(await kuyruk()).some((x) => x.code === "KUYRUK_TASTI") && (await prisma.errorReportEntry.count({ where: { sentAt: null } })) === ERROR_QUEUE_MAX_GROUPS);
    const g6: Gonderim[] = [];
    await sendErrorReports(sahteSatici(g6));
    const dus6 = (JSON.parse(g6[0]?.govde ?? "{}") as { dusurulen?: number }).dusurulen ?? -1;
    check("§6d ⭐ düşürülen yalnız SAYI olarak gider (5 bellek + 1 kuyruk)", dus6 === 6, String(dus6));
    await setErrorReportConsent(false, admin.id);

    // ── §7 budama ───────────────────────────────────────────────────────────
    console.log("\n§7 budama (telemetri)");
    const simdi = Date.now();
    const eski = (gun: number) => new Date(simdi - (gun + 1) * 86_400_000);
    const yeni = (gun: number) => new Date(simdi - (gun - 1) * 86_400_000);
    const satir = (code: string, sentAt: Date | null, createdAt: Date) => {
      const k = `budama-${randomUUID()}`;
      return { pendingKey: sentAt ? null : k, groupKey: k, source: "sunucu", version: "1.0.0", code, errorClass: "Error", component: "bilinmiyor", routeTemplate: null, stackFrames: [], count: 1, firstAt: createdAt, lastAt: createdAt, sentAt, createdAt };
    };
    await prisma.errorReportEntry.createMany({
      data: [
        satir("BUDA_ESKI_GIDEN", eski(ERROR_SENT_KEEP_DAYS), new Date()),
        satir("BUDA_YENI_GIDEN", yeni(ERROR_SENT_KEEP_DAYS), new Date()),
        satir("BUDA_ESKI_BEKLEYEN", null, eski(ERROR_UNSENT_KEEP_DAYS)),
        satir("BUDA_YENI_BEKLEYEN", null, yeni(ERROR_UNSENT_KEEP_DAYS)),
      ],
    });
    await pruneErrorReports(simdi);
    const kalan7 = (await prisma.errorReportEntry.findMany({ where: { code: { startsWith: "BUDA_" } }, select: { code: true } })).map((x) => x.code).sort().join(",");
    check("§7a ⭐ 30 gün geçmiş gönderilmiş + 7 gün geçmiş bekleyen budanır, tazeler kalır", kalan7 === "BUDA_YENI_BEKLEYEN,BUDA_YENI_GIDEN", kalan7);
    await prisma.errorReportEntry.deleteMany({ where: { code: { startsWith: "BUDA_" } } });

    // ── §8 uçlar ────────────────────────────────────────────────────────────
    console.log("\n§8 uçlar: katı gövde, hız sınırı, ham ayar ucu, lisans kapısı");
    await setErrorReportConsent(true, admin.id);
    resetClientErrorRateForTest();
    const fazla = await call("POST", "/api/hata-raporlari/istemci", tok, { kaynak: "panel", mesaj: GIZLI });
    check("§8a ⭐ tanınmayan anahtar (mesaj) → 400", fazla.status === 400, String(fazla.status));
    const sunucuKaynak = await call("POST", "/api/hata-raporlari/istemci", tok, { kaynak: "sunucu" });
    check("§8b istemci `sunucu` kaynağı taklit edemez → 400", sunucuKaynak.status === 400);
    const oturumsuz = await call("POST", "/api/hata-raporlari/istemci", null, { kaynak: "panel" });
    check("§8c oturumsuz → 401", oturumsuz.status === 401, String(oturumsuz.status));
    const kabul = await call("POST", "/api/hata-raporlari/istemci", tok, { kaynak: "panel", sinif: "TypeError", bilesen: "Sevkiyat", yol: `/sevkiyat/${UUID_ORNEK}`, yigin: kirliHata().stack, surum: "1.4.0" });
    await flushErrorReports();
    const panel8 = (await kuyruk()).find((x) => x.source === "panel" && x.sentAt === null && x.version === "1.4.0");
    check("§8d ⭐ onaylı istemci kaydı alınır ve arındırılır", kabul.body.data?.["alindi"] === true && panel8?.routeTemplate === "/sevkiyat/:p" && panel8.component === "sevkiyat" && sizinti(JSON.stringify(panel8)).length === 0, JSON.stringify(panel8?.stackFrames));
    let sonAlindi = true;
    for (let i = 0; i < CLIENT_ERROR_PER_MINUTE + 1; i++) {
      const x = await call("POST", "/api/hata-raporlari/istemci", tok, { kaynak: "tablet", kod: "HIZ" });
      sonAlindi = x.body.data?.["alindi"] === true;
    }
    check("§8e ⭐ kullanıcı başına hız sınırı (fazlası alindi=false)", sonAlindi === false);
    const ham = await call("PUT", `/api/admin/settings/${ERROR_REPORT_CONSENT_KEY}`, tok, { value: "x" });
    check("§8f ⭐ ham ayar ucu onay anahtarını reddeder (SETTING_KEY_RESERVED)", ham.status === 400 && JSON.stringify(ham.body).includes("SETTING_KEY_RESERVED") && isReservedSettingKey(ERROR_REPORT_CONSENT_KEY), String(ham.status));
    const sifreVar = (await prisma.systemSetting.count({ where: { key: SETTINGS_PASSWORD_HASH_KEY } })) > 0;
    if (sifreVar) {
      const sifresiz = await call("PUT", "/api/hata-raporlari/onay", tok, { acik: false });
      check("§8g ⭐ onay ucu ayar şifresi olmadan değişmez", sifresiz.status === 403 || sifresiz.status === 401, String(sifresiz.status));
    } else {
      const strictBody = await call("PUT", "/api/hata-raporlari/onay", tok, { acik: false, kim: "x" });
      const kapat = await call("PUT", "/api/hata-raporlari/onay", tok, { acik: false });
      check("§8g ⭐ onay ucu KATI gövde (tanınmayan anahtar 400), geçerli gövde kapatır", strictBody.status === 400 && kapat.status === 200 && kapat.body.data?.["acik"] === false && (await loadErrorReportConsent()) === false, `${strictBody.status} ${kapat.status}`);
    }
    const ozet = await call("GET", "/api/hata-raporlari", tok);
    check("§8h özet ucu onay + sayılar döner", ozet.status === 200 && typeof ozet.body.data?.["bekleyen"] === "number" && typeof (ozet.body.data?.["onay"] as { acik?: unknown } | undefined)?.acik === "boolean");
    check("§8i onay ucu her kademede, istemci kaydı kısıtlı kipte açık", ["KISITLI", "DURDURULMUS"].every((k) => isOpenInTier(k as "KISITLI", "PUT", "/api/hata-raporlari/onay")) && isOpenInTier("KISITLI", "POST", "/api/hata-raporlari/istemci"));
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata — ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    resetErrorReportStateForTest();
    await prisma.errorReportEntry.deleteMany({ where: { createdAt: { gte: BASLANGIC } } }).catch(() => undefined);
    await prisma.systemSetting.deleteMany({ where: { key: ERROR_REPORT_CONSENT_KEY } }).catch(() => undefined);
    if (onayFoto) await prisma.systemSetting.create({ data: { key: onayFoto.key, value: onayFoto.value ?? {}, description: onayFoto.description, updatedById: onayFoto.updatedById } }).catch(() => undefined);
    server.close();
    miniServer.close();
    fs.rmSync(KOK, { recursive: true, force: true });
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
