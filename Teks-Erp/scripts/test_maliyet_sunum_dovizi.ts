// =============================================================================
// MALİYET SUNUM DÖVİZİ BEKÇİSİ (SY-J1; tasarım §11 J, §15.5)
// =============================================================================
// Servis düzeyi, DB'li (yalnız test DB). Ölçülenler:
//   §1 ⭐ ayar yok (TRY) → önizleme `sonuc`, sürüm, detay, liste anahtar kümesi BUGÜNKÜ (sunum alanı YOK)
//   §2 USD → sürüm yanıtı kur + döviz/m (= TL/kur, 4 hane) + her kalemde `tutarDoviz`, kaynak SURUM
//   §3 ⭐ NEGATİF SONDA HEDEFİ: önizleme günün kuruyla (ONIZLEME) gelir; kayıtlı sürümün kuru
//      DONMUŞTUR — detay/ürün/liste yanıtı önizleme kuruna kaymaz
//   §4 kur yok (EUR, sürümde yalnız USD) → döviz alanları null + FX_MISSING (0 ya da 1 değil)
//   §5 sunum dövizi girdinin dövizi değilse de sürüm yaratımında kuru `fxRates`e donar (§11.9)
//   §6 teklif dövizi ön seçimi: TRY → TRY (fiyat listesine bakmaz) · USD → ayar · yayındaki liste dövizi önce
//   §7 ayar kapısı: tanınmayan değer 400; DB'deki çöp değer TRY'ye düşer
// NEGATİF SONDA (2026-10-31): `presentVersion` kuru `frozenRate(v.fxRates…)` yerine canlı önizleme kuruyla
//   (sabit 40) beslenince §2a–c, §3b–d, §4, §5 ❌ (8); `withPresentation` TRY’de de alan yazınca §1a–c ❌ (3).
// Koşum: npx tsx scripts/test_maliyet_sunum_dovizi.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import * as svc from "../src/services/standard-cost.service";
import { previewCost } from "../src/services/cost-calc.service";
import { suggestQuoteCurrency } from "../src/services/quote-currency.service";
import { readCostPresentationCurrency, SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { assertGelistirmeVeritabani } from "./db-guard";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const KEY = SETTING_KEYS.COST_PRESENTATION_CURRENCY;
const SUNUM = ["sunumDovizi", "sunumKuru", "sunumKuruKaynagi", "sunumUyarisi", "standartDovizM"];
const setSetting = (key: string, v: string | null) =>
  v === null ? prisma.systemSetting.deleteMany({ where: { key } }) : prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
const keysOf = (o: object | null | undefined) => Object.keys(o ?? {}).sort().join(",");
const hasNoPresentation = (o: object | null | undefined) => SUNUM.every((k) => !(k in (o ?? {})));
const div4 = (a: string, b: string) => new Prisma.Decimal(a).div(b).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);

async function bolum1(f: MaliyetFikstur): Promise<void> {
  await setSetting(SETTING_KEYS.COST_PRESENTATION_CURRENCY, null);
  const p = await previewCost({ itemId: f.fabricId, fxRates: { USD: "34" } });
  check(
    "§1a ⭐ TRY: önizleme `sonuc` anahtarları bugünkü küme",
    keysOf(p.sonuc) === "atkiKgM,cozguKgM,genelGiderTlM,hamTlM,mamulTlM,saglamTlM,satirlar,standartTlM,tezgahMSaat",
    keysOf(p.sonuc),
  );
  check("§1b TRY: kalemlerde `tutarDoviz` yok, kurlar yalnız girdinin dövizi", !!p.sonuc && p.sonuc.satirlar.every((l) => !("tutarDoviz" in l)) && keysOf(p.kurlar.kurlar) === "USD");
  const v = await svc.createStandardCostVersion(f.fabricId, { fxRates: { USD: "34" } });
  const d = await svc.getStandardCostVersion(f.fabricId, v.id);
  const item = await svc.getCostItem(f.fabricId);
  const list = await svc.listCostItems({ q: f.tag });
  check("§1c ⭐ TRY: sürüm/detay/ürün/liste yanıtında sunum alanı YOK", [v, d, item.aktifSurum, list.data[0]?.aktifSurum].every(hasNoPresentation) && (d.satirlar ?? []).every((l) => !("tutarDoviz" in l)));
}

async function bolum2(f: MaliyetFikstur): Promise<string> {
  await setSetting(SETTING_KEYS.COST_PRESENTATION_CURRENCY, "USD");
  const v = await svc.createStandardCostVersion(f.fabricId, { fxRates: { USD: "34" } });
  const d = (await svc.getStandardCostVersion(f.fabricId, v.id)) as Record<string, unknown> & { standartTlM: string; satirlar: { tutarTlM: string; tutarDoviz?: string | null }[] };
  check("§2a USD: kur 34, kaynak SURUM, uyarı yok", d.sunumDovizi === "USD" && d.sunumKuru === "34" && d.sunumKuruKaynagi === "SURUM" && d.sunumUyarisi === null, JSON.stringify([d.sunumKuru, d.sunumKuruKaynagi]));
  check("§2b ⭐ standart döviz/m = standart TL/m ÷ kur (4 hane, sunucuda)", d.standartDovizM === div4(d.standartTlM, "34"), `${String(d.standartDovizM)} ${d.standartTlM}`);
  check("§2c Her kalemde tutarDoviz = tutarTlM ÷ kur", d.satirlar.length > 0 && d.satirlar.every((l) => l.tutarDoviz === div4(l.tutarTlM, "34")));
  return v.id;
}

async function bolum3(f: MaliyetFikstur, versionId: string): Promise<void> {
  const p = await previewCost({ itemId: f.fabricId, fxRates: { USD: "40" } });
  const s = p.sonuc as (Record<string, unknown> & { standartTlM: string }) | null;
  check("§3a Önizleme günün kuruyla: kur 40, kaynak ONIZLEME", s?.sunumKuru === "40" && s?.sunumKuruKaynagi === "ONIZLEME" && s?.standartDovizM === div4(s.standartTlM, "40"), JSON.stringify([s?.sunumKuru, s?.sunumKuruKaynagi]));
  const d = (await svc.getStandardCostVersion(f.fabricId, versionId)) as Record<string, unknown>;
  check("§3b ⭐ Kayıtlı sürüm detayı DONMUŞ kurla (34) — önizleme kuru sızmaz", d.sunumKuru === "34" && d.sunumKuruKaynagi === "SURUM", String(d.sunumKuru));
  const item = (await svc.getCostItem(f.fabricId)).aktifSurum as Record<string, unknown> | null;
  check("§3c ⭐ Ürün ekranının aktif sürümü donmuş kurla (34)", item?.sunumKuru === "34", String(item?.sunumKuru));
  const row = (await svc.listCostItems({ q: f.tag })).data[0]?.aktifSurum as Record<string, unknown> | null;
  check("§3d ⭐ Liste satırı donmuş kurla (34)", row?.sunumKuru === "34" && row?.standartDovizM === div4(String(row?.standartTlM), "34"), String(row?.sunumKuru));
}

async function bolum4(f: MaliyetFikstur, versionId: string): Promise<void> {
  await setSetting(SETTING_KEYS.COST_PRESENTATION_CURRENCY, "EUR");
  const d = (await svc.getStandardCostVersion(f.fabricId, versionId)) as Record<string, unknown> & { satirlar: { tutarDoviz?: string | null }[] };
  check("§4 ⭐ Sürümde EUR kuru yok → kur/döviz null + FX_MISSING (1 varsayılmaz)", d.sunumDovizi === "EUR" && d.sunumKuru === null && d.standartDovizM === null && d.sunumUyarisi === "FX_MISSING" && d.satirlar.every((l) => l.tutarDoviz === null));
}

async function bolum5(f: MaliyetFikstur): Promise<void> {
  const v = await svc.createStandardCostVersion(f.fabricId, { fxRates: { USD: "34", EUR: "37" } });
  const row = await prisma.standardCostVersion.findUniqueOrThrow({ where: { id: v.id }, select: { fxRates: true } });
  const kurlar = (row.fxRates as { kurlar: Record<string, string> }).kurlar;
  check("§5 Sunum dövizi (EUR) girdide yok ama kuru sürüme DONDU", kurlar.EUR === "37" && kurlar.USD === "34" && (v as Record<string, unknown>).sunumKuru === "37", JSON.stringify(kurlar));
}

async function bolum6(f: MaliyetFikstur): Promise<void> {
  const cust = await prisma.customer.create({ data: { code: `${f.tag}-M`.slice(0, 32), name: `${f.tag} müşteri`, isCustomerRole: true }, select: { id: true } });
  try {
    await setSetting(SETTING_KEYS.COST_PRESENTATION_CURRENCY, "USD");
    const a = await suggestQuoteCurrency(cust.id);
    check("§6a USD, yayınlı liste yok → ayar dövizi (AYAR)", a.doviz === "USD" && a.kaynak === "AYAR", JSON.stringify(a));
    await prisma.priceList.create({ data: { listNo: `${f.tag}-FL`.slice(0, 32), clientToken: randomUUID(), name: `${f.tag} liste`, customerId: cust.id, currency: "EUR", status: "PUBLISHED", publishedAt: new Date() } });
    const b = await suggestQuoteCurrency(cust.id);
    check("§6b Müşterinin yayındaki listesi EUR → EUR (FIYAT_LISTESI)", b.doviz === "EUR" && b.kaynak === "FIYAT_LISTESI", JSON.stringify(b));
    await setSetting(SETTING_KEYS.COST_PRESENTATION_CURRENCY, null);
    const c = await suggestQuoteCurrency(cust.id);
    check("§6c ⭐ Ayar TRY (varsayılan) → bugünkü gibi TRY, liste okunmaz", c.doviz === "TRY" && c.kaynak === "VARSAYILAN", JSON.stringify(c));
  } finally {
    await prisma.priceList.deleteMany({ where: { customerId: cust.id } });
    await prisma.customer.delete({ where: { id: cust.id } });
  }
}

async function bolum7(): Promise<void> {
  let status: number | undefined;
  try {
    await systemSettingService.setFeatureFlags({ costPresentationCurrency: "GBP" as never }, (await ensureTestAdmin()).id);
  } catch (e) {
    status = (e as { statusCode?: number }).statusCode;
  }
  check("§7a Tanınmayan değer (GBP) → 400", status === 400, String(status));
  await setSetting(SETTING_KEYS.COST_PRESENTATION_CURRENCY, "BELKI");
  check("§7b DB'deki çöp değer TRY'ye düşer", (await readCostPresentationCurrency()) === "TRY");
}

async function main(): Promise<void> {
  console.log("=== MALİYET SUNUM DÖVİZİ BEKÇİSİ (SY-J1) ===");
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  assertGelistirmeVeritabani("test_maliyet_sunum_dovizi");
  const before = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
  const f = await fiksturKur("SUN");
  try {
    await altinYapiYaz(f);
    await bolum1(f);
    const v = await bolum2(f);
    await bolum3(f, v);
    await bolum4(f, v);
    await bolum5(f);
    await bolum6(f);
    await bolum7();
  } finally {
    await fiksturSil(f);
    if (before) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.COST_PRESENTATION_CURRENCY }, data: { value: before.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.COST_PRESENTATION_CURRENCY } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
