// =============================================================================
// FASON TARİFESİ FİYAT DIŞI DÜZENLEME BEKÇİSİ (B18/6)
// =============================================================================
// Ölçülenler:
//   §1 ad/not/hizmet kartı aktif satırda YERİNDE değişir: yeni sürüm yok, satır sayısı aynı, fiyat/baz/para aynı
//   §2 aynı değerler → no-op (wrote=false); boş gövde 400; boş ad 400; pasif hizmet kartı 400
//   §3 damgalı (eski sürüm) satır 409 COST_RATE_STALE, bilinmeyen id 404; köprü null ile kaldırılır
//   §4 bayat updatedAt claim'i 409 (eşzamanlı düzenleme)
//   §5 fiyat değişimi hâlâ yeni sürüm ve düzenlenmiş köprü/adı TAŞIR
//   §6 statik: PATCH gövde şeması `.strict()` ve fiyat alanı içermez; uç `cost:write` ister
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_tarife_fiyat_disi_duzenle.ts
// NEGATİF SONDA — 2026-11-24: (a) claim WHERE'inden `updatedAt` çıkarılınca §4a ❌ (13/1, "B yazdı");
//   (b) `revokedAt` 409 dalı + claim'deki aktif süzgeci kaldırılınca §3a ❌ (13/1). Geri alındı, 14/0.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { changeFinishingRate, updateFinishingRateDetails } from "../src/services/finishing-rate.service";
import { assertGelistirmeVeritabani } from "./db-guard";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (e) {
    return e instanceof AppError ? `${e.statusCode}:${String(e.details?.code ?? "")}` : String(e);
  }
};

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    process.exitCode = 1;
    return;
  }
  assertGelistirmeVeritabani("test_tarife_fiyat_disi_duzenle");
  const tag = `TEST-TFD-${Date.now().toString(36)}`;
  const code = `${tag}-R`.slice(0, 32);
  const services: string[] = [];
  try {
    const svc = (await prisma.serviceItem.create({ data: { code: `${tag}-S1`.slice(0, 32), name: `${tag} boya` }, select: { id: true } })).id;
    const svcOff = (await prisma.serviceItem.create({ data: { code: `${tag}-S2`.slice(0, 32), name: `${tag} pasif`, lifecycleStatus: "ARCHIVED", isActive: false }, select: { id: true } })).id;
    services.push(svc, svcOff);
    const base = { code, name: `${tag} apre`, basis: "RAW_M" as const, currency: "USD" as const, pricePerM: "0.05", typicalShrinkPct: "4" };
    const v1 = await changeFinishingRate({ ...base, serviceItemId: null });

    // §1
    const e1 = await updateFinishingRateDetails(v1.row.id, { name: `${tag} apre yeni`, note: "sabah bağlandı", serviceItemId: svc });
    const count1 = await prisma.finishingRate.count({ where: { code } });
    check("§1a ⭐ yerinde güncellendi (aynı id, wrote, yeni sürüm yok)", e1.wrote && e1.row.id === v1.row.id && count1 === 1, `count=${count1}`);
    check("§1b alanlar yazıldı, fiyat/baz/para/çekme aynı",
      e1.row.name === `${tag} apre yeni` && e1.row.note === "sabah bağlandı" && e1.row.serviceItemId === svc && e1.row.serviceItem?.id === svc &&
        e1.row.pricePerM.toFixed(4) === "0.0500" && e1.row.basis === "RAW_M" && e1.row.currency === "USD" && e1.row.typicalShrinkPct?.toFixed(2) === "4.00" &&
        e1.row.revokedAt === null);

    // §2
    const e2 = await updateFinishingRateDetails(v1.row.id, { name: `${tag} apre yeni`, serviceItemId: svc });
    check("§2a aynı değerler → no-op", !e2.wrote);
    check("§2b boş gövde 400", (await codeOf(() => updateFinishingRateDetails(v1.row.id, {}))).startsWith("400"));
    check("§2c boş ad 400", (await codeOf(() => updateFinishingRateDetails(v1.row.id, { name: "  " }))).startsWith("400"));
    check("§2d pasif hizmet kartı 400", (await codeOf(() => updateFinishingRateDetails(v1.row.id, { serviceItemId: svcOff }))).startsWith("400"));

    // §4 yarış: elle açık tutulan tx satırı güncelliyor (commit'siz); servis eski görüntüyü okur, claim'i satır
    // kilidinde bekler, A commit edince WHERE yeniden değerlendirilir → updatedAt tutmaz → 409.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let lockedSignal!: () => void;
    const locked = new Promise<void>((r) => { lockedSignal = r; });
    const holder = prisma.$transaction(async (tx) => {
      await tx.finishingRate.update({ where: { id: v1.row.id }, data: { note: "A yazdı" } });
      lockedSignal();
      await gate;
    }, { timeout: 15_000 });
    await locked;
    const racer = codeOf(() => updateFinishingRateDetails(v1.row.id, { note: "B yazdı" }));
    await new Promise((r) => setTimeout(r, 400));
    release();
    await holder;
    const stale = await racer;
    const noteNow = (await prisma.finishingRate.findUniqueOrThrow({ where: { id: v1.row.id }, select: { note: true } })).note;
    check("§4a ⭐ eşzamanlı düzenleme: ikinci yazar 409, birincinin yazdığı kalır", stale === "409:COST_RATE_STALE" && noteNow === "A yazdı", `${stale} · ${noteNow}`);
    await updateFinishingRateDetails(v1.row.id, { note: "sabah bağlandı" });

    // §5 fiyat değişimi yeni sürüm + düzenlenmiş köprü/ad taşınır (alan gönderilmeden).
    const v2 = await changeFinishingRate({ ...base, name: `${tag} apre yeni`, pricePerM: "0.06", note: "sabah bağlandı" });
    check("§5a fiyat değişimi yeni sürüm, köprü taşındı", v2.wrote && v2.row.id !== v1.row.id && v2.row.serviceItemId === svc && v2.previousId === v1.row.id);

    // §3
    check("§3a ⭐ damgalı eski sürüm 409 COST_RATE_STALE", (await codeOf(() => updateFinishingRateDetails(v1.row.id, { note: "eski" }))) === "409:COST_RATE_STALE");
    check("§3b bilinmeyen id 404", (await codeOf(() => updateFinishingRateDetails("00000000-0000-4000-8000-000000000000", { note: "y" }))).startsWith("404"));
    const e3 = await updateFinishingRateDetails(v2.row.id, { serviceItemId: null, note: null });
    check("§3c köprü ve not null ile kaldırılır", e3.wrote && e3.row.serviceItemId === null && e3.row.note === null);
    const old = await prisma.finishingRate.findUniqueOrThrow({ where: { id: v1.row.id }, select: { serviceItemId: true, pricePerM: true } });
    check("§3d eski sürüm değişmedi (sürüm defteri korunur)", old.serviceItemId === svc && old.pricePerM.toFixed(4) === "0.0500");

    // §6 statik
    const src = readFileSync(path.join(__dirname, "../src/routes/cost.routes.ts"), "utf8");
    const m = src.match(/const finishingRateDetailsSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\);/);
    check("§6a ⭐ PATCH şeması strict ve fiyat alanı yok", !!m && !/pricePerM|basis|currency|typicalShrinkPct|subcontractorId|code:/.test(m[1]));
    check("§6b PATCH ucu cost:write ister", /router\.patch\("\/finishing-rates\/:id", requirePermission\("cost:write"\)/.test(src));
  } finally {
    await prisma.finishingRate.deleteMany({ where: { code } });
    await prisma.serviceItem.deleteMany({ where: { id: { in: services } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
  }
}

void main();
