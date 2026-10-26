// =============================================================================
// STANDART MALİYET SÜRÜMÜ + UÇLAR BEKÇİSİ (MAL-2) — donmuş fotoğraf, yarış, geri alma, köprü
// =============================================================================
// Servis + middleware düzeyi, DB'li (yalnız test DB — `assertGelistirmeVeritabani`). Ölçülenler:
//   §1 kayıt → ACTIVE v1 (77,0395); iplik fiyatı değişir → v1 sayıları/dökümü DEĞİŞMEZ, liste
//      ve detay `girdiDegisti=true`; v2 → v1 SUPERSEDED (+damga), tek ACTIVE
//   §2 iki paralel kayıt → biri 409 COST_VERSION_CONFLICT, tek ACTIVE; §2b DB seddi: ikinci ACTIVE doğrudan yazılamaz
//   §3 eksik girdi → 400 COST_INPUT_MISSING `details.missing` (kur yok → FX_RATE_MISSING, 1'e düşmez)
//   §4 geri alma YENİ sürüm yazar (eski fotoğraf + kur), eskisini değiştirmez
//   §5 köprü: finans/devere/iplik/ticaret kapalıyken öneri null ve ilgili tabloya SORGU YOK
//      (Prisma delege sayacı); finans açıkken kur gelir (sayaç > 0 — sondanın kendisi canlı)
//   §6 önizleme yazmaz; modül kapalı 403 MODULE_DISABLED; `cost:read` yok 403
//   §7 liste: sunucuda durum süzgeci + cursor + özet şeridi
//   §8 belge: `docs/kurallar/defter.md` defter envanterinde sürüm satırı + ters yolu (YENİ SÜRÜM,
//      `restoredFromId`) beyanlı. NEGATİF SONDA (2026-10-25): satır silinince §8 2 ❌.
// Koşum: npx tsx scripts/test_standart_maliyet_surum.ts
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import * as svc from "../src/services/standard-cost.service";
import { previewCost } from "../src/services/cost-calc.service";
import { measuredWarpWaste, suggestFxRate, suggestYarnPrices } from "../src/services/helpers/maliyet-bridge.helper";
import { requireMaliyetEnabled } from "../src/middlewares/module.middleware";
import { requirePermission } from "../src/middlewares/rbac.middleware";
import { readCostItemStatuses } from "../src/routes/cost.routes";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
async function hata(fn: () => Promise<unknown>): Promise<{ status?: number; code?: string; missing?: string[] } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string; missing?: string[] } };
    return { status: err.statusCode, code: err.details?.code, missing: err.details?.missing };
  }
}
const FX = { USD: "34" };

/** Modül anahtarını geçici yazar; `fn` bitince eski değeri geri koyar. */
async function withSetting<T>(key: string, value: boolean, fn: () => Promise<T>): Promise<T> {
  const onceki = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return await fn();
  } finally {
    if (onceki) await prisma.systemSetting.update({ where: { key }, data: { value: onceki.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.delete({ where: { key } });
  }
}

/** Prisma model delegesine erişim sayacı — "sorgu atılmadı" kanıtı. */
function spy(models: string[]): { count: () => number; restore: () => void } {
  let n = 0;
  const client = prisma as unknown as Record<string, unknown>;
  const originals = models.map((m) => [m, client[m]] as const);
  for (const [m, orig] of originals) Object.defineProperty(client, m, { get: () => (n++, orig), configurable: true });
  return {
    count: () => n,
    restore: () => originals.forEach(([m, orig]) => Object.defineProperty(client, m, { value: orig, configurable: true, writable: true })),
  };
}

async function bolum1(f: MaliyetFikstur): Promise<string> {
  await altinYapiYaz(f);
  const v1 = await svc.createStandardCostVersion(f.fabricId, { fxRates: FX, reason: "ilk" });
  check("§1a ⭐ Kayıt → ACTIVE v1, standart 77,0395", v1.surumNo === 1 && v1.durum === "ACTIVE" && v1.standartTlM === "77.0395", `${v1.surumNo} ${v1.standartTlM}`);
  const lines1 = await prisma.standardCostLine.findMany({ where: { versionId: v1.id }, orderBy: { lineNo: "asc" } });
  check("§1b Döküm 11 kalem, toplamı ≈ standart", lines1.length === 11 && lines1.reduce((a, l) => a.plus(l.amountPerMTry), D(0)).minus("77.0395").abs().lte("0.001"));
  const d0 = await svc.getCostItem(f.fabricId);
  check("§1c Detay: girdi değişmedi", d0.girdiDegisti === false && d0.yapiDurumu === "TAM", `${d0.yapiDurumu} ${d0.uyarilar.join(",")}`);
  const old = await prisma.yarnCostPrice.findFirstOrThrow({ where: { yarnItemId: f.warpYarnId, revokedAt: null } });
  await prisma.yarnCostPrice.update({ where: { id: old.id }, data: { revokedAt: new Date(), revokeReason: "test" } });
  await prisma.yarnCostPrice.create({ data: { yarnItemId: f.warpYarnId, currency: "USD", pricePerKg: D("3.00"), note: f.tag } });
  const d1 = await svc.getCostItem(f.fabricId);
  const lines1b = await prisma.standardCostLine.findMany({ where: { versionId: v1.id }, orderBy: { lineNo: "asc" } });
  check("§1d ⭐ Fiyat değişti → v1 sayıları ve dökümü DEĞİŞMEZ (saklanan okunur)", d1.aktifSurum?.standartTlM === "77.0395" && JSON.stringify(lines1b) === JSON.stringify(lines1) && d1.aktifSurum?.satirlar?.[0]?.tutarTlM === lines1[0].amountPerMTry.toFixed(4));
  check("§1e Detay `girdiDegisti=true`", d1.girdiDegisti === true);
  const list = await svc.listCostItems({ q: f.tag });
  check("§1f Liste `girdiDegisti=true`", list.data.length === 1 && list.data[0].girdiDegisti === true);
  const v2 = await svc.createStandardCostVersion(f.fabricId, { fxRates: FX });
  const v1row = await prisma.standardCostVersion.findUniqueOrThrow({ where: { id: v1.id } });
  check("§1g v2 ACTIVE, v1 SUPERSEDED + damgalı", v2.surumNo === 2 && v2.durum === "ACTIVE" && v1row.status === "SUPERSEDED" && !!v1row.supersededAt && v2.standartTlM !== "77.0395", v2.standartTlM);
  check("§1h Tek ACTIVE; v2 sonrası girdi değişmedi", (await prisma.standardCostVersion.count({ where: { itemId: f.fabricId, status: "ACTIVE" } })) === 1 && (await svc.getCostItem(f.fabricId)).girdiDegisti === false);
  return v1.id;
}

async function bolum2(f: MaliyetFikstur): Promise<void> {
  const res = await Promise.allSettled([svc.createStandardCostVersion(f.fabricId, { fxRates: FX }), svc.createStandardCostVersion(f.fabricId, { fxRates: FX })]);
  const rejected = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  const codes = rejected.map((r) => `${(r.reason as { statusCode?: number }).statusCode}/${(r.reason as { details?: { code?: string } }).details?.code}`);
  const actives = await prisma.standardCostVersion.count({ where: { itemId: f.fabricId, status: "ACTIVE" } });
  check("§2 ⭐ İki paralel kayıt: en çok biri geçer, kaybeden 409, tek ACTIVE", actives === 1 && rejected.every((_, i) => codes[i] === "409/COST_VERSION_CONFLICT") && res.some((r) => r.status === "fulfilled"), `${codes.join(",")} active=${actives}`);
}

async function bolum3(f: MaliyetFikstur): Promise<void> {
  const before = await prisma.standardCostVersion.count({ where: { itemId: f.fabricId } });
  const e = await withSetting(SETTING_KEYS.FINANCE_ENABLED, false, () => hata(() => svc.createStandardCostVersion(f.fabricId, {})));
  check("§3a ⭐ Kur yok (finans kapalı, elle verilmedi) → 400 COST_INPUT_MISSING + FX_RATE_MISSING", e?.status === 400 && e.code === "COST_INPUT_MISSING" && !!e.missing?.includes("FX_RATE_MISSING"), JSON.stringify(e));
  await prisma.item.update({ where: { id: f.fabricId }, data: { warpSpecId: null } });
  const e2 = await hata(() => svc.createStandardCostVersion(f.fabricId, { fxRates: FX }));
  await prisma.item.update({ where: { id: f.fabricId }, data: { warpSpecId: f.warpSpecId } });
  check("§3b Çözgü kartı yok → details.missing WARP_SPEC_MISSING", e2?.status === 400 && !!e2.missing?.includes("WARP_SPEC_MISSING"), JSON.stringify(e2));
  check("§3c Eksikte hiçbir sürüm yazılmadı", (await prisma.standardCostVersion.count({ where: { itemId: f.fabricId } })) === before);
}

async function bolum4(f: MaliyetFikstur, v1Id: string): Promise<void> {
  const before = await prisma.standardCostVersion.findUniqueOrThrow({ where: { id: v1Id }, include: { lines: true } });
  const v = await svc.restoreStandardCostVersion(f.fabricId, v1Id, {});
  const after = await prisma.standardCostVersion.findUniqueOrThrow({ where: { id: v1Id }, include: { lines: true } });
  check("§4a ⭐ Geri alma YENİ ACTIVE sürüm yazar, v1 tutarıyla (77,0395)", v.durum === "ACTIVE" && v.standartTlM === "77.0395" && v.geriAlinanSurumId === v1Id && v.surumNo > 2);
  check("§4b Eski sürüm değişmez (satır + kalemler birebir)", JSON.stringify(before) === JSON.stringify(after));
  check("§4c Geri alınan sürüm canlı girdiden farklı → girdiDegisti=true", (await svc.getCostItem(f.fabricId)).girdiDegisti === true);
  const e = await hata(() => svc.restoreStandardCostVersion(f.weftAId, v1Id, {}));
  check("§4d Başka ürünün sürümü geri alınamaz → 404", e?.status === 404);
}

async function bolum5(f: MaliyetFikstur): Promise<void> {
  const keys = [SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.TICARET_ENABLED];
  const offAll = <T>(fn: () => Promise<T>) => keys.reduceRight<() => Promise<T>>((inner, k) => () => withSetting(k, false, inner), fn)();
  const s = spy(["exchangeRate", "warpBeam", "warpBeamEvent", "yarnMovement", "itemPrice"]);
  try {
    const [fx, waste, yp] = await offAll(async () => [await suggestFxRate("USD", new Date()), await measuredWarpWaste(f.warpSpecId), await suggestYarnPrices(f.warpYarnId)] as const);
    check("§5a ⭐ Modüller kapalı: öneriler null ve ilgili tablolara SIFIR sorgu", fx === null && waste === null && yp.sonGiris === null && yp.alisFiyati === null && s.count() === 0, `sorgu=${s.count()}`);
    check("§5b TRY kuru tanım gereği 1 (sorgusuz)", (await suggestFxRate("TRY", new Date()))?.eq(1) === true && s.count() === 0);
  } finally {
    s.restore();
  }
  const rateDate = new Date(Date.UTC(2000, 0, 3));
  await prisma.exchangeRate.deleteMany({ where: { rateDate, currency: "USD" } });
  await prisma.exchangeRate.create({ data: { rateDate, currency: "USD", rate: D("12.5") } });
  const s2 = spy(["exchangeRate"]);
  try {
    const r = await withSetting(SETTING_KEYS.FINANCE_ENABLED, true, () => suggestFxRate("USD", new Date(Date.UTC(2000, 0, 5))));
    check("§5c Sonda canlı: finans açıkken kur gelir (sayaç > 0)", r?.eq("12.5") === true && s2.count() > 0, `${r?.toString()} sorgu=${s2.count()}`);
  } finally {
    s2.restore();
    await prisma.exchangeRate.deleteMany({ where: { rateDate, currency: "USD" } });
  }
}

async function bolum6(f: MaliyetFikstur): Promise<void> {
  const nV = await prisma.standardCostVersion.count();
  const nA = await prisma.systemLog.count();
  const p = await previewCost({ itemId: f.fabricId, fxRates: FX, overrides: { warpWastePct: "2.5" } });
  check("§6a Önizleme sonuç verir, eksik yok", p.sonuc !== null && p.eksikler.length === 0 && p.girdi.warp?.wastePct.source === "ELLE");
  check("§6b ⭐ Önizleme YAZMAZ (sürüm/audit sayısı aynı)", (await prisma.standardCostVersion.count()) === nV && (await prisma.systemLog.count()) === nA);
  const pNoFx = await withSetting(SETTING_KEYS.FINANCE_ENABLED, false, () => previewCost({ itemId: f.fabricId }));
  check("§6c Önizlemede kur yok → sonuç null + FX_RATE_MISSING (1'e düşmez)", pNoFx.sonuc === null && pNoFx.eksikler.includes("FX_RATE_MISSING"));
  const gate = (): Promise<{ statusCode?: number; details?: { code?: string } } | null> =>
    new Promise((resolve) => void requireMaliyetEnabled({} as never, {} as never, (err?: unknown) => resolve((err as never) ?? null)));
  const g = await withSetting(SETTING_KEYS.MALIYET_ENABLED, false, gate);
  check("§6d Modül kapalı → 403 MODULE_DISABLED", g?.statusCode === 403 && g.details?.code === "MODULE_DISABLED");
  const perm = await new Promise<{ statusCode?: number } | null>((resolve) =>
    requirePermission("cost:read")({ user: { userId: "x", permissions: ["order:read"] } } as never, {} as never, (err?: unknown) => resolve((err as never) ?? null)),
  );
  check("§6e `cost:read` yok → 403", perm?.statusCode === 403);
}

async function bolum7(f: MaliyetFikstur): Promise<void> {
  const tam = await svc.listCostItems({ q: f.tag, durum: ["TAM"] });
  const eksik = await svc.listCostItems({ q: f.tag, durum: ["YAPI_EKSIK"] });
  check("§7a Sunucuda durum süzgeci (TAM 1, YAPI_EKSIK 0) + özet süzgeçten bağımsız", tam.data.length === 1 && eksik.data.length === 0 && eksik.ozet.toplam === 1 && eksik.ozet.TAM === 1);
  const all = await svc.listCostItems({ limit: 1 });
  check("§7b Cursor: limit 1 → sonraki sayfa imleci (kumaş > 1 ise)", all.data.length <= 1 && (all.toplamSuzulen > 1 ? all.nextCursor !== null : all.nextCursor === null));
  if (all.nextCursor) {
    const next = await svc.listCostItems({ limit: 1, cursor: all.nextCursor });
    check("§7c İkinci sayfa farklı kalem", next.data[0]?.itemId !== all.data[0]?.itemId);
  }
  // Express "simple" ayrıştırıcı `filter[durum]` anahtarını DÜZ bırakır — panel bu biçimi yollar.
  const q = (query: Record<string, string>) => ({ query }) as never;
  const status400 = (fn: () => unknown): boolean => { try { fn(); return false; } catch (e) { return (e as { statusCode?: number }).statusCode === 400; } };
  const parsed = readCostItemStatuses(q({ "filter[durum]": "TAM,YAPI_EKSIK" }));
  check("§7d Route: düz `filter[durum]` CSV okunur (süzgeç sessizce düşmez)", parsed.join(",") === "TAM,YAPI_EKSIK", parsed.join(","));
  check("§7e Route: çıplak `durum=` ve tanınmayan durum → 400", status400(() => readCostItemStatuses(q({ durum: "TAM" }))) && status400(() => readCostItemStatuses(q({ "filter[durum]": "X" }))));
}

/**
 * DB seddi: uygulama claim'i + (itemId, versionNo) unique yarışı zaten keser; kısmi unique indeks
 * "ürün başına tek ACTIVE"yi uygulamayı atlayan yazıma karşı da tutar — doğrudan ikinci ACTIVE reddedilir.
 */
async function bolum2b(f: MaliyetFikstur): Promise<void> {
  const act = await prisma.standardCostVersion.findFirstOrThrow({ where: { itemId: f.fabricId, status: "ACTIVE" } });
  const { id: _id, versionNo, supersededAt: _s, restoredFromId: _r, ...rest } = act;
  const data = { ...rest, versionNo: versionNo + 1000, fxRates: rest.fxRates as Prisma.InputJsonValue, inputSnapshot: rest.inputSnapshot as Prisma.InputJsonValue, warnings: rest.warnings as Prisma.InputJsonValue };
  let code: string | undefined;
  try {
    const extra = await prisma.standardCostVersion.create({ data, select: { id: true } });
    await prisma.standardCostVersion.delete({ where: { id: extra.id } });
  } catch (e) {
    code = (e as { code?: string }).code;
  }
  check("§2b ⭐ DB seddi: aynı ürüne ikinci ACTIVE doğrudan yazılamaz (P2002, kısmi unique indeks)", code === "P2002", String(code));
}

function bolum8(): void {
  const md = readFileSync(join(__dirname, "../../docs/kurallar/defter.md"), "utf8");
  const satir = md.split("\n").find((l) => l.startsWith("| `StandardCostVersion`")) ?? "";
  check("§8a defter.md envanterinde StandardCostVersion (+StandardCostLine) satırı var", satir.includes("`StandardCostLine`"), satir.slice(0, 60));
  check("§8b ters yol beyanı: geri alma YENİ SÜRÜM (`restoredFromId`), eskisi değişmez", satir.includes("YENİ SÜRÜM") && satir.includes("`restoredFromId`"));
}

async function main(): Promise<void> {
  console.log("=== STANDART MALİYET SÜRÜMÜ BEKÇİSİ (MAL-2) ===");
  bolum8();
  assertGelistirmeVeritabani("test_standart_maliyet_surum");
  const f = await fiksturKur("SMS");
  try {
    const v1 = await bolum1(f);
    await bolum2(f);
    await bolum3(f);
    await bolum4(f, v1);
    await bolum5(f);
    await bolum6(f);
    await bolum7(f);
    await bolum2b(f);
  } finally {
    await fiksturSil(f);
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
