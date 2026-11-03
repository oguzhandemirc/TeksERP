// =============================================================================
// Test: İstasyon varsayılan hedefleri (K22, 2026-11-03) — TEK KAYNAK çözücü + yazma kapısı + belgeden İE kararı
// Çalıştır: npx tsx scripts/test_station_default_targets.ts
//   §1 işaretsiz istasyon (OPTIONAL bayrak/seçim, isDefault'suz REQUIRED) → ön seçim YOK (bugünkü)
//   §2 AUTO bayrak hep; OPTIONAL bayrak yalnız "varsayılan açık"
//   §3 değer önceliği: isDefault < yetenek varsayılanı < müşteri varsayılanı (S3); ön muhasebe kapalıyken müşteri yok sayılır
//   §4 çeşit: ana bayrak seçiliyse çeşit değeriyle gelir; bayrak satırındaki çeşit değeri yetenek varsayılanı sayılır
//   §5 yazma: başka özelliğin değeri 400 STATION_DEFAULT_VALUE_FOREIGN, pasif değer 400; alan verilmezse korunur
//   §6 belgeden İE kararı: gövdede değer yoksa çözücü; varsa istemcinin değeri aynen; KAT → foldType
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { StationCapabilityService } from "../src/services/station-capability.service";
import { resolveStationDefaultTargets, type DefaultTarget } from "../src/services/helpers/station-default-targets.helper";
import { resolveFormWorkOrderTargets } from "../src/services/gelen-belge-form-is-emri.service";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { FOLD_PROPERTY_CODE } from "../src/services/helpers/fold-type";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const svc = new StationCapabilityService();
const STAMP = Date.now().toString(36).toUpperCase();
const P = `TSDT${STAMP}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
async function errOf(fn: () => Promise<unknown>): Promise<{ status?: number; code?: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; message?: string };
    return { status: x.statusCode, code: x.details?.code, message: x.message ?? String(e) };
  }
}

const fx = {
  stationIds: [] as string[],
  propIds: [] as string[],
  valueIds: [] as string[],
  customerIds: [] as string[],
  cariIds: [] as string[],
  routeIds: [] as string[],
  kursunCreated: null as string | null,
  finance: undefined as { value: Prisma.JsonValue } | null | undefined,
};

async function station(n: string): Promise<string> {
  const id = (await prisma.station.create({ data: { code: `${P}-${n}`.slice(0, 32), name: `TEST SDT ${n} ${STAMP}`, type: "INTERNAL", kind: "TAMBUR", department: "KALITE", appliesProperty: true }, select: { id: true } })).id;
  fx.stationIds.push(id);
  return id;
}
async function prop(n: string, valueType: "FLAG" | "CHOICE", variantOfPropertyId?: string): Promise<string> {
  const id = (await prisma.fabricProperty.create({ data: { code: `${P}-${n}`.slice(0, 32), name: `TEST SDT ${n} ${STAMP}`, valueType, ...(variantOfPropertyId ? { variantOfPropertyId } : {}) }, select: { id: true } })).id;
  fx.propIds.push(id);
  return id;
}
async function val(propertyId: string, n: string, isDefault = false, sortOrder = 1): Promise<string> {
  const id = (await prisma.fabricPropertyValue.create({ data: { propertyId, code: `${P}${n}`.slice(0, 32), name: `${n} değer`, isDefault, sortOrder }, select: { id: true } })).id;
  fx.valueIds.push(id);
  return id;
}
async function targetsOf(stationId: string, customerId?: string): Promise<DefaultTarget[]> {
  return (await resolveStationDefaultTargets([stationId], customerId ?? null))[0].targets;
}
const t = (list: DefaultTarget[], propertyId: string) => list.find((x) => x.propertyId === propertyId);
async function setFinance(on: boolean): Promise<void> {
  const key = SETTING_KEYS.FINANCE_ENABLED;
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: on, description: "TEST — K22" }, update: { value: on } });
}

async function main(): Promise<void> {
  console.log("=== İstasyon varsayılan hedefleri (K22) ===");
  const engel = hedefDbEngeli();
  if (engel) {
    check("hedef DB yazılabilir", false, engel);
    return;
  }
  fx.finance = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_ENABLED }, select: { value: true } });

  const fAuto = await prop("FA", "FLAG");
  const fOpt = await prop("FO", "FLAG");
  const fOn = await prop("FN", "FLAG");
  const cProp = await prop("C", "CHOICE");
  const c1 = await val(cProp, "C1", true, 1);
  const c2 = await val(cProp, "C2", false, 2);
  const c3 = await val(cProp, "C3", false, 3);
  const dProp = await prop("D", "CHOICE");
  const d1 = await val(dProp, "D1");
  const dPassive = await val(dProp, "DP");
  await prisma.fabricPropertyValue.update({ where: { id: dPassive }, data: { isActive: false } });

  // ── §1 işaretsiz ──
  const s0 = await station("S0");
  await svc.setCapabilities(s0, { properties: [{ propertyId: fOpt, mode: "OPTIONAL" }, { propertyId: cProp, mode: "OPTIONAL" }, { propertyId: dProp, mode: "REQUIRED" }] });
  const t0 = await targetsOf(s0);
  check("§1 ⭐ işaretsiz istasyon → ön seçim YOK (OPTIONAL bayrak/seçim, isDefault'suz REQUIRED)", t0.length === 0, JSON.stringify(t0.map((x) => x.propertyCode)));
  const dto = (await svc.findByStation(s0)).data!.properties.find((p) => p.id === fOpt);
  check("§1 DTO yeni alanları varsayılanla taşır", dto?.defaultOn === false && dto?.defaultValueId === null);

  // ── §2 bayraklar ──
  const s1 = await station("S1");
  await svc.setCapabilities(s1, {
    properties: [
      { propertyId: fAuto, mode: "AUTO" },
      { propertyId: fOpt, mode: "OPTIONAL" },
      { propertyId: fOn, mode: "OPTIONAL", defaultOn: true },
      { propertyId: cProp, mode: "REQUIRED" },
      { propertyId: dProp, mode: "OPTIONAL", defaultOn: true, defaultValueId: d1 },
    ],
  });
  let t1 = await targetsOf(s1);
  check("§2 ⭐ AUTO bayrak seçili", t(t1, fAuto)?.mode === "AUTO" && t(t1, fAuto)?.valueId === null);
  check("§2 ⭐ OPTIONAL + varsayılan açık bayrak seçili", !!t(t1, fOn));
  check("§2 OPTIONAL (kapalı) bayrak seçili değil", !t(t1, fOpt));

  // ── §3 değer önceliği ──
  check("§3a ⭐ REQUIRED seçim → değerin isDefault'u (VALUE_DEFAULT)", t(t1, cProp)?.valueId === c1 && t(t1, cProp)?.source === "VALUE_DEFAULT");
  check("§3b OPTIONAL + açık + yetenek değeri → STATION", t(t1, dProp)?.valueId === d1 && t(t1, dProp)?.source === "STATION");
  await svc.setCapabilities(s1, { properties: [{ propertyId: fAuto }, { propertyId: fOpt }, { propertyId: fOn }, { propertyId: cProp, defaultValueId: c2 }, { propertyId: dProp }] });
  t1 = await targetsOf(s1);
  check("§3c ⭐ yetenek varsayılanı isDefault'u geçer (STATION)", t(t1, cProp)?.valueId === c2 && t(t1, cProp)?.source === "STATION");
  const kept = (await prisma.stationProperty.findFirst({ where: { stationId: s1, propertyId: dProp }, select: { defaultOn: true, defaultValueId: true, mode: true } }))!;
  check("§5a alan verilmezse mod/açık/değer KORUNUR", kept.defaultOn && kept.defaultValueId === d1 && kept.mode === "OPTIONAL");

  // Müşteri önceliği: S3 gramajı kurşun bayrağının çeşidinde yaşar.
  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşun ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  let gProp = (await prisma.fabricProperty.findFirst({ where: { variantOfPropertyId: kursun.id }, select: { id: true } }))?.id;
  if (!gProp) gProp = await prop("G", "CHOICE", kursun.id);
  const g1 = await val(gProp, "G1", false, 901);
  const g2 = await val(gProp, "G2", false, 902);
  const cust = (await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST SDT müşteri ${STAMP}` }, select: { id: true } })).id;
  fx.customerIds.push(cust);
  fx.cariIds.push((await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust, kursunDefaultValueId: g1 }, select: { id: true } })).id);

  const s2 = await station("S2");
  await svc.setCapabilities(s2, { properties: [{ propertyId: kursun.id, mode: "AUTO" }, { propertyId: gProp, mode: "REQUIRED", defaultValueId: g2 }] });
  await setFinance(true);
  let t2 = await targetsOf(s2, cust);
  check("§3d ⭐ müşteri varsayılanı yetenek varsayılanını geçer (CUSTOMER)", t(t2, gProp)?.valueId === g1 && t(t2, gProp)?.source === "CUSTOMER", JSON.stringify(t(t2, gProp)));
  t2 = await targetsOf(s2);
  check("§3e müşterisiz → yetenek varsayılanı", t(t2, gProp)?.valueId === g2 && t(t2, gProp)?.source === "STATION");
  await setFinance(false);
  t2 = await targetsOf(s2, cust);
  check("§3f ⭐ ön muhasebe kapalı → müşteri yok sayılır (S3 ucu 403 ile aynı)", t(t2, gProp)?.valueId === g2);

  // ── §4 çeşit ──
  const s3 = await station("S3");
  await svc.setCapabilities(s3, { properties: [{ propertyId: kursun.id, mode: "AUTO", defaultValueId: g2 }] });
  const t3 = await targetsOf(s3);
  check("§4a ⭐ bayrak satırındaki çeşit değeri çeşidin varsayılanı (çeşit istasyonda yokken de gelir)", t(t3, gProp)?.valueId === g2 && t(t3, gProp)?.source === "STATION" && !!t(t3, kursun.id));
  const s4 = await station("S4");
  await svc.setCapabilities(s4, { properties: [{ propertyId: kursun.id, mode: "OPTIONAL" }] });
  const t4 = await targetsOf(s4);
  check("§4b kurşun OPTIONAL (açık değil) → ne bayrak ne gramaj", t4.length === 0, JSON.stringify(t4.map((x) => x.propertyCode)));

  // ── §5 yazma kapısı ──
  const foreign = await errOf(() => svc.setCapabilities(s1, { properties: [{ propertyId: cProp, defaultValueId: d1 }, { propertyId: dProp }, { propertyId: fAuto }] }));
  check("§5b ⭐ başka özelliğin değeri 400 STATION_DEFAULT_VALUE_FOREIGN", foreign?.status === 400 && foreign.code === "STATION_DEFAULT_VALUE_FOREIGN", JSON.stringify(foreign));
  const passive = await errOf(() => svc.setCapabilities(s1, { properties: [{ propertyId: dProp, defaultValueId: dPassive }, { propertyId: cProp }, { propertyId: fAuto }] }));
  check("§5c pasif değer 400", passive?.status === 400 && passive.code === "STATION_DEFAULT_VALUE_INVALID");
  const intact = (await prisma.stationProperty.findFirst({ where: { stationId: s1, propertyId: cProp }, select: { defaultValueId: true } }))!;
  check("§5d reddedilen yazım satıra dokunmadı", intact.defaultValueId === c2);
  await svc.setCapabilities(s1, { properties: [{ propertyId: fAuto }, { propertyId: fOpt }, { propertyId: fOn }, { propertyId: cProp, defaultValueId: null }, { propertyId: dProp }] });
  check("§5e null varsayılan değeri kaldırır", (await prisma.stationProperty.findFirst({ where: { stationId: s1, propertyId: cProp }, select: { defaultValueId: true } }))!.defaultValueId === null);

  // ── §6 belgeden İE kararı ──
  const kat = await prisma.fabricProperty.findUnique({ where: { code: FOLD_PROPERTY_CODE }, select: { id: true, values: { where: { isActive: true }, select: { id: true, code: true }, orderBy: { sortOrder: "desc" } } } });
  const s5 = await station("S5");
  const fold = kat?.values[0];
  if (kat && fold) await svc.setCapabilities(s5, { properties: [{ propertyId: kat.id, mode: "OPTIONAL", defaultOn: true, defaultValueId: fold.id }] });
  const route = (await prisma.route.create({ data: { name: `TEST SDT rota ${STAMP}`, steps: { create: [{ stationId: s1, sequence: 1 }, { stationId: s5, sequence: 2 }] } }, select: { id: true } })).id;
  fx.routeIds.push(route);
  const auto = await resolveFormWorkOrderTargets(route, cust, undefined);
  check("§6a ⭐ gövdede değer yok → çözücü değeri (isDefault c1)", auto.targetValues.some((x) => x.propertyId === cProp && x.valueId === c1));
  check("§6b AUTO + açık bayraklar hedef özelliklerde", auto.targetPropertyIds.includes(fAuto) && auto.targetPropertyIds.includes(fOn) && !auto.targetPropertyIds.includes(fOpt));
  check("§6c ⭐ KAT hedef değere değil foldType'a gider", !!fold && auto.foldType === fold.code && !auto.targetValues.some((x) => x.propertyId === kat!.id), `${auto.foldType}`);
  const client = await resolveFormWorkOrderTargets(route, cust, [{ propertyId: cProp, valueId: c3 }]);
  check("§6d ⭐ istemcinin değeri EZİLMEZ (aynen)", client.targetValues.length === 1 && client.targetValues[0].valueId === c3);
  const cleared = await resolveFormWorkOrderTargets(route, cust, []);
  check("§6e ⭐ boş dizi = istemci kararı (değer eklenmez)", cleared.targetValues.length === 0);

  // Negatif sonda (elle): computeDefaultTargets'ta `own.mode === "REQUIRED"` → `true` yapınca §1 kırmızı;
  // resolveFormWorkOrderTargets'ta `clientValues ??` kaldırılınca §6d/§6e kırmızı.
}

async function cleanup(): Promise<void> {
  const del = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      console.log(`⚠️  temizlik (${label}): ${e instanceof Error ? e.message : e}`);
    }
  };
  await del("rota", () => prisma.route.deleteMany({ where: { id: { in: fx.routeIds } } }));
  await del("yetenek", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } }));
  await del("istasyon", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: fx.cariIds } } }));
  await del("müşteri", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  await del("değer", () => prisma.fabricPropertyValue.deleteMany({ where: { id: { in: fx.valueIds } } }));
  await del("özellik", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) await del("kurşun", () => prisma.fabricProperty.delete({ where: { id: fx.kursunCreated! } }));
  const key = SETTING_KEYS.FINANCE_ENABLED;
  if (fx.finance === null) await del("ayar", () => prisma.systemSetting.deleteMany({ where: { key } }));
  else if (fx.finance) {
    const v = fx.finance.value as Prisma.InputJsonValue;
    await del("ayar", () => prisma.systemSetting.update({ where: { key }, data: { value: v } }));
  }
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  });
