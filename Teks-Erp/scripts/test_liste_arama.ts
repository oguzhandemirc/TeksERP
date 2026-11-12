// =============================================================================
// BEKÇİ — liste uçlarının sunucu araması (2026-11-12, "liste arama" turu)
// =============================================================================
// Her uç için: arama eşleşeni döndürür · eşleşmeyeni döndürmez · sayaç/özet aynı
// where'den (arama toplamı da süzer) · boş arama = tüm liste · uzun arama 400 ·
// izin kapısı aynen (route kaynağında, sunucusuz). Servisler doğrudan çağrılır.
// Fikstür `TEST-LA…` damgalı, temizlik `finally`de FK sırasıyla.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AppError } from "../src/utils/app-error";
import { LIST_SEARCH_MAX, listSearchParam, matchesListSearch, readListSearch } from "../src/utils/list-search";
import { cashBoxService, exchangeRateService } from "../src/routes/finance.routes";
import { periodCloseService } from "../src/services/period-close.service";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { listShiftDefinitions } from "../src/services/shift-definition.service";
import { MachineCollectorService } from "../src/services/machine-collector.service";
import { listMachineStops } from "../src/services/loom-list.service";
import { listLoomAlarms } from "../src/services/loom-alarm-read.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const TAG = `TEST-LA${Date.now().toString(36).toUpperCase()}`;
const LONG = "x".repeat(LIST_SEARCH_MAX + 1);
const req = (query: Record<string, string>): Request => ({ query, user: { userId: "00000000-0000-0000-0000-000000000000", permissions: [] } } as unknown as Request);
const ROUTES = join(__dirname, "..", "src", "routes");

/** Route kaynağında `router.get("<yol>"` satırının izin kapısını içerdiği (kapı aynen kaldı). */
function guardOf(file: string, path: string): string {
  const src = readFileSync(join(ROUTES, file), "utf8");
  const i = src.indexOf(`router.get("${path}"`);
  return i < 0 ? "" : src.slice(i, src.indexOf("\n", i));
}
async function status400(fn: () => unknown): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return (e instanceof AppError && e.statusCode === 400) || (e as { name?: string })?.name === "ZodError";
  }
}
type Paged = { data: Array<Record<string, unknown>>; pagination: { total: number } };

const cleanup: Array<() => Promise<unknown>> = [];

async function ortak(): Promise<void> {
  console.log("\n— §0 ortak yardımcı —");
  check("§0a boş/boşluk = arama yok", readListSearch("  ") === undefined && listSearchParam.parse("") === undefined);
  check("§0b uzun arama 400 (zod + elle)", !listSearchParam.safeParse(LONG).success && (await status400(() => readListSearch(LONG))));
  check("§0c dizi arama 400", await status400(() => readListSearch(["a", "b"])));
  check("§0d bellek ikizi Türkçe katlar + kelimeler AND", matchesListSearch("sahin ISIK", ["Şahin", "Işık Örme"]) && !matchesListSearch("sahin yok", ["Şahin"]));
}

async function finans(): Promise<void> {
  console.log("\n— §F finans —");
  // §F1 Kurlar — metin kolonu yok; arama para birimi/kaynak etiketine eşlenir.
  const day = (d: number): Date => new Date(Date.UTC(1990, 0, 1 + d));
  const base = Math.floor(Math.random() * 3000);
  const rates = await Promise.all([
    prisma.exchangeRate.create({ data: { rateDate: day(base), currency: "USD", rate: 1, source: "TCMB" }, select: { id: true } }),
    prisma.exchangeRate.create({ data: { rateDate: day(base), currency: "RUB", rate: 1, source: "MANUAL" }, select: { id: true } }),
  ]);
  cleanup.push(() => prisma.exchangeRate.deleteMany({ where: { id: { in: rates.map((r) => r.id) } } }));
  const rq = (search?: string): Request =>
    req({ dateField: "rateDate", dateFrom: day(base).toISOString(), dateTo: day(base).toISOString(), ...(search !== undefined ? { search } : {}) });
  const rAll = (await exchangeRateService.findAll(rq())) as Paged;
  const rRub = (await exchangeRateService.findAll(rq("ruble"))) as Paged;
  const rUsd = (await exchangeRateService.findAll(rq("usd"))) as Paged;
  const rElle = (await exchangeRateService.findAll(rq("elle"))) as Paged;
  const rNone = (await exchangeRateService.findAll(rq("zzqq"))) as Paged;
  check("§F1a kur: boş arama = ikisi", rAll.data.length === 2 && rAll.pagination.total === 2);
  check("§F1b kur: 'ruble' yalnız RUB; toplam da süzülür", rRub.data.length === 1 && rRub.data[0]?.currency === "RUB" && rRub.pagination.total === 1);
  check("§F1c kur: 'usd' yalnız USD; 'elle' yalnız MANUAL", rUsd.data.length === 1 && rUsd.data[0]?.currency === "USD" && rElle.data.length === 1 && rElle.data[0]?.source === "MANUAL");
  check("§F1d kur: eşleşmeyen terim 0 satır", rNone.data.length === 0 && rNone.pagination.total === 0);
  check("§F1e kur: uzun arama 400", await status400(() => exchangeRateService.findAll(rq(LONG))));
  check("§F1f kur: izin kapısı aynen finance:read", guardOf("finance.routes.ts", "/exchange-rates").includes('requirePermission("finance:read")'));

  // §F2 Kasa — uç zaten aramalıydı (panel bağlandı); Türkçe katlama + kod.
  const cb = await prisma.cashBox.create({ data: { code: TAG.slice(0, 32), name: `${TAG} Şişli Kasası`, currency: "TRY" }, select: { id: true } });
  cleanup.push(() => prisma.cashBox.deleteMany({ where: { id: cb.id } }));
  const kq = (search: string): Request => req({ search, pageSize: "500" });
  const kHit = (await cashBoxService.findAll(kq("sisli kasasi"))) as Paged;
  const kMiss = (await cashBoxService.findAll(kq(`${TAG} yokboyle`))) as Paged;
  check("§F2a kasa: 'sisli kasasi' Şişli Kasası'nı bulur", kHit.data.some((r) => r.id === cb.id));
  check("§F2b kasa: eşleşmeyen terim bulmaz", !kMiss.data.some((r) => r.id === cb.id));
  check("§F2c kasa: izin kapısı aynen finance:read", guardOf("finance.routes.ts", "/cash-boxes").includes('requirePermission("finance:read")'));

  // §F3 Dönem kapanışı — cari adı/kodu + not.
  const cust = await prisma.customer.create({ data: { code: `${TAG}-PC`, name: `${TAG} Güneş Örme` }, select: { id: true } });
  const cari = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust.id }, select: { id: true } });
  const pcs = await Promise.all([
    prisma.cariPeriodClose.create({ data: { cariId: cari.id, currency: "TRY", periodEnd: day(base), closingBalance: 0, txnCount: 0, notes: "yıl sonu" }, select: { id: true } }),
    prisma.cariPeriodClose.create({ data: { cariId: cari.id, currency: "USD", periodEnd: day(base), closingBalance: 0, txnCount: 0, notes: "çeyrek" }, select: { id: true } }),
  ]);
  cleanup.push(async () => {
    await prisma.cariPeriodClose.deleteMany({ where: { id: { in: pcs.map((p) => p.id) } } });
    await prisma.cariAccount.deleteMany({ where: { id: cari.id } });
    await prisma.customer.deleteMany({ where: { id: cust.id } });
  });
  const pAll = await periodCloseService.list({ cariId: cari.id });
  const pName = await periodCloseService.list({ search: "gunes orme", pageSize: 200 });
  const pCode = await periodCloseService.list({ search: `${TAG}-PC`.toLowerCase(), pageSize: 200 });
  const pNote = await periodCloseService.list({ cariId: cari.id, search: "YIL SONU" });
  const pMiss = await periodCloseService.list({ cariId: cari.id, search: "zzqq" });
  const mine = (r: { data: Array<{ cariId: string }> }): number => r.data.filter((x) => x.cariId === cari.id).length;
  check("§F3a kapanış: boş arama = cari'nin iki kaydı", pAll.data.length === 2 && pAll.pagination.total === 2);
  check("§F3b kapanış: cari adı katlanarak ('gunes orme') ikisini bulur", mine(pName) === 2);
  check("§F3c kapanış: cari kodu küçük harfle bulur", mine(pCode) === 2);
  check("§F3d kapanış: not araması (gölgesiz yol, büyük harf) yalnız eşleşeni + toplam süzülür", pNote.data.length === 1 && pNote.pagination.total === 1);
  check("§F3e kapanış: eşleşmeyen 0 (toplam 0)", pMiss.data.length === 0 && pMiss.pagination.total === 0);
  check("§F3f kapanış: route şeması search alır, izin aynen finance:read", /search: listSearchParam/.test(readFileSync(join(ROUTES, "finance-period.routes.ts"), "utf8")) && guardOf("finance-period.routes.ts", "/").includes('requirePermission("finance:read")'));
}

async function satinAlma(): Promise<void> {
  console.log("\n— §S satın alma —");
  // §S1 Bekleyen kalemler — sipariş no (kod), ürün adı (Fold)/kodu, tedarikçi adı.
  const sup = await prisma.customer.create({ data: { code: `${TAG}-TD`, name: `${TAG} Çınar İplik` }, select: { id: true } });
  const it1 = await prisma.item.create({ data: { code: `${TAG}-K1`, name: `${TAG} Gömleklik Poplin`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const it2 = await prisma.item.create({ data: { code: `${TAG}-K2`, name: `${TAG} Astar`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const po = await prisma.purchaseOrder.create({
    data: { orderNo: `${TAG}-PO`, orderDate: new Date(), status: "OPEN", supplierId: sup.id, lines: { create: [{ lineNo: 1, itemId: it1.id, qty: 100 }, { lineNo: 2, itemId: it2.id, qty: 50 }] } },
    select: { id: true },
  });
  cleanup.push(async () => {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: po.id } });
    await prisma.purchaseOrder.deleteMany({ where: { id: po.id } });
    await prisma.item.deleteMany({ where: { id: { in: [it1.id, it2.id] } } });
    await prisma.customer.deleteMany({ where: { id: sup.id } });
  });
  const ol = (search?: string) => purchaseOrderService.openLines({ supplierId: sup.id, search, limit: 500 });
  const oAll = await ol();
  const oItem = await ol("gomleklik");
  const oNo = await ol(`${TAG}-po`);
  const oSup = await purchaseOrderService.openLines({ search: "cinar iplik", limit: 500 });
  const oMiss = await ol("zzqq");
  const supHits = (oSup.rows as Array<{ purchaseOrder: { id: string } }>).filter((r) => r.purchaseOrder.id === po.id).length;
  check("§S1a kalem: boş arama = iki kalem", oAll.rows.length === 2 && oAll.total === 2);
  check("§S1b kalem: ürün adı katlanarak yalnız eşleşen; toplam süzülür", oItem.rows.length === 1 && oItem.total === 1);
  check("§S1c kalem: sipariş no (küçük harf) ikisini bulur", oNo.rows.length === 2);
  check("§S1d kalem: tedarikçi adı ('cinar iplik') ikisini bulur", supHits === 2);
  check("§S1e kalem: eşleşmeyen 0 (toplam 0)", oMiss.rows.length === 0 && oMiss.total === 0);
  const poSrc = readFileSync(join(ROUTES, "purchase-order.routes.ts"), "utf8");
  check("§S1f kalem: route şeması search alır, izin aynen READ_PERMS", /search: listSearchParam/.test(poSrc) && guardOf("purchase-order.routes.ts", "/open-lines").includes("requireAnyPermission(...READ_PERMS)"));
}

async function dokuma(): Promise<void> {
  console.log("\n— §D üretim/dokuma —");
  const ek = TAG.slice(-6);
  // §D1 Vardiya tanımları — kod + katlanmış ad.
  const sh = await prisma.shiftDefinition.create({ data: { code: `V${ek}`, name: `${TAG} Gündüz Işığı`, startMinute: 480, durationMinutes: 480 }, select: { id: true } });
  cleanup.push(() => prisma.shiftDefinition.deleteMany({ where: { id: sh.id } }));
  const sAll = await listShiftDefinitions({ includeInactive: true });
  const sHit = await listShiftDefinitions({ includeInactive: true, search: "gunduz isigi" });
  const sCode = await listShiftDefinitions({ includeInactive: true, search: `v${ek}`.toLowerCase() });
  const sMiss = await listShiftDefinitions({ includeInactive: true, search: `${TAG} zzqq` });
  check("§D1a vardiya: boş arama = tüm liste (fikstür dahil)", sAll.data.some((r) => r.id === sh.id) && sAll.data.length >= sHit.data.length);
  check("§D1b vardiya: ad katlanarak + kod küçük harfle bulur", sHit.data.some((r) => r.id === sh.id) && sCode.data.some((r) => r.id === sh.id));
  check("§D1c vardiya: eşleşmeyen bulmaz", !sMiss.data.some((r) => r.id === sh.id));
  check("§D1d vardiya: izin kapısı aynen", guardOf("shift-definition.routes.ts", "/").includes('requireAnyPermission("loom:spec-manage", "report:production")'));

  // Tezgah fikstürü (kart, duruş, alarm ortak).
  // Temizlik yaratımdan ÖNCE bağlanır: yarıda kalan koşu kalıntı bırakmasın (tezgaha bağlı her şey tezgah id'siyle silinir).
  const machineIds: string[] = [];
  let stationId: string | undefined;
  cleanup.push(async () => {
    await prisma.loomAlarm.deleteMany({ where: { machineId: { in: machineIds } } });
    await prisma.machineStopEvent.deleteMany({ where: { machineId: { in: machineIds } } });
    await prisma.machineCollector.deleteMany({ where: { collectorKey: `${TAG}-K` } });
    await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
    if (stationId) await prisma.station.deleteMany({ where: { id: stationId } });
  });
  const st = await prisma.station.create({ data: { name: `${TAG} Hol Çiçek`, code: `${TAG}-H`.slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true }, select: { id: true } });
  stationId = st.id;
  const m1 = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG} Tezgâh Şimşek`, code: `LA${ek}-T1`, isActive: true }, select: { id: true } });
  const m2 = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG} Tezgâh Yıldız`, code: `LA${ek}-T2`, isActive: true }, select: { id: true } });
  machineIds.push(m1.id, m2.id);
  const col = await prisma.machineCollector.create({ data: { collectorKey: `${TAG}-K`, name: `${TAG} Kart Öncü`, machines: { create: [{ machineId: m1.id }] } }, select: { id: true } });
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const stops = await Promise.all(
    [m1.id, m2.id].map((machineId, i) =>
      prisma.machineStopEvent.create({ data: { machineId, stopKey: randomUUID(), startedAt: new Date(now.getTime() - 60_000 * (i + 1)), factoryDay: day, source: "OPERATOR", reasonCode: i === 0 ? "LA_KOPUK" : null }, select: { id: true, machineId: true } })
    )
  );
  const alarms = await Promise.all(
    stops.map((s) => prisma.loomAlarm.create({ data: { kind: "STOP_OVERDUE", stopEventId: s.id, machineId: s.machineId, tier: 1, targetMinutes: 10, graceMinutes: 5, k1DueAt: now, k2DueAt: new Date(now.getTime() + 3_600_000) }, select: { id: true } }))
  );

  // §D2 Tezgah kartları — kart adı + bağlı tezgah kodu/adı.
  const cHit = (await MachineCollectorService.list("kart oncu")).data;
  const cMach = (await MachineCollectorService.list("simsek")).data;
  const cMiss = (await MachineCollectorService.list("yildiz")).data;
  const cAll = (await MachineCollectorService.list()).data;
  check("§D2a kart: kart adı katlanarak bulur", cHit.some((r) => r.id === col.id));
  check("§D2b kart: bağlı tezgah adıyla bulur, bağlı olmayan tezgah adıyla bulmaz", cMach.some((r) => r.id === col.id) && !cMiss.some((r) => r.id === col.id));
  check("§D2c kart: boş arama = tüm liste", cAll.some((r) => r.id === col.id) && cAll.length >= cHit.length);
  check("§D2d kart: izin kapısı aynen (guard)", guardOf("machine-collector.routes.ts", "/").includes("guard,"));

  // §D3 Tezgah duruşları — tezgah kodu/adı + sebep kodu; günle birlikte.
  const dq = (search?: string) => listMachineStops({ factoryDay: day.toISOString().slice(0, 10), stationKinds: ["WEAVING"], search, limit: 500 });
  const mine = (r: { data: Array<{ id: string }> }) => r.data.filter((x) => stops.some((s) => s.id === x.id)).length;
  const d0 = await dq();
  const dName = await dq("simsek");
  const dCode = await dq(`la${ek}-t2`);
  const dReason = await dq("la_kopuk");
  const dMiss = await dq(`${TAG} zzqq`);
  check("§D3a duruş: boş arama = iki duruş", mine(d0) === 2, `bulunan ${mine(d0)}`);
  check("§D3b duruş: tezgah adı yalnız kendi duruşunu", mine(dName) === 1 && dName.data.length === 1);
  check("§D3c duruş: tezgah kodu (küçük harf) yalnız kendini", mine(dCode) === 1);
  check("§D3d duruş: sebep kodu yalnız sınıflananı", mine(dReason) === 1);
  check("§D3e duruş: eşleşmeyen 0", dMiss.data.length === 0);
  check("§D3f duruş: şema strict + search, izin aynen", /search: listSearchParam,\n {2}\}\)\n {2}\.strict\(\)/.test(readFileSync(join(ROUTES, "machine-stop.routes.ts"), "utf8")) && guardOf("machine-stop.routes.ts", "/").includes('requireAnyPermission("loom:manual-entry", "loom:classify", ...MOBILE_DOKUMA)'));

  // §D4 Tezgah alarmları — liste + özet aynı where.
  const aq = (search?: string) => listLoomAlarms({ scope: "all", stationId: st.id, search, limit: 50 });
  const a0 = await aq();
  const aName = await aq("yildiz");
  const aHall = await aq("hol cicek");
  const aMiss = await aq("zzqq");
  const sum = (r: Awaited<ReturnType<typeof aq>>) => JSON.stringify(r.summary);
  check("§D4a alarm: boş arama = iki alarm", a0.items.length === 2);
  check("§D4b alarm: tezgah adı yalnız biri; özet listeyle aynı where (değişti)", aName.items.length === 1 && sum(aName) !== sum(a0));
  check("§D4c alarm: hol adıyla ikisi", aHall.items.length === 2 && sum(aHall) === sum(a0));
  check("§D4d alarm: eşleşmeyen 0; özet boş kümeninki", aMiss.items.length === 0 && sum(aMiss) !== sum(a0));
  check("§D4e alarm: izin kapısı aynen (LIST)", guardOf("loom-alarm.routes.ts", "/").includes("LIST,"));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n=== Liste araması (${TAG}) ===`);
  try {
    await ortak();
    await finans();
    await satinAlma();
    await dokuma();
  } finally {
    for (const fn of cleanup.reverse()) await fn().catch((e: unknown) => check("temizlik", false, String(e)));
  }
}

main()
  .catch((e: unknown) => {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  });
