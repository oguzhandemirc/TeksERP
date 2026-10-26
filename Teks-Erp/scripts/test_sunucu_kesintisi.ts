// =============================================================================
// BEKÇİ — SUNUCU GÜNCELLEMESİNDEN ÖNCE EKRAN DUYURUSU (ön duyuru 5 dk · kesinti türetimi · yürürlük zamanlayıcısı)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts sunucu_kesintisi   (DB: kendi _test DB'n; geçici güncelleyici dizini)
//
// NE ÖLÇER:
//   §1 ⭐ türetim (`plannedOutage`, SAF): HEMEN → yürürlük (kayıt + 5 dk) · PENCERE → max(yürürlük, pencere başı) ·
//      onaysız PENCERE_BEKLIYOR → güncelleyicinin `planlanan`ı · UYGULANIYOR → sürüyor (bayat kalp → yok) · kullanılmış
//      onay / başka sürümün onayı / 15 dk bayat an → yok · `kalanSn` hiç eksi değil
//   §2 görünüm: `updateStatusFrom` onaya `yururluk`, gövdeye `kesinti` koyar; özet aynı değeri taşır
//   §3 ⭐ niyet + zamanlayıcı (DB): yürürlükten önce niyette onay YOK · boot yolu (`scheduleApprovalActivation`)
//      zamanlayıcıyı kalan süreyle kurar ve yürürlükte niyet KENDİLİĞİNDEN onaylı yazılır · GERI_AL zamanlayıcı bırakmaz ·
//      boot (`startLicensePoll`) ve onay kaydı zamanlayıcıyı çağırır (kaynak taraması) · doğrulama kipinde kurulmaz
//   §4 ⭐ ayna: panel ve tablet `src/lib/sunucu-kesintisi.ts` BAYT-EŞİT (sha256) · istemcinin eşikleri backend'in ön
//      duyuru ve bayatlık sabitleriyle aynı · iki istemcinin API istemcisi bekleticiyi çağırır
// NEGATİF SONDA (elle, geri alındı; commit mesajında).
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { DAY_MS, msToIso, windowIntervals, type LeaseUpdatePolicy } from "../src/lib/license/protocol";
import { UPDATER_DIR_ENV, UPDATER_INTENT_FILE, type UpdaterIntent } from "../src/lib/license/updater-ipc";
import {
  UPDATE_APPROVAL_NOTICE_MS,
  UPDATE_OUTAGE_STALE_MS,
  plannedOutage,
  type PlannedOutageInput,
  type UpdateApprovalView,
} from "../src/services/helpers/update-approval-rules.helper";
import { pendingApprovalActivationMs, refreshUpdaterIntent, scheduleApprovalActivation } from "../src/services/update-intent.service";
import { updateStatusFrom } from "../src/services/update-status.service";
import { updateSummaryOf } from "../src/services/update-summary";
import { DEFAULT_FACTORY_TIMEZONE } from "../src/constants/time";
import { VERIFICATION_MODE_ENV } from "../src/lib/dogrulama-kipi";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const ON_EK = "srv-kesinti-";
const SIMDI = Date.parse("2026-10-12T10:00:00.000Z");
const DK = 60_000;
const KOK = fs.mkdtempSync(path.join(os.tmpdir(), "srv-kesinti-"));
const NIYET = path.join(KOK, UPDATER_INTENT_FILE);
const VEKTOR = path.join(__dirname, "..", "native", "test-vektorleri", "guncelleyici-durum", "onay-bekliyor", "durum", "durum.json");
const ADAY = "2.13.0";
const olusan: string[] = [];

function onay(over: Partial<UpdateApprovalView> = {}): UpdateApprovalView {
  const zaman = over.zaman ?? msToIso(SIMDI);
  return {
    onayId: randomUUID(), surum: "2.15.0", zamanlama: "HEMEN", onaylayan: { id: randomUUID(), ad: "Ayşe" }, zaman,
    yururluk: msToIso(Date.parse(zaman) + UPDATE_APPROVAL_NOTICE_MS), kullanildi: false, ...over,
  };
}

function girdi(over: Partial<PlannedOutageInput> = {}): PlannedOutageInput {
  return { onay: null, bekleyen: { surum: "2.15.0", karar: "ONAY_BEKLIYOR", neden: null }, yerel: { durum: "BEKLIYOR", planlanan: null, zaman: msToIso(SIMDI) }, sonrakiPencere: null, nowMs: SIMDI, ...over };
}

function turetim(): void {
  console.log("\n§1 kesinti türetimi (saf)");
  check("§1a ön duyuru 5 dk, bayatlık 15 dk", UPDATE_APPROVAL_NOTICE_MS === 5 * DK && UPDATE_OUTAGE_STALE_MS === 15 * DK);
  const h = plannedOutage(girdi({ onay: onay() }));
  check("§1b ⭐ HEMEN → planlanan = kayıt + 5 dk, kalanSn 300, sürmüyor", h?.planlanan === msToIso(SIMDI + 5 * DK) && h.kalanSn === 300 && !h.suruyor, JSON.stringify(h));
  const ileri = plannedOutage(girdi({ onay: onay({ zamanlama: "PENCERE" }), sonrakiPencere: { baslangic: msToIso(SIMDI + 60 * DK) } }));
  check("§1c ⭐ PENCERE, pencere ileride → pencere başı", ileri?.planlanan === msToIso(SIMDI + 60 * DK) && ileri.kalanSn === 3600, JSON.stringify(ileri));
  const icinde = plannedOutage(girdi({ onay: onay({ zamanlama: "PENCERE" }), sonrakiPencere: { baslangic: msToIso(SIMDI - 30 * DK) } }));
  check("§1d ⭐ PENCERE, pencerenin içindeyiz → yürürlük (5 dk uyarısız kurulum yok)", icinde?.planlanan === msToIso(SIMDI + 5 * DK), JSON.stringify(icinde));
  const yerelPlan = plannedOutage(girdi({ onay: onay({ zamanlama: "PENCERE" }), yerel: { durum: "BEKLIYOR", planlanan: msToIso(SIMDI + 120 * DK), zaman: null }, sonrakiPencere: { baslangic: msToIso(SIMDI + 60 * DK) } }));
  check("§1e PENCERE: güncelleyicinin planladığı an kiradaki sıradaki aralıktan önce gelir", yerelPlan?.planlanan === msToIso(SIMDI + 120 * DK));
  check("§1f PENCERE ama pencere hiç yok → yok", plannedOutage(girdi({ onay: onay({ zamanlama: "PENCERE" }) })) === null);
  const onaysiz = plannedOutage(girdi({ bekleyen: { surum: "2.15.0", karar: "PENCERE_BEKLIYOR", neden: null }, yerel: { durum: "BEKLIYOR", planlanan: msToIso(SIMDI + 3 * DK), zaman: null } }));
  check("§1g ⭐ onaysız PENCERE_BEKLIYOR (OTOMATİK) → güncelleyicinin planlanan anı", onaysiz?.planlanan === msToIso(SIMDI + 3 * DK) && onaysiz.kalanSn === 180, JSON.stringify(onaysiz));
  check("§1h onaysız ONAY_BEKLIYOR → yok (kurulum için onay gerekir)", plannedOutage(girdi({ yerel: { durum: "BEKLIYOR", planlanan: msToIso(SIMDI + 3 * DK), zaman: null } })) === null);
  const suruyor = plannedOutage(girdi({ yerel: { durum: "UYGULANIYOR", planlanan: null, zaman: msToIso(SIMDI - DK) } }));
  check("§1i ⭐ UYGULANIYOR → sürüyor (kalanSn 0)", suruyor?.suruyor === true && suruyor.kalanSn === 0 && suruyor.planlanan === null, JSON.stringify(suruyor));
  check("§1j UYGULANIYOR ama durum dosyası 15 dk'dan eski → yok", plannedOutage(girdi({ yerel: { durum: "UYGULANIYOR", planlanan: null, zaman: msToIso(SIMDI - 16 * DK) } })) === null);
  check("§1k ⭐ kullanılmış onay → yok", plannedOutage(girdi({ onay: onay({ kullanildi: true }) })) === null);
  check("§1l başka sürümün onayı (bekleyen değişti) → yok", plannedOutage(girdi({ onay: onay({ surum: "2.14.0" }) })) === null);
  const gecti = plannedOutage(girdi({ onay: onay(), nowMs: SIMDI + 10 * DK }));
  check("§1m an geçti, 15 dk dolmadı → kalanSn 0 (\"birazdan\"), eksi değil", gecti?.kalanSn === 0 && gecti.planlanan === msToIso(SIMDI + 5 * DK));
  check("§1n ⭐ an 15 dk'dan fazla geçti → bayat, yok", plannedOutage(girdi({ onay: onay(), nowMs: SIMDI + 5 * DK + UPDATE_OUTAGE_STALE_MS + 1 })) === null);
}

function gorunum(): void {
  console.log("\n§2 durum görünümü + özet");
  const doc = JSON.parse(fs.readFileSync(VEKTOR, "utf8")) as Record<string, unknown>;
  const read = { status: { kind: "ok", doc: { ...doc, zaman: msToIso(SIMDI), sonCanlilik: msToIso(SIMDI) } }, history: [] } as never;
  const bekleyen = (doc.bekleyen as { surum: string }).surum;
  const v = updateStatusFrom({
    lease: null, tokens: [], read, kuruluSurum: "2.12.0", nowMs: SIMDI,
    approval: { onayId: randomUUID(), surum: bekleyen, zamanlama: "HEMEN", onaylayan: { id: randomUUID(), ad: "Ayşe" }, zaman: msToIso(SIMDI - DK) },
  });
  check("§2a onay görünümünde yürürlük = kayıt + 5 dk", v.onay?.yururluk === msToIso(SIMDI + 4 * DK), v.onay?.yururluk);
  check("§2b ⭐ gövdede kesinti (4 dk kaldı)", v.kesinti?.planlanan === msToIso(SIMDI + 4 * DK) && v.kesinti.kalanSn === 240, JSON.stringify(v.kesinti));
  check("§2c özet aynı kesintiyi taşır (izinsiz kullanıcının şeridi)", JSON.stringify(updateSummaryOf(v).kesinti) === JSON.stringify(v.kesinti));
}

function niyetOku(): UpdaterIntent | null {
  return fs.existsSync(NIYET) ? (JSON.parse(fs.readFileSync(NIYET, "utf8")) as UpdaterIntent) : null;
}

function politika(): LeaseUpdatePolicy {
  const simdi = Date.now();
  const pencere = { baslangic: "02:00", bitis: "05:00", gunler: [1, 2, 3, 4, 5, 6, 7], saatDilimi: DEFAULT_FACTORY_TIMEZONE };
  return { kip: "ONAYLI", pencere, araliklar: windowIntervals(pencere, simdi - 60 * 60 * 1000, simdi + 29 * DAY_MS), hedefSurum: null };
}

async function onaySatiri(userId: string, choice: string, createdAt: Date): Promise<string> {
  const id = randomUUID();
  await prisma.updateApproval.create({ data: { id, version: ADAY, choice, policyMode: "ONAYLI", approvedById: userId, approverName: "Ayşe Y.", createdAt } });
  return id;
}

async function zamanlayici(): Promise<void> {
  console.log("\n§3 niyet + yürürlük zamanlayıcısı (DB)");
  const u = await prisma.user.create({ data: { username: `${ON_EK}${Date.now()}`, passwordHash: "-", fullName: "Ayşe Yılmaz", isActive: true }, select: { id: true } });
  olusan.push(u.id);
  fs.mkdirSync(path.join(KOK, "niyet"), { recursive: true });
  fs.mkdirSync(path.join(KOK, "durum"), { recursive: true });
  const d = JSON.parse(fs.readFileSync(VEKTOR, "utf8")) as Record<string, unknown>;
  fs.writeFileSync(path.join(KOK, "durum", "durum.json"), JSON.stringify({ ...d, zaman: msToIso(Date.now()), sonCanlilik: msToIso(Date.now()) }));
  process.env[UPDATER_DIR_ENV] = KOK;
  lisansKipKur({ zorlama: false, kiraEk: { guncelleme: politika() } });

  // Yeniden açılan sunucu: onay ~1,2 sn sonra yürürlüğe girecek, bellekte zamanlayıcı yok.
  const createdAt = new Date(Date.now() - UPDATE_APPROVAL_NOTICE_MS + 1200);
  const id = await onaySatiri(u.id, "HEMEN", createdAt);
  await refreshUpdaterIntent();
  check("§3a ⭐ yürürlükten önce tazeleme niyete onay YAZMAZ", niyetOku()?.onay === null, JSON.stringify(niyetOku()?.onay));
  const due = await scheduleApprovalActivation();
  check("§3b ⭐ boot yolu zamanlayıcıyı yürürlük anına kurar", due === createdAt.getTime() + UPDATE_APPROVAL_NOTICE_MS && pendingApprovalActivationMs() === due, `${due}`);
  for (let i = 0; i < 40 && niyetOku()?.onay?.onayId !== id; i++) await new Promise((r) => setTimeout(r, 100));
  check("§3c ⭐ yürürlükte niyet KENDİLİĞİNDEN onaylı yazıldı (onayId = satır)", niyetOku()?.onay?.onayId === id && niyetOku()?.onay?.zamanlama === "HEMEN");
  check("§3d zamanlayıcı söküldü (yürürlükteki onay için yenisi kurulmaz)", pendingApprovalActivationMs() === null);

  await onaySatiri(u.id, "GERI_AL", new Date());
  const geri = await scheduleApprovalActivation();
  await refreshUpdaterIntent();
  check("§3e GERI_AL → zamanlayıcı yok, niyette onay anında düşer", geri === null && pendingApprovalActivationMs() === null && niyetOku()?.onay === null);

  const kok = path.join(__dirname, "..", "src");
  const server = fs.readFileSync(path.join(kok, "server.ts"), "utf8");
  const yoklama = fs.readFileSync(path.join(kok, "jobs", "license-poll.job.ts"), "utf8");
  const servis = fs.readFileSync(path.join(kok, "services", "update-approval.service.ts"), "utf8");
  check("§3f ⭐ boot zamanlayıcıyı kurar: server.ts → startLicensePoll → scheduleApprovalActivationQuietly",
    /^\s*startLicensePoll\(\);/m.test(server) && /export function startLicensePoll\(\)[^]*?scheduleApprovalActivationQuietly\(\);[^]*?\n\}/.test(yoklama));
  await onaySatiri(olusan[0]!, "HEMEN", new Date());
  process.env[VERIFICATION_MODE_ENV] = "1";
  const dogrulama = await scheduleApprovalActivation();
  delete process.env[VERIFICATION_MODE_ENV];
  check("§3h doğrulama kipinde zamanlayıcı kurulmaz", dogrulama === null && pendingApprovalActivationMs() === null);
  check("§3g onay kaydı (ve tekrar oynatma) cevabı zamanlayıcıyı kurar", /async function respondFor[\s\S]{0,200}scheduleApprovalActivationQuietly\(\)/.test(servis));
}

function ayna(): void {
  console.log("\n§4 istemci aynası (panel + tablet)");
  const kok = path.join(__dirname, "..", "..");
  const oku = (rel: string): string => (fs.existsSync(path.join(kok, rel)) ? fs.readFileSync(path.join(kok, rel), "utf8") : "");
  const panel = oku("Electron/src/lib/sunucu-kesintisi.ts");
  const tablet = oku("mobil/src/lib/sunucu-kesintisi.ts");
  const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
  check("§4a ⭐ iki kopya var ve BAYT-EŞİT", panel.length > 0 && panel === tablet, `${sha(panel)} / ${sha(tablet)}`);
  const sabit = (ad: string): number => Number(panel.match(new RegExp(`export const ${ad} = ([0-9_]+);`))?.[1]?.replace(/_/g, ""));
  check("§4b ⭐ istemci eşikleri backend'le aynı (ön duyuru 300 sn · bayatlık 900 sn)",
    sabit("OUTAGE_NOTICE_SECONDS") * 1000 === UPDATE_APPROVAL_NOTICE_MS && sabit("OUTAGE_STALE_SECONDS") * 1000 === UPDATE_OUTAGE_STALE_MS,
    `${sabit("OUTAGE_NOTICE_SECONDS")} / ${sabit("OUTAGE_STALE_SECONDS")}`);
  check("§4c panel apiClient + tablet api.ts istek interceptor'ında bekletici",
    /interceptors\.request\.use\(async \(config\) => \{\s*await holdForOutage\(config\.url\);/.test(oku("Electron/src/services/apiClient.ts")) &&
      /interceptors\.request\.use\(async \(config\) => \{\s*await holdForOutage\(config\.url\);/.test(oku("mobil/src/services/api.ts")));
}

async function temizlik(): Promise<void> {
  const eski = await prisma.user.findMany({ where: { username: { startsWith: ON_EK } }, select: { id: true } });
  const ids = [...new Set([...olusan, ...eski.map((x) => x.id)])];
  if (ids.length > 0) {
    await prisma.updateApproval.deleteMany({ where: { approvedById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  delete process.env[UPDATER_DIR_ENV];
  fs.rmSync(KOK, { recursive: true, force: true });
  temizleLisansKipDizini();
}

async function main(): Promise<void> {
  console.log("=== SUNUCU KESİNTİSİ DUYURUSU ===");
  await temizlik().catch(() => undefined);
  fs.mkdirSync(KOK, { recursive: true });
  turetim();
  gorunum();
  ayna();
  await zamanlayici();
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e instanceof Error ? e.stack : e);
    fail++;
  })
  .finally(async () => {
    await temizlik().catch((e) => console.log(`  ⚠️ temizlik: ${e instanceof Error ? e.message : String(e)}`));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
