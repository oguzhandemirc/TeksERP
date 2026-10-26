// =============================================================================
// BEKÇİ — İŞ KOŞUL KAYNAKLARI (N1-KOSUL-IS: termin ×2 · iş emri · KK1 oranı · fason · sevkiyat · levent)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_kosul_is
// =============================================================================
// Okuyucular `overrideWorkSourceDeps` ile sahte dünyaya bağlanır; KARAR (eşik, pencere, termin yüklemi)
// gerçek koddan, tur gerçek tarayıcıdan (`runConditionSourceOnce`) ve gerçek dağıtıcıdan geçer. Her tür:
//   §a bozulur → tek ACILDI (+ modül görünürse tek kutu satırı) · §b sürer (3 tur) → yeni satır yok
//   §e okuyucu fırlatır → açık koşul AÇIK · §c düzelir → KAPANDI + "Çözüldü" metni · §d yeniden açılır → YENİ koşul
// Ek: §T termin yaklaştı → geçti (aynı sipariş: yaklaştı kapanır, geçti açılır) · §K KK1 fabrika günü dönüşü
// (konu `<kumas>:<gün>`, gün `time.ts`ten) + metraj alt sınırı + rol yokken koruma · §F fason `daysOpen > gun`
// sınırı ve firma kırılımı · §L levent `kalanGun ≤ param` sınırı + parametre değişimi · §G modül kapalı → küme
// boş · §Y gelen kutusu bayrağı kapalı → koşul tablosu boş · §R gerçek modül kapısı · §B boğaz-ikiz
// (karne ↔ koşul aynı helper; çıktı + AST) · §S termin tek kaynak taraması · §M gerçek okuyucularla süre.
//
// NEGATİF SONDALAR (2026-10-25, md5 ile birebir geri alındı):
//  ① bastırma kaldırıldı: sevkiyat konu anahtarına tur damgası eklendi (`<id>:<Date.now()>`) → §b ❌ (türde 4 ACILDI)
//  ② KK1 eşiği koşulda ayrı sabitle kopyalandı (`const ESIK = 85`) → §B2 ❌ (boğaz-ikiz)
//  ③ termin ikinci kez yazıldı (`r.deadline!.getTime() < now`) → §S ❌ (tek kaynak)
//  ④ 8040 satırı `period-guard.helper.ts` envanterinden silindi → `test_advisory_lock_namespaces` ❌
// Global ayar yazar (`bildirim.gelenKutusuEnabled`, `production.enabled`, `devere.enabled`); `finally`de döner.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as bcrypt from "bcryptjs";
import ts from "typescript";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS, readDevereEnabled } from "../src/services/system-setting.service";
import { runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import { runConditionSourceOnce } from "../src/jobs/notification-condition.job";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { renderNotification } from "../src/services/helpers/notification-render.helper";
import { loadNotificationVisibilityEnv } from "../src/services/helpers/notification-visibility.helper";
import { getNotificationEntry, type NotificationKind } from "../src/constants/notification-catalog";
import type { ModulKey } from "../src/constants/screen-catalog";
import { factoryDayEnd, factoryYmd } from "../src/constants/time";
import { getQualityScorecard } from "../src/services/reports/quality-scorecard.report.service";
import { getSubcontractScorecard } from "../src/services/reports/subcontract-scorecard.report.service";
import type { FinishForecastRow } from "../src/services/reports/levent-bitis-tahmini.report.service";
import type { OpenDispatchAgeRow } from "../src/services/helpers/subcontract-scorecard-query.helper";
import {
  WORK_CONDITION_KINDS,
  WORK_SOURCE_EVALUATORS,
  WORK_SOURCE_REAL_DEPS,
  overrideWorkSourceDeps,
  registerWorkConditionSources,
  type DeadlineOrderRow,
  type LateWorkOrderRow,
  type PlannedShipmentRow,
  type QualityDay,
  type WorkSourceDeps,
} from "../src/services/notification-sources/is";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ek = Date.now().toString(36);
const BASLANGIC = new Date(Date.now() - 1000);
const TURLER = WORK_CONDITION_KINDS as readonly string[];
const users: string[] = [];
const SAAT = 3_600_000;
const GUN = 24 * SAAT;
const SRC = join(__dirname, "..", "src");

// ── Sahte dünya ──────────────────────────────────────────────────────────────────────────────────
const ids = { o1: randomUUID(), o2: randomUUID(), wo: randomUUID(), item: randomUUID(), firma: randomUUID(), firma2: randomUUID(), sevk: randomUUID(), levent: randomUUID() };
const d = {
  now: Date.now(),
  orders: [] as DeadlineOrderRow[],
  wos: [] as LateWorkOrderRow[],
  quality: { topCode: "1K", byItem: [] } as QualityDay,
  dispatches: [] as OpenDispatchAgeRow[],
  shipments: [] as PlannedShipmentRow[],
  beams: [] as FinishForecastRow[],
  moduleOff: new Set<string>(),
  params: {} as Record<string, Record<string, unknown>>,
  firlat: false,
};
function okuyucu<T>(fn: () => T): T {
  if (d.firlat) throw new Error("sahte okuyucu hatası");
  return fn();
}
const qRow = (pct: number, qty: number) => ({ key: ids.item, label: `TEST-KUMAS ${ek}`, rollCount: 3, totalQty: qty, topGradeQty: (qty * pct) / 100, topGradePct: pct, qtyByGrade: {} });
const beam = (kalanGun: number | null) => ({
  beamId: ids.levent, beamNo: `LV-${ek}`, machine: { id: randomUUID(), code: `T-${ek}`, name: "Tezgah" }, position: 1,
  kalanM: 100, gunlukOrtM: 50, kaynak: { otomatik: 50, elle: 0 }, tahminiBitisGun: null, kalanGun, hesaplanamadi: null,
}) as FinishForecastRow;
const SAHTE: Partial<WorkSourceDeps> = {
  now: () => d.now,
  moduleOpen: async (kind) => okuyucu(() => !d.moduleOff.has(kind)),
  deadlineOrders: async (until) => okuyucu(() => d.orders.filter((o) => o.deadline !== null && o.deadline.getTime() <= until)),
  lateWorkOrders: async () => okuyucu(() => d.wos),
  qualityBetween: async () => okuyucu(() => d.quality),
  openDispatchAges: async () => okuyucu(() => d.dispatches),
  plannedShipments: async () => okuyucu(() => d.shipments),
  beamForecast: async () => okuyucu(() => d.beams),
  params: (kind) => ({ ...WORK_SOURCE_REAL_DEPS.params(kind), ...(d.params[kind] ?? {}) }),
};

async function kisi(ad: string, codes: string[]): Promise<string> {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (perms.length !== codes.length) throw new Error(`izin kataloğu eksik: ${codes.join(",")}`);
  const u = await prisma.user.create({
    data: { username: `tbki_${ad}_${ek}`.slice(0, 50), fullName: `TEST-BILDIRIM-IS ${ad} ${ek}`, passwordHash: await bcrypt.hash(randomUUID(), 4), isActive: true },
    select: { id: true },
  });
  users.push(u.id);
  for (const p of perms) await prisma.userPermission.create({ data: { userId: u.id, permissionId: p.id } });
  return u.id;
}

async function dagit(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await runNotificationDispatchOnce();
    if (r.processed === 0) break;
  }
}
async function tur(kind: NotificationKind): Promise<Awaited<ReturnType<typeof runConditionSourceOnce>>> {
  const r = await runConditionSourceOnce(kind);
  await dagit();
  return r;
}
const acikKosul = (kind: string, key: string) => prisma.notificationCondition.findFirst({ where: { kind, subjectKey: key, resolvedAt: null } });
const kutu = (userId: string, kind: string, key: string) =>
  prisma.notificationInbox.findMany({ where: { userId, kind, groupKey: { startsWith: `${kind}:${key}:` } }, orderBy: { createdAt: "asc" } });
const acildi = (kind: string, key: string) => prisma.notificationOutbox.count({ where: { kind, subjectKey: key, phase: "ACILDI", createdAt: { gte: BASLANGIC } } });
// Tür düzeyi: konu anahtarı tur başına değişse (bastırma kırılsa) de çift açılış görünür.
const acildiTur = (kind: string) => prisma.notificationOutbox.count({ where: { kind, phase: "ACILDI", createdAt: { gte: BASLANGIC } } });
const kapandi = (kind: string, key: string) => prisma.notificationOutbox.count({ where: { kind, subjectKey: key, phase: "KAPANDI", createdAt: { gte: BASLANGIC } } });
const acikSayisi = (kind: string) => prisma.notificationCondition.count({ where: { kind, resolvedAt: null } });

/** Türün modülü bu kurulumda görünür mü (değilse kutu satırı beklenmez; koşul/outbox yine ölçülür). */
async function gorunur(kind: NotificationKind): Promise<boolean> {
  const env = await loadNotificationVisibilityEnv(prisma, [kind]);
  return env.modules[getNotificationEntry(kind).modul as ModulKey] !== false;
}

async function yasamDongusu(o: { kind: NotificationKind; key: () => string; user: string; bozuk: () => void; saglam: () => void }): Promise<void> {
  const { kind, user } = o;
  const t = kind;
  const kutuVar = await gorunur(kind);
  if (!kutuVar) console.log(`   ⏭ ${t}: modül bu kurulumda görünmez (lisans tavanı?) — kutu satırı ölçülmez, koşul/outbox ölçülür`);
  o.bozuk();
  const key = o.key();
  const ra = await tur(kind);
  const k1 = await acikKosul(kind, key);
  const kA = await kutu(user, kind, key);
  check(`§a ${t}: bozulur → tek ACILDI${kutuVar ? " + tek kutu satırı" : ""}`,
    typeof ra === "object" && ra.opened === 1 && !!k1 && (await acildi(kind, key)) === 1 && (!kutuVar || (kA.length === 1 && kA[0]!.resolvedAt === null)),
    `${JSON.stringify(ra)} kutu=${kA.length}`);
  const sonuc: unknown[] = [];
  for (let i = 0; i < 3; i++) sonuc.push(await tur(kind));
  const kB = await kutu(user, kind, key);
  check(`§b ${t}: sürer (3 tur) → yeni ACILDI / kutu satırı yok`,
    sonuc.every((r) => typeof r === "object" && (r as { opened: number }).opened === 0) && (await acildiTur(kind)) === 1 && kB.length === (kutuVar ? 1 : 0),
    `${JSON.stringify(sonuc)} türde ACILDI=${await acildiTur(kind)} kutu=${kB.length}`);
  o.saglam();
  d.firlat = true;
  const re = await tur(kind);
  d.firlat = false;
  const k2 = k1 ? await prisma.notificationCondition.findUnique({ where: { id: k1.id } }) : null;
  check(`§e ${t}: okuyucu fırlatır → açık koşul AÇIK, KAPANDI yok`, re === "error" && !!k2 && k2.resolvedAt === null && (await kapandi(kind, key)) === 0, JSON.stringify(re));
  const rc = await tur(kind);
  const k3 = k1 ? await prisma.notificationCondition.findUnique({ where: { id: k1.id } }) : null;
  const kC = await kutu(user, kind, key);
  const payload = (k3?.payload ?? {}) as Record<string, unknown>;
  const kapali = renderNotification(kind, payload, "KAPANDI").govde;
  const acik = renderNotification(kind, payload, "ACILDI").govde;
  check(`§c ${t}: düzelir → KAPANDI, koşul resolvedAt, "Çözüldü" metni dolu`,
    typeof rc === "object" && rc.closed === 1 && !!k3?.resolvedAt && kapali !== acik && !kapali.includes("{") && !acik.includes("{")
      && (!kutuVar || (kC.length === 1 && kC[0]!.resolvedAt !== null)),
    `${JSON.stringify(rc)} açık="${acik}" kapalı="${kapali}"`);
  o.bozuk();
  await tur(kind);
  const k4 = await acikKosul(kind, o.key());
  check(`§d ${t}: yeniden bozulur → YENİ koşul (id farklı)`, !!k4 && k4.id !== k1?.id, `${k4?.id ?? "-"}`);
  o.saglam();
  await tur(kind);
}

async function ayar(key: string, v: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

// ── §B / §S statik denetimler ───────────────────────────────────────────────────────────────────
function dosyalar(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? dosyalar(p) : p.endsWith(".ts") ? [p] : [];
  });
}

function statik(): void {
  const isYol = join(SRC, "services/notification-sources/is.ts");
  const isKod = readFileSync(isYol, "utf8");
  const karne = readFileSync(join(SRC, "services/reports/quality-scorecard.report.service.ts"), "utf8");
  const fasonQ = readFileSync(join(SRC, "services/helpers/subcontract-scorecard-query.helper.ts"), "utf8");
  // B1 · aynı fonksiyonlar iki tarafta: karne + koşul `qualityByItem`/`collectPeriod`; fason iki okuyucu aynı FROM…WHERE.
  check("§B1 KK1: karne ve koşul aynı helper'ı çağırır (qualityByItem + collectPeriod), koşulda ham SQL yok",
    /qualityByItem\(/.test(karne) && /collectPeriod\(/.test(karne) && /qualityByItem\(/.test(isKod) && /collectPeriod\(/.test(isKod)
      && !/\$queryRaw|\$executeRaw|Prisma\.sql/.test(isKod) && /from "\.\.\/helpers\/quality-first-share\.helper"/.test(isKod));
  check("§B1 fason: karne listesi ve koşul okuyucusu AYNI açık kalem parçasını kullanır",
    (fasonQ.match(/\$\{openDispatchItemsSql\(/g) ?? []).length === 2 && /queryOpenDispatchAges/.test(isKod));
  check("§B1 levent: koşul `finishForecastReport`u doğrudan çağırır", /finishForecastReport\(\{\}\)/.test(isKod));
  // B2 · eşik kopyası yok: is.ts'te sayı sabiti yalnız beyanlı küme (eşikler katalog paramSemasi'ndan).
  const izinli = new Set([0, 1, 100, 300_000, 86_400_000]);
  const sf = ts.createSourceFile(isYol, isKod, ts.ScriptTarget.Latest, true);
  const yabanci: string[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isNumericLiteral(n) && !izinli.has(Number(n.text))) yabanci.push(`${n.text}@${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    ts.forEachChild(n, gez);
  };
  gez(sf);
  check("§B2 is.ts'te eşik/parametre kopyası yok (sayı sabiti ⊂ {0,1,100,300000,86400000})", yabanci.length === 0, yabanci.join(", "));
  const paramAdlari = WORK_CONDITION_KINDS.flatMap((k) => Object.keys((getNotificationEntry(k).paramSemasi?.parse({}) ?? {}) as object));
  check("§B2 her katalog parametresi is.ts'te `num(kind, \"<ad>\")` ile okunur",
    paramAdlari.every((p) => isKod.includes(`num(kind, "${p}")`)), paramAdlari.join(","));
  // §S · termin tanımı TEK: helper dışında termini "şimdi" ile kıyaslayan ifade ve açık durum üçlüsü + termin birlikte yok.
  const helper = join(SRC, "services/helpers/order-deadline.helper.ts");
  const kiyas = /deadline!?\??\.getTime\(\)\s*(<|>|-)|now\w*\s*(<|>|-)\s*[\w.!?]*deadline|[<>]=?\s*[\w.!?]*deadline!?\??\.getTime\(\)/;
  const ihlal: string[] = [];
  for (const f of dosyalar(SRC)) {
    if (f === helper) continue;
    const k = readFileSync(f, "utf8");
    if (kiyas.test(k)) ihlal.push(`${f.slice(SRC.length + 1)} (termin kıyası)`);
    if (/OrderStatus\.PENDING,\s*OrderStatus\.APPROVED,\s*OrderStatus\.PARTIAL_SHIPPED/.test(k) && /deadline/.test(k)) ihlal.push(`${f.slice(SRC.length + 1)} (açık durum üçlüsü + termin)`);
  }
  check("§S termin yüklemi yalnız order-deadline.helper'da (kıyas + açık durum kümesi)", ihlal.length === 0, ihlal.join(" · "));
}

async function govde(): Promise<void> {
  const kalan = await prisma.notificationCondition.count({ where: { kind: { in: [...TURLER] }, resolvedAt: null } });
  if (kalan > 0) throw new Error(`ön koşul: bu türlerde ${kalan} açık koşul var (önceki koşumun kalıntısı?)`);
  statik();
  await ayar(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, true);
  await ayar(SETTING_KEYS.PRODUCTION_ENABLED, true);
  await ayar(SETTING_KEYS.DEVERE_ENABLED, true);
  registerWorkConditionSources();
  const geri = overrideWorkSourceDeps(SAHTE);
  try {
    const kim = await kisi("yon", ["order:read", "order:write", "workorder:read", "workorder:write", "report:quality", "quality:write",
      "report:subcontract", "shipping:read", "shipping:write", "warpbeam:read", "warpbeam:write"]);
    const ord = (id: string, deadlineMs: number): DeadlineOrderRow => ({ id, orderNumber: `SIP-${ek}-${id.slice(0, 4)}`, deadline: new Date(deadlineMs), customerName: "TEST MUSTERI" });

    // ── Yaşam döngüleri ─────────────────────────────────────────────────────
    await yasamDongusu({ kind: "siparis.termin-yaklasti", key: () => ids.o1, user: kim,
      bozuk: () => { d.orders = [ord(ids.o1, d.now + 2 * GUN)]; }, saglam: () => { d.orders = [ord(ids.o1, d.now + 9 * GUN)]; } });
    await yasamDongusu({ kind: "siparis.termin-gecti", key: () => ids.o2, user: kim,
      bozuk: () => { d.orders = [ord(ids.o2, d.now - GUN)]; }, saglam: () => { d.orders = []; } });
    await yasamDongusu({ kind: "isemri.gecikti", key: () => ids.wo, user: kim,
      bozuk: () => { d.wos = [{ id: ids.wo, workOrderNumber: `IE-${ek}`, plannedEndDate: new Date(d.now - SAAT) }]; }, saglam: () => { d.wos = []; } });
    await yasamDongusu({ kind: "kalite.kk1-oran-dusuk", key: () => `${ids.item}:${factoryYmd(new Date(d.now))}`, user: kim,
      bozuk: () => { d.quality = { topCode: "1K", byItem: [qRow(70, 300)] }; }, saglam: () => { d.quality = { topCode: "1K", byItem: [qRow(92, 300)] }; } });
    await yasamDongusu({ kind: "fason.donus-gecikti", key: () => ids.firma, user: kim,
      bozuk: () => { d.dispatches = [{ dispatchId: randomUUID(), subcontractorId: ids.firma, subcontractorName: `FASON ${ek}`, daysOpen: 12.4, openItems: 2 }]; },
      saglam: () => { d.dispatches = [{ dispatchId: randomUUID(), subcontractorId: ids.firma, subcontractorName: `FASON ${ek}`, daysOpen: 4, openItems: 2 }]; } });
    await yasamDongusu({ kind: "sevkiyat.onay-bekliyor", key: () => ids.sevk, user: kim,
      bozuk: () => { d.shipments = [{ id: ids.sevk, shipmentNo: `SVK-${ek}`, customerName: "TEST MUSTERI" }]; }, saglam: () => { d.shipments = []; } });
    await yasamDongusu({ kind: "dokuma.levent-bitiyor", key: () => ids.levent, user: kim,
      bozuk: () => { d.beams = [beam(0.6)]; }, saglam: () => { d.beams = [beam(3)]; } });

    // ── §T termin yaklaştı → geçti ──────────────────────────────────────────
    const t0 = d.now;
    d.orders = [ord(ids.o1, d.now + 2 * GUN)];
    await tur("siparis.termin-yaklasti");
    await tur("siparis.termin-gecti");
    const tA = [await acikKosul("siparis.termin-yaklasti", ids.o1), await acikKosul("siparis.termin-gecti", ids.o1)];
    d.now = t0 + 3 * GUN;
    const ry = await tur("siparis.termin-yaklasti");
    const rg = await tur("siparis.termin-gecti");
    const tB = [await acikKosul("siparis.termin-yaklasti", ids.o1), await acikKosul("siparis.termin-gecti", ids.o1)];
    const gp = (tB[1]?.payload ?? {}) as Record<string, unknown>;
    check("§T termin geçince: yaklaştı KAPANIR, geçti AÇILIR (aynı sipariş konusu)",
      !!tA[0] && !tA[1] && typeof ry === "object" && ry.closed === 1 && typeof rg === "object" && rg.opened === 1 && !tB[0] && !!tB[1] && typeof gp.termin === "string" && /^\d{2}\.\d{2}\.\d{4}$/.test(String(gp.termin)),
      `yaklaştı=${JSON.stringify(ry)} geçti=${JSON.stringify(rg)} termin=${String(gp.termin)}`);
    d.orders = [];
    await tur("siparis.termin-gecti");
    d.now = t0;
    // Sınır: termin tam `gun` gün sonra → yaklaştı (≤); bir saat fazlası → değil.
    d.orders = [ord(ids.o1, d.now + 3 * GUN)];
    const s1 = await WORK_SOURCE_EVALUATORS["siparis.termin-yaklasti"]();
    d.orders = [ord(ids.o1, d.now + 3 * GUN + SAAT)];
    const s2 = await WORK_SOURCE_EVALUATORS["siparis.termin-yaklasti"]();
    d.orders = [];
    check("§T2 yaklaştı penceresi: termin = şimdi + gun → var; + 1 saat → yok", s1.length === 1 && s2.length === 0, `${s1.length}/${s2.length}`);

    // ── §K KK1 fabrika günü dönüşü + sınırlar ─────────────────────────────────
    d.quality = { topCode: "1K", byItem: [qRow(70, 300)] };
    await tur("kalite.kk1-oran-dusuk");
    const gun1 = `${ids.item}:${factoryYmd(new Date(d.now))}`;
    const kGun1 = await acikKosul("kalite.kk1-oran-dusuk", gun1);
    d.now = factoryDayEnd(new Date(t0)).getTime() + SAAT;
    const rk = await tur("kalite.kk1-oran-dusuk");
    const gun2 = `${ids.item}:${factoryYmd(new Date(d.now))}`;
    check("§K fabrika günü döner → dünkü konu KAPANIR, bugünkü (yeni anahtar) AÇILIR",
      !!kGun1 && gun1 !== gun2 && typeof rk === "object" && rk.closed === 1 && rk.opened === 1 && !!(await acikKosul("kalite.kk1-oran-dusuk", gun2)),
      `${gun1.slice(-10)} → ${gun2.slice(-10)} ${JSON.stringify(rk)}`);
    d.quality = { topCode: null, byItem: [] };
    const rRol = await tur("kalite.kk1-oran-dusuk");
    check("§K2 1. kalite rolü yok (ölçülemez) → açık koşul KORUNUR", typeof rRol === "object" && rRol.closed === 0 && !!(await acikKosul("kalite.kk1-oran-dusuk", gun2)), JSON.stringify(rRol));
    d.quality = { topCode: "1K", byItem: [qRow(70, 199)] };
    const rMin = await tur("kalite.kk1-oran-dusuk");
    check("§K3 metraj < minMetre (199 < 200) → koşul yok (kapanır)", typeof rMin === "object" && rMin.closed === 1 && (await acikSayisi("kalite.kk1-oran-dusuk")) === 0, JSON.stringify(rMin));
    d.quality = { topCode: "1K", byItem: [qRow(85, 300)] };
    const sEsik = await WORK_SOURCE_EVALUATORS["kalite.kk1-oran-dusuk"]();
    d.params["kalite.kk1-oran-dusuk"] = { oranYuzde: 90 };
    const sParam = await WORK_SOURCE_EVALUATORS["kalite.kk1-oran-dusuk"]();
    delete d.params["kalite.kk1-oran-dusuk"];
    check("§K4 oran = eşik (85) → yok; parametre 90'a çıkınca → var (eşik paramSemasi'ndan)", sEsik.length === 0 && sParam.length === 1 && sParam[0]!.payload.esik === "%90", `${sEsik.length}/${sParam.length} ${JSON.stringify(sParam[0]?.payload ?? {})}`);
    d.quality = { topCode: "1K", byItem: [] };
    d.now = t0;

    // ── §F fason sınırı + firma kırılımı ──────────────────────────────────────
    d.dispatches = [
      { dispatchId: randomUUID(), subcontractorId: ids.firma, subcontractorName: `FASON ${ek}`, daysOpen: 10, openItems: 1 },
      { dispatchId: randomUUID(), subcontractorId: ids.firma2, subcontractorName: `FASON2 ${ek}`, daysOpen: 10.5, openItems: 2 },
      { dispatchId: randomUUID(), subcontractorId: ids.firma2, subcontractorName: `FASON2 ${ek}`, daysOpen: 15.9, openItems: 3 },
    ];
    const sf = await WORK_SOURCE_EVALUATORS["fason.donus-gecikti"]();
    d.dispatches = [];
    check("§F daysOpen = gun (10) gecikme değil; aynı firmanın iki sevki TEK konu (5 kalem, en eski 15 gün)",
      sf.length === 1 && sf[0]!.key === ids.firma2 && sf[0]!.payload.acikKalem === "5" && sf[0]!.payload.enEskiGun === "15", JSON.stringify(sf.map((s) => s.payload)));

    // ── §L levent parametre sınırı ───────────────────────────────────────────
    d.beams = [beam(1)];
    const l1 = await WORK_SOURCE_EVALUATORS["dokuma.levent-bitiyor"]();
    d.beams = [beam(1.05)];
    const l2 = await WORK_SOURCE_EVALUATORS["dokuma.levent-bitiyor"]();
    d.params["dokuma.levent-bitiyor"] = { kalanGun: 2 };
    const l3 = await WORK_SOURCE_EVALUATORS["dokuma.levent-bitiyor"]();
    delete d.params["dokuma.levent-bitiyor"];
    d.beams = [beam(null)];
    const l4 = await WORK_SOURCE_EVALUATORS["dokuma.levent-bitiyor"]();
    d.beams = [];
    check("§L kalanGun = 1 → var; 1,05 → yok; param 2 → var; tahmin yok (null) → yok; payload leventNo",
      l1.length === 1 && l2.length === 0 && l3.length === 1 && l4.length === 0 && l1[0]!.payload.leventNo === `LV-${ek}` && l1[0]!.payload.kalanGun === "1",
      `${l1.length}/${l2.length}/${l3.length}/${l4.length}`);

    // ── §G modül kapalı → küme boş, açık koşul kapanır ─────────────────────────
    d.beams = [beam(0.5)];
    await tur("dokuma.levent-bitiyor");
    const gA = await acikSayisi("dokuma.levent-bitiyor");
    d.moduleOff.add("dokuma.levent-bitiyor");
    const rG = await tur("dokuma.levent-bitiyor");
    d.moduleOff.clear();
    d.beams = [];
    check("§G modül kapalı → koşul kümesi boş (açık olan kapanır)", gA === 1 && typeof rG === "object" && rG.closed === 1 && (await acikSayisi("dokuma.levent-bitiyor")) === 0, JSON.stringify(rG));

    // ── §Y gelen kutusu bayrağı kapalı → koşul tablosu boş ─────────────────────
    d.orders = [ord(ids.o2, d.now - GUN)];
    d.shipments = [{ id: ids.sevk, shipmentNo: `SVK-${ek}`, customerName: "X" }];
    d.beams = [beam(0.5)];
    await ayar(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, false);
    const yR: unknown[] = [];
    for (const kind of WORK_CONDITION_KINDS) yR.push(await runConditionSourceOnce(kind));
    const yAcik = await prisma.notificationCondition.count({ where: { kind: { in: [...TURLER] }, resolvedAt: null } });
    await ayar(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, true);
    d.orders = []; d.shipments = []; d.beams = [];
    for (const kind of WORK_CONDITION_KINDS) await tur(kind);
    check("§Y bayrak kapalı → yedi tur `disabled`, koşul tablosu boş", yR.every((r) => r === "disabled") && yAcik === 0, `${JSON.stringify(yR)} açık=${yAcik}`);

    // ── §R gerçek modül kapısı ───────────────────────────────────────────────
    geri();
    const cekirdek = await WORK_SOURCE_REAL_DEPS.moduleOpen("sevkiyat.onay-bekliyor");
    const fason = await WORK_SOURCE_REAL_DEPS.moduleOpen("fason.donus-gecikti");
    await ayar(SETTING_KEYS.DEVERE_ENABLED, false);
    const leventKapali = await WORK_SOURCE_REAL_DEPS.moduleOpen("dokuma.levent-bitiyor");
    const okuyucuKapali = await readDevereEnabled();
    await ayar(SETTING_KEYS.DEVERE_ENABLED, true);
    const leventAcik = await WORK_SOURCE_REAL_DEPS.moduleOpen("dokuma.levent-bitiyor");
    check("§R gerçek kapı: çekirdek/planlanan hep açık; levent = readDevereEnabled (kapalı → kapalı)",
      cekirdek && fason && leventKapali === okuyucuKapali && !leventKapali && leventAcik === (await readDevereEnabled()),
      `çekirdek=${cekirdek} fason=${fason} devere kapalı=${leventKapali} açık=${leventAcik}`);

    // ── §B3 çıktı karşılaştırması (gerçek okuyucu ↔ karne) ─────────────────────
    const now = new Date();
    const from = new Date(now.getTime() - 400 * GUN);
    const kq = await WORK_SOURCE_REAL_DEPS.qualityBetween(from, now);
    const karne = await getQualityScorecard({ from, to: now });
    check("§B3 KK1 okuyucusunun kumaş kırılımı = karnenin byItem'ı (bayt-eşit JSON)",
      JSON.stringify(kq.byItem) === JSON.stringify(karne.byItem) && kq.topCode === karne.topGradeCode, `${kq.byItem.length} satır`);
    const yaslar = await WORK_SOURCE_REAL_DEPS.openDispatchAges();
    const fk = await getSubcontractScorecard({ from, to: now });
    const esles = fk.oldestOpen.every((r) => {
      const y = yaslar.find((a) => a.dispatchId === r.dispatchId);
      return !!y && y.openItems === r.openItems && Math.abs(y.daysOpen - r.daysOpen) < 0.1;
    });
    check("§B3 fason: karnenin açık listesindeki her sevk koşul okuyucusunda aynı kalem/yaşla var",
      esles && yaslar.length >= fk.oldestOpen.length, `karne ${fk.oldestOpen.length} · okuyucu ${yaslar.length}${fk.oldestOpen.length === 0 ? " (⚠️ DB'de açık sevk yok — eşitlik boş kümede)" : ""}`);

    // ── §M ölçüm: gerçek okuyucularla her evaluate ───────────────────────────
    for (const kind of WORK_CONDITION_KINDS) {
      const t1 = process.hrtime.bigint();
      let not = "";
      try {
        not = `${(await WORK_SOURCE_EVALUATORS[kind]()).length} konu`;
      } catch (err) {
        not = `fırlattı (${(err as Error).message.slice(0, 60)})`;
        check(`§M ${kind} gerçek okuyucu fırlatmaz`, false, not);
      }
      const ms = Number(process.hrtime.bigint() - t1) / 1e6;
      console.log(`   ⓘ ÖLÇÜM: ${kind} evaluate ${ms.toFixed(1)} ms — ${not}`);
    }
  } finally {
    geri();
  }
}

async function temizle(): Promise<void> {
  try {
    await prisma.notificationInbox.deleteMany({ where: { OR: [{ userId: { in: users } }, { kind: { in: [...TURLER] }, createdAt: { gte: BASLANGIC } }] } });
    await prisma.notificationOutbox.deleteMany({ where: { kind: { in: [...TURLER] }, createdAt: { gte: BASLANGIC } } });
    await prisma.notificationCondition.deleteMany({ where: { kind: { in: [...TURLER] }, createdAt: { gte: BASLANGIC } } });
    if (users.length > 0) {
      await prisma.userPermission.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
  } catch (err) {
    fail++;
    console.error("❌ temizlik başarısız", err);
  }
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim — iş koşul kaynakları (tür 6–12) ===\n");
  const keys = [SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DEVERE_ENABLED];
  const ilk = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  try {
    await govde();
  } finally {
    stopNotificationJobs();
    await temizle();
    for (const key of keys) {
      const v = ilk.find((r) => r.key === key);
      if (v) await prisma.systemSetting.update({ where: { key }, data: { value: v.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
}

main()
  .catch((err) => {
    fail++;
    console.error("❌ beklenmeyen hata", err);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
