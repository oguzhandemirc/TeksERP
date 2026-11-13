// =============================================================================
// BEKÇİ — PATRON BULUTU FABRİKA SEDDİ (G1; inceleme 2026-11-13 bulgu 3 · 6 · 7 · 8)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_fabrika_seddi   (kendi _test DB'si)
//
// NE ÖLÇER (gerçek servisler, sahte bulut süreç içi taşıyıcı; audit bellekte susturulur):
//   §1 ayarlar: kayıt yok → varsayılan (anahtar AÇIK = bugünkü davranış, 60/300/60); çöp değer → varsayılan;
//      yalnız açık `false` kapatır; aralık dışı/ondalık yazım 400 `PATRON_BULUT_AYAR_GECERSIZ` (Türkçe)
//   §2 ham `PUT /api/admin/settings/:key` dört anahtarı reddeder (kaynak taraması + körlük sondası)
//   §3 ⭐ anahtar kapalı → `DURDURULDU`, `al` ÇAĞRILMAZ (hesap listesi tazelenir), kayıt bulutta kalır; açınca `al`
//   §4 ⭐ saatlik tavan: `enFazla` kalanla kırpılır; dolunca `TAVAN_DOLU:SAATLIK` ve `al` yok; bulut fazla
//      verirse fazlası İŞLENMEZ · günlük tavan dolunca `TAVAN_DOLU:GUNLUK`
//   §5 ⭐ rapor kapısı: 30 sn aralık, saatlik tavan, `enFazla` kırpma; `claimAndRunReportRequests` `enFazla`yı
//      iletir ve bulutun fazlasını hesaplamaz
//   §6 ⭐ buluttan cari → tx içinde TEK `cari.patron-carisi` outbox satırı; replay ikinci satır doğurmaz;
//      ret (mükerrer ad) satır doğurmaz; yük yalnız katalog alanları
//   §7 durum özeti: seddi sayaçları + son makbuzlar (en yeni önce)
//
// NEGATİF SONDA (2026-11-13, kaynakta mutasyon, `shasum` ile birebir geri alındı; sonuç commit mesajında):
//   N1 `cloud-inbox.job.ts` anahtar kontrolü kaldırıldı ⇒ §3 kırmızı · N2 `enFazla` kalanla kırpılmadı ⇒ §4 kırmızı ·
//   N3 rapor kapısı `decide` çağrısı atlanıp tavan yok sayıldı ⇒ §5 kırmızı · N4 cari emit kaldırıldı ⇒ §6 kırmızı.
// Global ayar yazar (seddi anahtarları, `bildirim.gelenKutusuEnabled`); bulduğu değerlere `finally`de döner.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import {
  GUARD_SETTING_KEYS,
  INBOX_DAILY_MAX_DEFAULT,
  INBOX_HOURLY_MAX_DEFAULT,
  REPORT_HOURLY_MAX_DEFAULT,
  measureInboxQuota,
  readPatronCloudGuardSettings,
  updatePatronCloudGuardSettings,
} from "../src/services/patron-cloud-guard.service";
import { activatePatronCloud, getPatronCloudStatus, readPatronCloudUserId, __resetPatronCloudStateForTests } from "../src/services/patron-cloud.service";
import { processInboxMessage } from "../src/services/cloud-inbox.service";
import { PATRON_CLOUD_USER_SETTING_KEY } from "../src/constants/reserved-settings";
import { NOTIFICATION_CATALOG } from "../src/constants/notification-catalog";
import { runCloudInboxOnce, __resetCloudInboxJobForTests } from "../src/jobs/cloud-inbox.job";
import { setCloudUrlForTests } from "../src/cloud-sync/cloud-url";
import { PATRON_CLOUD_ENTITLEMENT } from "../src/cloud-sync/eligibility";
import { ReportGate, REPORT_MIN_GAP_MS } from "../src/cloud-sync/report-gate";
import { claimAndRunReportRequests, REPORT_CLAIM_BATCH } from "../src/cloud-sync/report-requests";
import type { CloudTransport } from "../src/cloud-sync/cloud-client";
import { SYNC_PATHS, type InboxMessage, type InboxOutcome } from "../src/cloud-sync/wire";
import { DAY_MS, msToIso } from "../src/lib/license/protocol";
import type { VendorHttpRequest, VendorHttpResponse } from "../src/services/helpers/license-wire.helper";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { ensureTestAdmin } from "./fixture-test-user";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
  throw new Error(engel);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

AuditService.log = async () => {};
AuditService.logEvent = async () => {};

const DAMGA = Date.now().toString(36).toUpperCase();
const BASLANGIC = new Date(Date.now() - 1000);
const yaratilan = { kart: new Set<string>(), mesaj: new Set<string>() };
const OLAY = "cari.patron-carisi" as const;
const IZLENEN_AYARLAR = [...GUARD_SETTING_KEYS, SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, PATRON_CLOUD_USER_SETTING_KEY];
let onceAyarlar: Array<{ key: string; value: unknown; description: string | null }> = [];
let onceTeknik: string | null = null;

function cariMesaji(ad: string, ek: Partial<InboxMessage> = {}): InboxMessage {
  const m: InboxMessage = {
    mesajId: randomUUID(),
    tur: "CARI",
    govde: { ad, roller: { musteri: true, tedarikci: false } },
    hesapId: "7d4b1f1e-2f44-4c2a-9a55-3f9d8f0a1b2c",
    hesapAdi: "Bulut Patron",
    olusturulma: new Date().toISOString(),
    ...ek,
  };
  yaratilan.mesaj.add(m.mesajId);
  return m;
}
function kaydet(outcomes: readonly InboxOutcome[]): void {
  for (const o of outcomes) if (o.durum === "ISLENDI" && o.varlikId) yaratilan.kart.add(o.varlikId);
}
async function ayarYaz(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}
async function ayarSil(keys: readonly string[]): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: { in: [...keys] } } });
}
async function hata(fn: () => Promise<unknown>): Promise<{ status?: number; code?: unknown; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: unknown }; message: string };
    return { status: err.statusCode, code: err.details?.code, message: err.message };
  }
}

// ── §1 ─────────────────────────────────────────────────────────────────────────────────────────
async function bolum1(adminId: string): Promise<void> {
  console.log("\n§1 ayarlar — varsayılan, çöp, doğrulama");
  await ayarSil(GUARD_SETTING_KEYS);
  let a = await readPatronCloudGuardSettings();
  check(
    "kayıt yok → anahtar AÇIK (bugünkü davranış) ve varsayılan tavanlar",
    a.gelenKutusuAcik && a.saatlikTavan === INBOX_HOURLY_MAX_DEFAULT && a.gunlukTavan === INBOX_DAILY_MAX_DEFAULT && a.raporSaatlikTavan === REPORT_HOURLY_MAX_DEFAULT,
    JSON.stringify(a),
  );
  await ayarYaz(SETTING_KEYS.PATRON_BULUT_INBOX_ENABLED, "evet");
  await ayarYaz(SETTING_KEYS.PATRON_BULUT_INBOX_HOURLY_MAX, 0);
  await ayarYaz(SETTING_KEYS.PATRON_BULUT_INBOX_DAILY_MAX, "12.5");
  await ayarYaz(SETTING_KEYS.PATRON_BULUT_REPORT_HOURLY_MAX, 99999);
  a = await readPatronCloudGuardSettings();
  check("çöp değer → varsayılan (anahtar açık, tavanlar aralık dışı/ondalık reddedilir)", a.gelenKutusuAcik && a.saatlikTavan === INBOX_HOURLY_MAX_DEFAULT && a.gunlukTavan === INBOX_DAILY_MAX_DEFAULT && a.raporSaatlikTavan === REPORT_HOURLY_MAX_DEFAULT, JSON.stringify(a));
  await ayarYaz(SETTING_KEYS.PATRON_BULUT_INBOX_ENABLED, "false");
  check("metin \"false\" da kapatır", !(await readPatronCloudGuardSettings()).gelenKutusuAcik);
  await ayarSil(GUARD_SETTING_KEYS);

  for (const [ad, input] of [
    ["saatlik 0", { saatlikTavan: 0 }],
    ["günlük 10001", { gunlukTavan: 10_001 }],
    ["rapor 2.5", { raporSaatlikTavan: 2.5 }],
  ] as const) {
    const h = await hata(() => updatePatronCloudGuardSettings(input, adminId));
    check(`yazım reddi: ${ad} → 400 PATRON_BULUT_AYAR_GECERSIZ (Türkçe)`, h?.status === 400 && h.code === "PATRON_BULUT_AYAR_GECERSIZ" && /arasında tam sayı/.test(h.message), JSON.stringify(h));
  }
  const yeni = await updatePatronCloudGuardSettings({ saatlikTavan: 7, gunlukTavan: 70, raporSaatlikTavan: 5, gelenKutusuAcik: false }, adminId);
  check("geçerli yazım okunur", !yeni.gelenKutusuAcik && yeni.saatlikTavan === 7 && yeni.gunlukTavan === 70 && yeni.raporSaatlikTavan === 5, JSON.stringify(yeni));
  await ayarSil(GUARD_SETTING_KEYS);
}

// ── §2 ─────────────────────────────────────────────────────────────────────────────────────────
function bolum2(): void {
  console.log("\n§2 ham ayar ucu dört anahtarı reddeder");
  const kaynak = readFileSync(join(__dirname, "..", "src", "routes", "admin.routes.ts"), "utf8");
  const put = kaynak.slice(kaynak.indexOf('"/settings/:key"'));
  const ret = /if \(\(GUARD_SETTING_KEYS as readonly string\[\]\)\.includes\(key\)\) \{\s*throw AppError\.badRequest\(/;
  const yazim = put.indexOf("systemSettingService.set(");
  check("PUT /settings/:key gövdesi GUARD_SETTING_KEYS'i yazımdan ÖNCE reddediyor", ret.test(put) && put.search(ret) < yazim && yazim > 0);
  check("küme dört anahtarın hepsini taşır", GUARD_SETTING_KEYS.length === 4 && new Set(GUARD_SETTING_KEYS).size === 4);
  check("sonda: desen silinmiş kaynakta eşleşmez (körlük zemini)", !ret.test(put.replace("GUARD_SETTING_KEYS", "BASKA_KUME")));
}

// ── sahte bulut ────────────────────────────────────────────────────────────────────────────────
interface SahteBulut {
  cagrilar: Array<{ yol: string; govde: Record<string, unknown> }>;
  kuyruk: InboxMessage[];
  /** true: `enFazla`yı yok sayıp kuyruğun tamamını verir (ele geçirilmiş bulut). */
  acgozlu: boolean;
  tasiyici: (req: VendorHttpRequest) => Promise<VendorHttpResponse>;
}
function sahteBulut(): SahteBulut {
  const b: SahteBulut = {
    cagrilar: [],
    kuyruk: [],
    acgozlu: false,
    tasiyici: async (req) => {
      const yol = new URL(req.url).pathname;
      const govde = JSON.parse(req.body ?? "{}") as Record<string, unknown>;
      b.cagrilar.push({ yol, govde });
      if (yol === SYNC_PATHS.ACCOUNTS) return { status: 200, body: JSON.stringify({ v: 1, hesaplar: [] }) };
      if (yol === SYNC_PATHS.INBOX_CLAIM) {
        const n = b.acgozlu ? b.kuyruk.length : Number(govde.enFazla ?? 20);
        return { status: 200, body: JSON.stringify({ v: 1, kayitlar: b.kuyruk.splice(0, n) }) };
      }
      if (yol === SYNC_PATHS.INBOX_RESULT) return { status: 200, body: JSON.stringify({ v: 1, kabul: (govde.sonuclar as { mesajId: string }[]).map((x) => x.mesajId), ret: [] }) };
      return { status: 404, body: "{}" };
    },
  };
  return b;
}
const alCagrildi = (b: SahteBulut): boolean => b.cagrilar.some((c) => c.yol === SYNC_PATHS.INBOX_CLAIM);
const alGovdesi = (b: SahteBulut): Record<string, unknown> | undefined => b.cagrilar.find((c) => c.yol === SYNC_PATHS.INBOX_CLAIM)?.govde;

function lisansHazirla(): void {
  setCloudUrlForTests("https://patron-bulut.test");
  lisansKipKur({
    zorlama: false,
    moduller: ["production.enabled", "finance.enabled", "ticaret.enabled", PATRON_CLOUD_ENTITLEMENT],
    kiraEk: { esitlemeAraligiDk: 5, patronBulutBitis: msToIso(Date.now() + 30 * DAY_MS) },
  });
}

// ── §3 ─────────────────────────────────────────────────────────────────────────────────────────
async function bolum3(adminId: string): Promise<void> {
  console.log("\n§3 buluttan yazmayı durdur anahtarı");
  const bulut = sahteBulut();
  await updatePatronCloudGuardSettings({ gelenKutusuAcik: false, saatlikTavan: 10_000, gunlukTavan: 10_000 }, adminId);
  bulut.kuyruk.push(cariMesaji(`TEST-SED ${DAMGA} durdur`));
  __resetCloudInboxJobForTests();
  let r = await runCloudInboxOnce(bulut.tasiyici);
  check(
    "anahtar kapalı → DURDURULDU, `al` çağrılmaz, hesap listesi yine tazelenir, kayıt bulutta",
    r.outcome === "DURDURULDU" && !alCagrildi(bulut) && bulut.cagrilar.some((c) => c.yol === SYNC_PATHS.ACCOUNTS) && bulut.kuyruk.length === 1,
    `${r.outcome} yollar=${bulut.cagrilar.map((c) => c.yol).join(",")}`,
  );
  await updatePatronCloudGuardSettings({ gelenKutusuAcik: true }, adminId);
  bulut.cagrilar.length = 0;
  r = await runCloudInboxOnce(bulut.tasiyici);
  kaydet(r.outcomes);
  check("açınca `al` çağrılır, bekleyen kayıt işlenir", r.outcome === "BASARILI" && alCagrildi(bulut) && r.outcomes.length === 1 && r.outcomes[0]?.durum === "ISLENDI" && bulut.kuyruk.length === 0, `${r.outcome} ${JSON.stringify(r.outcomes.map((o) => o.kod))}`);
}

// ── §4 ─────────────────────────────────────────────────────────────────────────────────────────
async function bolum4(adminId: string): Promise<void> {
  console.log("\n§4 gelen kutusu tavanı (kayan pencere)");
  const bulut = sahteBulut();
  const simdi = await measureInboxQuota(await readPatronCloudGuardSettings());
  await updatePatronCloudGuardSettings({ saatlikTavan: simdi.saatlik.sayi + 2, gunlukTavan: 10_000 }, adminId);
  bulut.kuyruk.push(cariMesaji(`TEST-SED ${DAMGA} t1`), cariMesaji(`TEST-SED ${DAMGA} t2`), cariMesaji(`TEST-SED ${DAMGA} t3`));
  __resetCloudInboxJobForTests();
  let r = await runCloudInboxOnce(bulut.tasiyici);
  kaydet(r.outcomes);
  check("kalan 2 → `al` `enFazla: 2` ister, 2 kayıt işlenir, 1 bulutta kalır", alGovdesi(bulut)?.enFazla === 2 && r.outcomes.length === 2 && bulut.kuyruk.length === 1, `enFazla=${String(alGovdesi(bulut)?.enFazla)} işlenen=${r.outcomes.length} kalan=${bulut.kuyruk.length}`);

  bulut.cagrilar.length = 0;
  r = await runCloudInboxOnce(bulut.tasiyici);
  check("saatlik tavan dolu → TAVAN_DOLU:SAATLIK, `al` yok, kayıt bulutta", r.outcome === "TAVAN_DOLU" && r.reason === "SAATLIK" && !alCagrildi(bulut) && bulut.kuyruk.length === 1, `${r.outcome}:${r.reason ?? ""}`);

  // Ele geçirilmiş bulut `enFazla`yı yok sayar → fazlası işlenmez.
  const q = await measureInboxQuota(await readPatronCloudGuardSettings());
  await updatePatronCloudGuardSettings({ saatlikTavan: q.saatlik.sayi + 1 }, adminId);
  bulut.kuyruk.push(cariMesaji(`TEST-SED ${DAMGA} t4`));
  bulut.acgozlu = true;
  bulut.cagrilar.length = 0;
  r = await runCloudInboxOnce(bulut.tasiyici);
  kaydet(r.outcomes);
  const verilen = 2;
  check("bulut 2 verir, kalan 1 → yalnız 1 işlenir (fazlası makbuzsuz kalır)", alGovdesi(bulut)?.enFazla === 1 && r.outcomes.length === 1 && r.pulled === 1, `enFazla=${String(alGovdesi(bulut)?.enFazla)} verilen=${verilen} işlenen=${r.outcomes.length}`);
  bulut.acgozlu = false;

  const g = await measureInboxQuota(await readPatronCloudGuardSettings());
  await updatePatronCloudGuardSettings({ saatlikTavan: 10_000, gunlukTavan: Math.max(1, g.gunluk.sayi) }, adminId);
  bulut.cagrilar.length = 0;
  r = await runCloudInboxOnce(bulut.tasiyici);
  check("günlük tavan dolu → TAVAN_DOLU:GUNLUK, `al` yok", r.outcome === "TAVAN_DOLU" && r.reason === "GUNLUK" && !alCagrildi(bulut), `${r.outcome}:${r.reason ?? ""}`);
  const durum = await getPatronCloudStatus();
  check("durum özeti tavanı dolu gösterir", durum.sed.gelenKutusu.dolu === "GUNLUK" && durum.sed.gelenKutusu.kalan === 0 && durum.sonTur?.outcome === "TAVAN_DOLU:GUNLUK", JSON.stringify(durum.sed.gelenKutusu));
  bulut.kuyruk.length = 0;
}

// ── §5 ─────────────────────────────────────────────────────────────────────────────────────────
async function bolum5(): Promise<void> {
  console.log("\n§5 rapor kapısı");
  const g = new ReportGate();
  const t0 = 1_000_000_000;
  let d = g.decide(t0, 4, REPORT_CLAIM_BATCH);
  check("boş pencere → açık, enFazla = parti (3)", d.ok && d.enFazla === REPORT_CLAIM_BATCH, JSON.stringify(d));
  g.markClaim(t0);
  g.markComputed(t0, 3);
  d = g.decide(t0 + REPORT_MIN_GAP_MS - 1, 4, REPORT_CLAIM_BATCH);
  check("30 sn dolmadan → ARALIK", !d.ok && d.neden === "ARALIK", JSON.stringify(d));
  d = g.decide(t0 + REPORT_MIN_GAP_MS, 4, REPORT_CLAIM_BATCH);
  check("aralık sonrası kalan 1 → enFazla 1", d.ok && d.enFazla === 1, JSON.stringify(d));
  g.markClaim(t0 + REPORT_MIN_GAP_MS);
  g.markComputed(t0 + REPORT_MIN_GAP_MS, 1);
  d = g.decide(t0 + 2 * REPORT_MIN_GAP_MS, 4, REPORT_CLAIM_BATCH);
  check("saatlik tavan dolu → TAVAN", !d.ok && d.neden === "TAVAN", JSON.stringify(d));
  d = g.decide(t0 + 60 * 60 * 1000 + 1, 4, REPORT_CLAIM_BATCH);
  check("60 dk sonra ilk hesaplar pencereden düşer → yeniden açık", d.ok && d.enFazla === 3, JSON.stringify(d));

  // Gerçek yoklama: enFazla iletilir, bulutun fazlası hesaplanmaz.
  const claimGovdeleri: Array<Record<string, unknown>> = [];
  let sonucSayisi = 0;
  const tasiyici: CloudTransport = async (req) => {
    const yol = new URL(req.url).pathname;
    if (yol === SYNC_PATHS.REPORT_CLAIM) {
      claimGovdeleri.push(JSON.parse(req.body.toString("utf8")) as Record<string, unknown>);
      const istekler = [1, 2, 3].map(() => ({ istekId: randomUUID(), raporAnahtari: "audit/system-log-summary", parametreler: {} }));
      return { status: 200, body: Buffer.from(JSON.stringify({ v: 1, istekler })) };
    }
    if (yol === SYNC_PATHS.REPORT_RESULT) {
      sonucSayisi++;
      return { status: 200, body: Buffer.from(JSON.stringify({ v: 1 })) };
    }
    return { status: 404, body: Buffer.from("{}") };
  };
  const r = await claimAndRunReportRequests({ baseUrl: "https://patron-bulut.test", installationId: randomUUID(), transport: tasiyici }, Date.now, 1);
  check("`al` gövdesi enFazla: 1; bulut 3 verse de yalnız 1 hesaplanır", claimGovdeleri[0]?.enFazla === 1 && r.claimed === 1 && sonucSayisi === 1, `${JSON.stringify(claimGovdeleri[0])} claimed=${r.claimed} sonuc=${sonucSayisi}`);

  const isKaynagi = readFileSync(join(__dirname, "..", "src", "jobs", "cloud-sync.job.ts"), "utf8");
  const govde = isKaynagi.slice(isKaynagi.indexOf("async function runReportClaims"), isKaynagi.indexOf("async function dailyPrune"));
  check("eşitleme işi rapor yoklamasını yalnız kapıdan geçirir (runGatedReportClaims; doğrudan claimAndRunReportRequests yok)", /runGatedReportClaims\(/.test(govde) && !/claimAndRunReportRequests\(/.test(isKaynagi));
  const kapiKaynagi = readFileSync(join(__dirname, "..", "src", "cloud-sync", "report-gate.ts"), "utf8");
  const kapiGovde = kapiKaynagi.slice(kapiKaynagi.indexOf("export async function runGatedReportClaims"));
  check("kapı sırası: decide → !ok dönüş → markClaim → enFazla iletimi → markComputed", /gate\.decide\(/.test(kapiGovde) && /if \(!d\.ok\) return/.test(kapiGovde) && /gate\.markClaim\(/.test(kapiGovde) && /claimAndRunReportRequests\([^)]*d\.enFazla\)/.test(kapiGovde) && /gate\.markComputed\(/.test(kapiGovde));
}

// ── §6 ─────────────────────────────────────────────────────────────────────────────────────────
async function bolum6(aktor: string): Promise<void> {
  console.log("\n§6 buluttan cari → fabrika içi bildirim");
  await ayarYaz(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, true);
  const ad = `TEST-SED ${DAMGA} bildirim`;
  const m = cariMesaji(ad);
  const o = await processInboxMessage(m, aktor);
  if (o) kaydet([o]);
  const satirlar = o?.varlikId ? await prisma.notificationOutbox.findMany({ where: { kind: OLAY, subjectId: o.varlikId } }) : [];
  check("cari ISLENDI → TEK outbox satırı, aktör teknik kullanıcı", o?.durum === "ISLENDI" && satirlar.length === 1 && satirlar[0]?.actorUserId === aktor, `${o?.durum} satır=${satirlar.length}`);
  const yuk = (satirlar[0]?.payload ?? {}) as Record<string, unknown>;
  const izinli = new Set<string>(NOTIFICATION_CATALOG[OLAY].payloadAlanlari);
  check("yük yalnız katalog alanları, ad ve bulut hesabı doğru", Object.keys(yuk).every((k) => izinli.has(k)) && typeof yuk.cariAd === "string" && yuk.cariAd.includes(DAMGA) && yuk.cariId === o?.varlikId && yuk.hesapAdi === "Bulut Patron" && typeof yuk.cariKodu === "string", JSON.stringify(yuk));
  await processInboxMessage(m, aktor);
  const tekrar = o?.varlikId ? await prisma.notificationOutbox.count({ where: { kind: OLAY, subjectId: o.varlikId } }) : -1;
  check("aynı mesaj tekrar → ikinci outbox satırı yok", tekrar === 1, String(tekrar));
  const once = await prisma.notificationOutbox.count({ where: { kind: OLAY, createdAt: { gte: BASLANGIC } } });
  const ret = await processInboxMessage(cariMesaji(ad), aktor);
  const sonra = await prisma.notificationOutbox.count({ where: { kind: OLAY, createdAt: { gte: BASLANGIC } } });
  check("mükerrer ad → REDDEDILDI, outbox satırı yok", ret?.durum === "REDDEDILDI" && ret.kod === "CARI_AD_MUKERRER" && once === sonra, `${ret?.durum}:${ret?.kod ?? ""} ${once}→${sonra}`);
  const kaynak = readFileSync(join(__dirname, "..", "src", "services", "cloud-inbox.service.ts"), "utf8");
  const kart = kaynak.slice(kaynak.indexOf("async function createCardFromMessage"), kaynak.indexOf("export async function processInboxMessage"));
  const tx = kart.slice(kart.indexOf("prisma.$transaction"), kart.indexOf("if (r.replay)"));
  check("emit cari tx'inin İÇİNDE ve makbuzdan SONRA", /emitNotification\(tx, "cari\.patron-carisi"/.test(tx) && tx.indexOf("cloudInboxReceipt.create") < tx.indexOf("emitNotification("));
}

// ── §7 ─────────────────────────────────────────────────────────────────────────────────────────
async function bolum7(): Promise<void> {
  console.log("\n§7 durum özeti — seddi ve makbuz listesi");
  const d = await getPatronCloudStatus();
  const bizim = d.makbuzlar.filter((m) => yaratilan.kart.has(m.varlikId ?? ""));
  const sirali = d.makbuzlar.every((m, i, a) => i === 0 || a[i - 1]!.at >= m.at);
  check("son makbuzlar listede, en yeni önce, kim/ne/sonuç alanlarıyla", bizim.length > 0 && sirali && bizim.every((m) => m.hesapAdi === "Bulut Patron" && m.tur === "CARI" && m.sonuc === "ISLENDI" && typeof m.belgeNo === "string"), `bizim=${bizim.length} toplam=${d.makbuzlar.length}`);
  check("rapor sayacı ve aralığı özet içinde", d.sed.rapor.enAzAralikSn === 30 && d.sed.rapor.tavan === d.sed.ayarlar.raporSaatlikTavan);
}

// ── teardown ───────────────────────────────────────────────────────────────────────────────────
async function temizlik(): Promise<void> {
  const kartlar = [...yaratilan.kart];
  await prisma.notificationOutbox.deleteMany({ where: { kind: OLAY, subjectId: { in: kartlar } } });
  await prisma.cloudInboxReceipt.deleteMany({ where: { messageId: { in: [...yaratilan.mesaj] } } });
  await prisma.cariAccount.deleteMany({ where: { customerId: { in: kartlar } } });
  await prisma.customer.deleteMany({ where: { id: { in: kartlar } } });
  const simdiki = await readPatronCloudUserId();
  if (simdiki && simdiki !== onceTeknik) {
    await prisma.session.deleteMany({ where: { userId: simdiki } });
    await prisma.userPermission.deleteMany({ where: { userId: simdiki } });
    await prisma.user.deleteMany({ where: { id: simdiki } });
  }
  await ayarSil(IZLENEN_AYARLAR);
  for (const a of onceAyarlar) await prisma.systemSetting.create({ data: { key: a.key, value: a.value as never, description: a.description } });
  setCloudUrlForTests(null);
  temizleLisansKipDizini();
  __resetPatronCloudStateForTests();
  __resetCloudInboxJobForTests();
}

async function main(): Promise<void> {
  onceAyarlar = (await prisma.systemSetting.findMany({ where: { key: { in: IZLENEN_AYARLAR } }, select: { key: true, value: true, description: true } })).map((a) => ({ ...a, value: a.value as unknown }));
  onceTeknik = await readPatronCloudUserId();
  const admin = await ensureTestAdmin();
  try {
    await bolum1(admin.id);
    bolum2();
    const aktor = (await activatePatronCloud(admin.id)).userId;
    lisansHazirla();
    await bolum3(admin.id);
    await bolum4(admin.id);
    await bolum5();
    await bolum6(aktor);
    await bolum7();
  } finally {
    await temizlik();
  }
}

main()
  .catch((e: unknown) => {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exitCode ||= fail === 0 ? 0 : 1;
  });
