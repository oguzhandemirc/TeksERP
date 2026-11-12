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
import { listFinishingRates } from "../src/services/finishing-rate.service";
import { listYarnCostPrices } from "../src/services/yarn-cost-price.service";
import { listConsumableNorms } from "../src/services/consumable-norm.service";
import { listLabTestTypes } from "../src/services/lab-test-type.service";
import { listCustomerLabSpecs } from "../src/services/customer-lab-spec.service";
import { listSenderTemplates, USER_TEMPLATE_PREFIX } from "../src/services/gelen-belge-sablon.service";
import { listSeriesMatching } from "../src/services/helpers/series-panel.helper";
import { SystemLogService } from "../src/services/system-log.service";
import { systemLogListQuerySchema } from "../src/routes/admin.routes";
import { ClientRegistryService, filterClientSnapshot } from "../src/services/client-registry.service";
import { touchClient } from "../src/lib/client-registry";
import { WorkSessionService } from "../src/services/work-session.service";
import { buildPrintJobWhere } from "../src/services/helpers/print-job-filter.helper";
import { listPrintJobs, summarizePrintJobs } from "../src/services/print-job.service";
import { getConsignedWorkSummary } from "../src/services/roll-owner.service";

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
  // Adlı kapanış: defter silmesi (duruş olayı) teardown bağlamında sayılır (test_defter_ters_yol §10b2).
  const temizleDokuma = async (): Promise<void> => {
    await prisma.loomAlarm.deleteMany({ where: { machineId: { in: machineIds } } });
    await prisma.machineStopEvent.deleteMany({ where: { machineId: { in: machineIds } } });
    await prisma.machineCollector.deleteMany({ where: { collectorKey: `${TAG}-K` } });
    await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
    if (stationId) await prisma.station.deleteMany({ where: { id: stationId } });
  };
  cleanup.push(temizleDokuma);
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

async function maliyet(): Promise<void> {
  console.log("\n— §M maliyet —");
  const ek = TAG.slice(-6);
  const ids = { items: [] as string[], service: [] as string[], yarn: [] as string[], fin: [] as string[], norm: [] as string[] };
  // Adlı kapanış: defter silmesi (sarf normu) teardown bağlamında sayılır (test_defter_ters_yol §10b2).
  const temizleMaliyet = async (): Promise<void> => {
    await prisma.serviceConsumableNorm.deleteMany({ where: { id: { in: ids.norm } } });
    await prisma.yarnCostPrice.deleteMany({ where: { id: { in: ids.yarn } } });
    await prisma.finishingRate.deleteMany({ where: { id: { in: ids.fin } } });
    await prisma.serviceItem.deleteMany({ where: { id: { in: ids.service } } });
    await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
  };
  cleanup.push(temizleMaliyet);
  const y1 = await prisma.item.create({ data: { code: `${TAG}-Y1`, name: `${TAG} Pamuk Çözgü`, itemType: "YARN", unit: "KG" }, select: { id: true } });
  const y2 = await prisma.item.create({ data: { code: `${TAG}-Y2`, name: `${TAG} Polyester Atkı`, itemType: "YARN", unit: "KG" }, select: { id: true } });
  const c1 = await prisma.item.create({ data: { code: `${TAG}-C1`, name: `${TAG} Boya Ğ`, itemType: "CONSUMABLE", unit: "KG" }, select: { id: true } });
  ids.items.push(y1.id, y2.id, c1.id);
  const sv = await prisma.serviceItem.create({ data: { code: `${TAG}-SV`, name: `${TAG} Şardon` }, select: { id: true } });
  ids.service.push(sv.id);
  for (const yarnItemId of [y1.id, y2.id]) ids.yarn.push((await prisma.yarnCostPrice.create({ data: { yarnItemId, currency: "TRY", pricePerKg: 1 }, select: { id: true } })).id);
  for (const [code, name] of [[`LA${ek}A`, `${TAG} Apre Yıkama`], [`LA${ek}B`, `${TAG} Boyama`]]) {
    ids.fin.push((await prisma.finishingRate.create({ data: { code, name, basis: "RAW_M", currency: "TRY", pricePerM: 1 }, select: { id: true } })).id);
  }
  ids.norm.push((await prisma.serviceConsumableNorm.create({ data: { serviceItemId: sv.id, consumableItemId: c1.id, qtyPerM: 1, unit: "KG", clientToken: randomUUID() }, select: { id: true } })).id);

  const mineY = (r: Array<{ id: string }>) => r.filter((x) => ids.yarn.includes(x.id)).length;
  check("§M1a iplik fiyatı: boş = ikisi; 'pamuk cozgu' yalnız biri; kod küçük harfle", mineY(await listYarnCostPrices({})) === 2 && mineY(await listYarnCostPrices({ search: "pamuk cozgu" })) === 1 && mineY(await listYarnCostPrices({ search: `${TAG}-y2`.toLowerCase() })) === 1);
  check("§M1b iplik fiyatı: eşleşmeyen 0", mineY(await listYarnCostPrices({ search: `${TAG} zzqq` })) === 0);
  const mineF = (r: Array<{ id: string }>) => r.filter((x) => ids.fin.includes(x.id)).length;
  check("§M2a tarife: boş = ikisi; kod küçük harfle yalnız biri", mineF(await listFinishingRates({})) === 2 && mineF(await listFinishingRates({ search: `la${ek}a` })) === 1);
  check("§M2b tarife: ad (gölgesiz yol) 'APRE' yalnız biri; eşleşmeyen 0", mineF(await listFinishingRates({ search: "APRE" })) === 1 && mineF(await listFinishingRates({ search: `${TAG} zzqq` })) === 0);
  const mineN = (r: Array<{ id: string }>) => r.filter((x) => ids.norm.includes(x.id)).length;
  const nq = (search?: string) => listConsumableNorms({ serviceItemId: null, consumableItemId: null, includeRevoked: false, search });
  check("§M3a sarf normu: hizmet adı ('sardon') ve sarf kodu bulur", mineN(await nq("sardon")) === 1 && mineN(await nq(`${TAG}-c1`.toLowerCase())) === 1);
  check("§M3b sarf normu: boş = var; eşleşmeyen 0", mineN(await nq()) === 1 && mineN(await nq(`${TAG} zzqq`)) === 0);
  const costSrc = readFileSync(join(ROUTES, "cost.routes.ts"), "utf8");
  check("§M4 maliyet: kapı toplu (verifyToken + requireMaliyetEnabled) ve üç uç cost:read aynen", costSrc.includes("router.use(verifyToken, requireMaliyetEnabled)") && ["/yarn-prices", "/finishing-rates", "/consumable-norms"].every((p) => guardOf("cost.routes.ts", p).includes('requirePermission("cost:read")')));
}

async function tanimKalite(): Promise<void> {
  console.log("\n— §T tanımlar/kalite —");
  const ek = TAG.slice(-6);
  const ids = { types: [] as string[], specs: [] as string[], customers: [] as string[], items: [] as string[], tpl: [] as string[] };
  cleanup.push(async () => {
    await prisma.senderTemplate.deleteMany({ where: { id: { in: ids.tpl } } });
    await prisma.customerLabSpec.deleteMany({ where: { id: { in: ids.specs } } });
    await prisma.labTestType.deleteMany({ where: { id: { in: ids.types } } });
    await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  });
  const t1 = await prisma.labTestType.create({ data: { code: `LA${ek}G`, name: `${TAG} Gramaj Ölçümü`, method: "TS 251", resultKind: "NUMERIC" }, select: { id: true } });
  ids.types.push(t1.id);
  const t2 = await prisma.labTestType.create({ data: { code: `LA${ek}H`, name: `${TAG} Yıkama Haslığı`, resultKind: "NUMERIC" }, select: { id: true } });
  ids.types.push(t2.id);
  const c1 = await prisma.customer.create({ data: { code: `${TAG}-K1`, name: `${TAG} Şimşek Tekstil` }, select: { id: true } });
  const c2 = await prisma.customer.create({ data: { code: `${TAG}-K2`, name: `${TAG} Yıldız Örme` }, select: { id: true } });
  ids.customers.push(c1.id, c2.id);
  const it = await prisma.item.create({ data: { code: `${TAG}-U1`, name: `${TAG} Penye Kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  ids.items.push(it.id);
  ids.specs.push((await prisma.customerLabSpec.create({ data: { customerId: c1.id, testTypeId: t1.id, itemId: it.id, specMin: 1 }, select: { id: true } })).id);
  ids.specs.push((await prisma.customerLabSpec.create({ data: { customerId: c2.id, testTypeId: t2.id, specMin: 1 }, select: { id: true } })).id);

  // §T1 Test türleri — kod (küçük harf), ad (gölgesiz), yöntem.
  const mineT = (r: Array<{ id: string }>) => r.filter((x) => ids.types.includes(x.id)).length;
  // Ad/yöntem gölgesiz yoldadır: büyük-küçük + i-ailesi katlanır, ö/ç katlanmaz (küçük katalogda bilinçli).
  check("§T1a test türü: boş = ikisi; 'GRAMAJ' yalnız biri", mineT(await listLabTestTypes({})) === 2 && mineT(await listLabTestTypes({ search: "GRAMAJ" })) === 1);
  check("§T1b test türü: kod küçük harfle ve yöntemle yalnız biri", mineT(await listLabTestTypes({ search: `la${ek}h` })) === 1 && mineT(await listLabTestTypes({ search: "ts 251" })) === 1);
  check("§T1c test türü: eşleşmeyen 0", mineT(await listLabTestTypes({ search: `${TAG} zzqq` })) === 0);
  const ltSrc = readFileSync(join(ROUTES, "lab-test-type.routes.ts"), "utf8");
  check("§T1d test türü: sorgu katı (search) + izin aynen", /ListQuery = z\.strictObject\(\{ activeOnly: [^}]*search: listSearchParam/.test(ltSrc) && guardOf("lab-test-type.routes.ts", "/").includes('requirePermission("labtest:read")'));

  // §T2 Müşteri spesifikasyonları — müşteri adı (Fold), müşteri/ürün/tür kodu, ürün adı, tür adı.
  const mineS = (r: Array<{ id: string }>) => r.filter((x) => ids.specs.includes(x.id)).length;
  const sq = (search?: string) => listCustomerLabSpecs({ search });
  check("§T2a spesifikasyon: boş = ikisi; müşteri adı katlanarak ('simsek') yalnız biri", mineS(await sq()) === 2 && mineS(await sq("simsek")) === 1);
  check("§T2b spesifikasyon: ürün adı ve müşteri kodu (küçük harf) yalnız biri", mineS(await sq("penye")) === 1 && mineS(await sq(`${TAG}-k2`.toLowerCase())) === 1);
  check("§T2c spesifikasyon: test türü adı (gölgesiz) yalnız biri; eşleşmeyen 0", mineS(await sq("YIKAMA")) === 1 && mineS(await sq(`${TAG} zzqq`)) === 0);
  check("§T2d spesifikasyon: müşteri süzgeci + arama AND", mineS(await listCustomerLabSpecs({ customerId: c1.id, search: "yildiz" })) === 0 && mineS(await listCustomerLabSpecs({ customerId: c1.id, search: "simsek" })) === 1);
  const csSrc = readFileSync(join(ROUTES, "customer-lab-spec.routes.ts"), "utf8");
  check("§T2e spesifikasyon: sorgu katı (search) + izin aynen", /search: listSearchParam,\n\}\)\.strict\(\)/.test(csSrc) && guardOf("customer-lab-spec.routes.ts", "/").includes('requirePermission("labtest:read")'));

  // §T3 Gönderen şablonları — dosya ∪ DB birleşimi bellekte; kod, ad, bağlı cari ad/kod.
  for (const [i, cust] of [[1, c1.id], [2, null]] as const) {
    const code = `${USER_TEMPLATE_PREFIX}la${ek.toLowerCase()}${i}`;
    ids.tpl.push((await prisma.senderTemplate.create({ data: { code, template: { name: `${TAG} Tanıt ${i === 1 ? "Çeki" : "Fiş"}` }, senderCustomerId: cust }, select: { id: true } })).id);
  }
  const mineG = (r: Array<{ id: string | null }>) => r.filter((x) => x.id !== null && ids.tpl.includes(x.id)).length;
  const gAll = await listSenderTemplates();
  check("§T3a şablon: boş = ikisi (dosya şablonlarıyla birlikte)", mineG(gAll) === 2, `toplam ${gAll.length}`);
  check("§T3b şablon: ad katlanarak ('ceki') yalnız biri", mineG(await listSenderTemplates(`${TAG} ceki`)) === 1);
  check("§T3c şablon: bağlı gönderen cari adıyla yalnız biri; eşleşmeyen 0", mineG(await listSenderTemplates(`${TAG} simsek`)) === 1 && (await listSenderTemplates(`${TAG} zzqq`)).length === 0);
  const gbSrc = readFileSync(join(ROUTES, "gelen-belge.routes.ts"), "utf8");
  check("§T3d şablon: sorgu katı (search) + izin aynen", gbSrc.includes("const SenderTemplateListQuery = z.strictObject({ search: listSearchParam });") && guardOf("gelen-belge.routes.ts", "/sablonlar").includes('requirePermission("gelen-belge:template")'));

  // §T4 Numaralandırma — kod kataloğu bellekte; anahtar, ad, ön ek.
  const nAll = listSeriesMatching();
  const nSack = listSeriesMatching("sack");
  const nLabel = nAll[0] ? listSeriesMatching(nAll[0].label.toUpperCase()) : [];
  check("§T4a seri: boş = tüm katalog; anahtar 'sack' daraltır ve içerir", nAll.length > 3 && nSack.length >= 1 && nSack.length < nAll.length && nSack.some((r) => r.key === "sack"));
  check("§T4b seri: ad büyük harfle bulur; eşleşmeyen 0", nLabel.some((r) => r.key === nAll[0]?.key) && listSeriesMatching("zzqq xxyy").length === 0);
  const nsSrc = readFileSync(join(ROUTES, "number-series.routes.ts"), "utf8");
  check("§T4c seri: sorgu katı (search) + kapı toplu aynen", nsSrc.includes("const listQuerySchema = z.object({ search: listSearchParam }).strict();") && nsSrc.includes('router.use(verifyToken, requirePermission("settings:numbering"))'));
}

async function sistem(): Promise<void> {
  console.log("\n— §Y sistem —");
  const ek = TAG.slice(-6).toLowerCase();
  const ids = { logs: [] as string[], users: [] as string[], devices: [] as string[], sessions: [] as string[], jobs: [] as string[], station: "" , machines: [] as string[] };
  cleanup.push(async () => {
    await prisma.printJob.deleteMany({ where: { id: { in: ids.jobs } } });
    await prisma.workSession.deleteMany({ where: { id: { in: ids.sessions } } });
    await prisma.systemLog.deleteMany({ where: { OR: [{ id: { in: ids.logs } }, { userId: { in: ids.users } }] } });
    await prisma.device.deleteMany({ where: { id: { in: ids.devices } } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  });
  const u1 = await prisma.user.create({ data: { username: `la-${ek}-sevgi`, passwordHash: "x", fullName: `${TAG} Sevgi Işık` }, select: { id: true } });
  const u2 = await prisma.user.create({ data: { username: `la-${ek}-kemal`, passwordHash: "x", fullName: `${TAG} Kemal Öz` }, select: { id: true } });
  ids.users.push(u1.id, u2.id);

  // §Y1 Sistem olayları — hedef, IP, kullanıcı; kategori + tarih süzgeciyle AND; q/işlem ile 400.
  const at = new Date(Date.UTC(1991, 2, 3, 10));
  for (const [userId, recordId, ip] of [[u1.id, `${TAG}-hedef-a`, "10.91.3.1"], [u2.id, `${TAG}-hedef-b`, "10.91.3.2"]] as const) {
    ids.logs.push((await prisma.systemLog.create({ data: { userId, category: "AUTH", action: "LOGIN_FAILED", tableName: "AUTH", recordId, ipAddress: ip, createdAt: at }, select: { id: true } })).id);
  }
  const lq = async (search?: string) => {
    const r = await SystemLogService.list({ category: "AUTH,SYSTEM", dateFrom: new Date(at.getTime() - 60_000).toISOString(), dateTo: new Date(at.getTime() + 60_000).toISOString(), search, limit: 100 });
    return (r.data as Array<{ id: string }>).filter((x) => ids.logs.includes(x.id)).length;
  };
  check("§Y1a olay: boş = ikisi; hedef metniyle yalnız biri", (await lq()) === 2 && (await lq(`${TAG}-hedef-b`)) === 1);
  check("§Y1b olay: IP ve kullanıcı tam adıyla (Türkçe varyant) yalnız biri", (await lq("10.91.3.1")) === 1 && (await lq(`${TAG} sevgi ışık`)) === 1);
  check("§Y1c olay: eşleşmeyen 0", (await lq(`${TAG} zzqq`)) === 0);
  check("§Y1d olay: search + q / işlem görünümü 400; uzun arama 400",
    !systemLogListQuerySchema.safeParse({ search: "a", q: "SP-1" }).success && !systemLogListQuerySchema.safeParse({ search: "a", gorunum: "islem" }).success && !systemLogListQuerySchema.safeParse({ search: LONG }).success && systemLogListQuerySchema.safeParse({ search: "a" }).success);
  const adminSrc = readFileSync(join(ROUTES, "admin.routes.ts"), "utf8");
  check("§Y1e olay: izin kapısı aynen", /"\/system-logs",\s*\n\s*verifyToken,\s*\n\s*requireAnyPermission\("admin:settings", "system:activity"\)/.test(adminSrc));

  // §Y2 Bağlı istemciler — süreç belleği, çözülmüş adlarla bellek ikizi.
  const inst = (n: number) => `${randomUUID()}`.replace(/.$/, String(n));
  const [i1, i2] = [inst(1), inst(2)];
  touchClient({ instanceId: i1, kind: "electron", version: "9.8.7", userId: u1.id });
  touchClient({ instanceId: i2, kind: "electron", version: "9.8.6", userId: u2.id });
  const snap = await ClientRegistryService.snapshot();
  const mineC = (s: typeof snap) => s.clients.filter((c) => c.instanceId === i1 || c.instanceId === i2).length;
  check("§Y2a istemci: boş = ikisi; son kullanıcı tam adıyla yalnız biri", mineC(filterClientSnapshot(snap, undefined)) === 2 && mineC(filterClientSnapshot(snap, `${TAG} kemal`)) === 1);
  check("§Y2b istemci: sürümle yalnız biri; eşleşmeyen 0; eşikler aynen", mineC(filterClientSnapshot(snap, "9.8.7")) === 1 && filterClientSnapshot(snap, `${TAG} zzqq`).clients.length === 0 && filterClientSnapshot(snap, "x").activeWindowMs === snap.activeWindowMs);
  check("§Y2c istemci: sorgu katı + izin aynen", adminSrc.includes("const clientsQuerySchema = z.object({ search: listSearchParam }).strict();") && /"\/clients",\s*\n\s*verifyToken,\s*\n\s*requireAnyPermission\("admin:settings", "system:clients"\)/.test(adminSrc));

  // §Y3 Oturum geçmişi — kullanıcı/cihaz/makine/istasyon; toplam aynı where.
  const st = await prisma.station.create({ data: { name: `${TAG} Sevk Holü`, code: `${TAG}-SV`.slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true }, select: { id: true } });
  ids.station = st.id;
  const m = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG} Tezgâh Çınar`, code: `LA${ek.toUpperCase()}-W1`, isActive: true }, select: { id: true } });
  ids.machines.push(m.id);
  const d1 = await prisma.device.create({ data: { deviceId: `${TAG}-d1`, name: `${TAG} Tablet Mavi`, status: "APPROVED", kind: "TABLET" }, select: { id: true } });
  const d2 = await prisma.device.create({ data: { deviceId: `${TAG}-d2`, name: `${TAG} Tablet Yeşil`, status: "APPROVED", kind: "TABLET" }, select: { id: true } });
  ids.devices.push(d1.id, d2.id);
  const t0 = new Date(Date.UTC(1991, 2, 3, 8));
  ids.sessions.push((await prisma.workSession.create({ data: { userId: u1.id, deviceId: d1.id, machineId: m.id, stationId: st.id, startedAt: t0, endedAt: new Date(t0.getTime() + 3_600_000), endReason: "LOGOUT", lastActivityAt: t0 }, select: { id: true } })).id);
  ids.sessions.push((await prisma.workSession.create({ data: { userId: u2.id, deviceId: d2.id, machineId: null, stationId: st.id, startedAt: t0, endedAt: new Date(t0.getTime() + 3_600_000), endReason: "LOGOUT", lastActivityAt: t0 }, select: { id: true } })).id);
  const wq = (search?: string) => WorkSessionService.history({ stationId: st.id, search, pageSize: 100 });
  const mineW = (r: Awaited<ReturnType<typeof wq>>) => (r.data as Array<{ id: string }>).filter((x) => ids.sessions.includes(x.id)).length;
  const w0 = await wq();
  const wMach = await wq(`la${ek}-w1`);
  check("§Y3a oturum: boş = ikisi (toplam 2)", mineW(w0) === 2 && w0.pagination.total === 2);
  check("§Y3b oturum: cihaz adı (gölgesiz: 'Yeşil' yazımıyla) yalnız biri, toplam aynı where", mineW(await wq("Tablet Yeşil")) === 1 && (await wq("Tablet Yeşil")).pagination.total === 1);
  check("§Y3c oturum: makine kodu küçük harfle yalnız biri; kullanıcı adıyla yalnız biri", mineW(wMach) === 1 && mineW(await wq(`la-${ek}-kemal`)) === 1);
  check("§Y3d oturum: eşleşmeyen 0 (toplam 0)", (await wq(`${TAG} zzqq`)).pagination.total === 0);
  const wsCtl = readFileSync(join(__dirname, "..", "src", "controllers", "work-session.controller.ts"), "utf8");
  check("§Y3e oturum: sorgu katı (search) + izin aynen", /search: listSearchParam,\n\}\)\.strict\(\)/.test(wsCtl) && /requireAnyPermission\("admin:settings", "admin:users", "system:work-sessions"\),\n\s*WorkSessionController\.history/.test(readFileSync(join(ROUTES, "work-session.routes.ts"), "utf8")));

  // §Y4 Baskı geçmişi — kayıt no, yazıcı, hata kodu; liste + özet aynı where.
  for (const [subjectNo, printerName, status, errorCode] of [[`${TAG}-TOP1`, `${TAG} Zebra Ön`, "ILETILDI", null], [`${TAG}-TOP2`, `${TAG} Zebra Arka`, "HATA", "LA_KAGIT_BITTI"]] as const) {
    ids.jobs.push((await prisma.printJob.create({ data: { userId: u1.id, source: "PANEL_MASAUSTU", subjectKind: "ETIKET_TOP", subjectNo, printerName, status, errorCode, createdAt: at }, select: { id: true } })).id);
  }
  const pw = (search?: string) => buildPrintJobWhere({ userId: u1.id, gunBas: "1991-03-01", gunBit: "1991-03-05", search });
  const mineP = async (search?: string) => (await listPrintJobs(pw(search), { limit: 200 })).data.filter((x: { id: string }) => ids.jobs.includes(x.id)).length;
  const sumP = async (search?: string) => (await summarizePrintJobs(pw(search))).toplam;
  check("§Y4a baskı: boş = ikisi; özet 2", (await mineP()) === 2 && (await sumP()) === 2);
  check("§Y4b baskı: kayıt no küçük harfle yalnız biri; özet 1", (await mineP(`${TAG}-top2`.toLowerCase())) === 1 && (await sumP(`${TAG}-top2`.toLowerCase())) === 1);
  check("§Y4c baskı: yazıcı adı ve hata kodu yalnız biri; eşleşmeyen 0 (özet 0)", (await mineP("zebra ön")) === 1 && (await mineP("la_kagit")) === 1 && (await sumP(`${TAG} zzqq`)) === 0);
  check("§Y4d baskı: uzun arama 400 (controller readListSearch) + izin aynen", readFileSync(join(__dirname, "..", "src", "controllers", "print-job.controller.ts"), "utf8").includes("search: readListSearch(q.search)") && guardOf("print-job.routes.ts", "/").includes("requireAnyPermission(...PRINT_HISTORY_READ)"));
}

async function uretim(): Promise<void> {
  console.log("\n— §U üretim özetleri —");
  const ids = { customers: [] as string[], rolls: [] as string[], item: "" };
  cleanup.push(async () => {
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
    await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  });
  // §U1 İçerideki işler — sahip başına toplanmış satır; arama bellek ikiziyle, toplamlar süzülen satırlardan.
  const ca = await prisma.customer.create({ data: { code: `${TAG}-EA`, name: `${TAG} Gökçe Dokuma` }, select: { id: true } });
  const cb = await prisma.customer.create({ data: { code: `${TAG}-EB`, name: `${TAG} Ilgaz Örme` }, select: { id: true } });
  ids.customers.push(ca.id, cb.id);
  ids.item = (await prisma.item.create({ data: { code: `${TAG}-EI`, name: `${TAG} Emanet Kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  for (const [owner, qty] of [[ca.id, 10], [ca.id, 15], [cb.id, 40]] as const) {
    ids.rolls.push((await prisma.roll.create({ data: { barcode: `${TAG}-E${ids.rolls.length}`, itemId: ids.item, status: "STOCK", initialQty: qty, currentQty: qty, entrySource: "SUPPLIER_RECEIPT", ownerCustomerId: owner }, select: { id: true } })).id);
  }
  const all = (await getConsignedWorkSummary()).data!;
  const hitA = (await getConsignedWorkSummary({ search: "gokce dokuma" })).data!;
  const hitB = (await getConsignedWorkSummary({ search: `${TAG}-eb`.toLowerCase() })).data!;
  const miss = (await getConsignedWorkSummary({ search: `${TAG} zzqq` })).data!;
  const mineU = (d: typeof all) => d.rows.filter((r) => ids.customers.includes(r.ownerCustomerId)).length;
  check("§U1a içeride: boş = iki sahip", mineU(all) === 2);
  check("§U1b içeride: sahip adı katlanarak yalnız A; toplam = A'nın toplamı (2 top, 25 m)", mineU(hitA) === 1 && hitA.rows.length === 1 && hitA.totals.total.count === 2 && hitA.totals.total.qty === 25);
  check("§U1c içeride: sahip kodu küçük harfle yalnız B; toplam 40 m", mineU(hitB) === 1 && hitB.totals.total.qty === 40);
  check("§U1d içeride: eşleşmeyen 0 satır, toplam 0", miss.rows.length === 0 && miss.totals.total.count === 0);
  const cwSrc = readFileSync(join(ROUTES, "consigned-work.routes.ts"), "utf8");
  check("§U1e içeride: sorgu katı (search) + kapılar aynen", cwSrc.includes('z.object({ onlyReady: z.enum(["true", "false"]).optional(), search: listSearchParam }).strict()') && cwSrc.includes("router.use(verifyToken, requireEmanetEnabled);") && cwSrc.includes('router.use(requirePermission("roll:read"));'));
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
    await maliyet();
    await tanimKalite();
    await sistem();
    await uretim();
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
