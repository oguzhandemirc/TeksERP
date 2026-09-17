// =============================================================================
// BEKÇİ — FASON = CARİNİN ROLÜ: `Subcontractor.customerId` profili (kullanıcı kararı 2026-09-17)
// =============================================================================
// §1 bağ kur (create/update) → liste/detay `customer {id,code,name,type}`; cari detayı `subcontractor {id,isActive}`
// §2 yalnız-müşteri (CUSTOMER) cariye bağ → 400 "önce Müşteri + Tedarikçi" · pasif cari → 400 · yok → 400
// §3 aynı cariye ikinci profil → 409 (servis) + DB tekil index (doğrudan yazım P2002)
// §4 bağı kaldır (null) / başka cariye taşı / aynı cariye yeniden yazmak no-op
// §5 BAĞSIZ fasonun eski davranışı bayt-bayt: mal kabul XOR kapısı (`resolveSupplierParty`) aynen;
//    bağlı fason da `subcontractorId` ile hâlâ çözülür (uç imzası değişmedi)
// §6 liste süzgeci `filter[customerId]=null` → yalnız bağsız; `=<id>` → yalnız o bağ
// §7 global arama: bağlı fason satırının alt satırı "Cari: AD (KOD)", bağsızda null
// §8 cari BİRLEŞTİRME (8030): tek taraflı profil survivor'a TAŞINIR; iki kartın da profili varsa önizleme
//    blokçu + uygulama 409 "önce profilleri birleştirin" (sessiz SetNull/sıfırlama YOK)
// §9 FK `onDelete: Restrict`: profili olan cari sert silinemez (PG 23503), bağ kaldırılınca silinir
// Negatif sondalar (yazılırken kırmızı görüldü): `assertProfileCustomer` tip kolu kaldırılınca §2 ❌;
// `findAll` `null` süzgeci kaldırılınca §6 ❌; merge haritasından `subcontractors` satırı silinince §8 ❌
// (kaynak profili tombstone'a bakar kalır); FK SET NULL'a dönünce §9 ❌.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik yalnız `temizle`de.
// Koşum: npx tsx scripts/test_subcontractor_customer_profile.ts
// =============================================================================
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import {
  PROFILE_CUSTOMER_TAKEN_MESSAGE,
  PROFILE_CUSTOMER_TYPE_MESSAGE,
  SubcontractorManagementService,
} from "../src/services/subcontractor-management.service";
import { customerService } from "../src/routes/customer.routes";
import { resolveSupplierParty } from "../src/services/helpers/supplier-party.helper";
import { searchService } from "../src/services/search.service";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
const status = (e: unknown) => (e instanceof AppError ? e.statusCode : -1);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
async function hata(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}
const fakeReq = (query: Record<string, unknown>) => ({ query } as unknown as Request);

const svc = new SubcontractorManagementService();
const stamp = Date.now().toString(36);
const T = `TEST-FSNPRF-${stamp}`;
const ids = { cariSup: "", cariBoth: "", cariMus: "", cariPasif: "", subBagli: "", subBagsiz: "", subIkinci: "", cariM1: "", cariM2: "", cariM3: "" };

type Row = { id: string; customer?: { id: string; code: string; name: string; type: string } | null };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU: ${engel}`);

  const cari = async (suffix: string, type: "CUSTOMER" | "SUPPLIER" | "BOTH", isActive = true) =>
    (await prisma.customer.create({ data: { code: `${T}-${suffix}`, name: `${T} ${suffix} A.Ş.`, type, isActive }, select: { id: true } })).id;
  ids.cariSup = await cari("SUP", "SUPPLIER");
  ids.cariBoth = await cari("BOTH", "BOTH");
  ids.cariMus = await cari("MUS", "CUSTOMER");
  ids.cariPasif = await cari("PASIF", "SUPPLIER", false);

  try {
    console.log("\n§1 bağ kur → projeksiyonlar");
    const r1 = await svc.create({ code: `${T}-S1`, name: `${T} Boyahane`, customerId: ids.cariSup }, undefined);
    ids.subBagli = (r1.data as Row).id;
    const d1 = (await svc.findById(ids.subBagli)).data as Row;
    check("create(customerId) → detayda customer {id,code,name,type}", d1.customer?.id === ids.cariSup && d1.customer?.type === "SUPPLIER" && d1.customer?.code === `${T}-SUP`, JSON.stringify(d1.customer));
    const r2 = await svc.create({ code: `${T}-S2`, name: `${T} Zımpara` }, undefined);
    ids.subBagsiz = (r2.data as Row).id;
    check("customerId verilmeyen create → bağsız (customer null)", (r2.data as Row).customer === null);
    const cariDetay = (await customerService.findById(ids.cariSup)).data as { subcontractor?: { id: string; isActive: boolean } | null };
    check("cari detayı `subcontractor {id,isActive}` taşır (defaultInclude)", cariDetay.subcontractor?.id === ids.subBagli && cariDetay.subcontractor?.isActive === true, JSON.stringify(cariDetay.subcontractor));
    const bagsizCari = (await customerService.findById(ids.cariBoth)).data as { subcontractor?: { id: string } | null };
    check("profilsiz cari → subcontractor null", bagsizCari.subcontractor === null);

    console.log("\n§2 tip/aktiflik/varlık kapısı");
    const eMus = await hata(() => svc.create({ code: `${T}-S3`, name: `${T} Yalnız Müşteri`, customerId: ids.cariMus }, undefined));
    check("CUSTOMER tipli cariye bağ → 400 'önce Müşteri + Tedarikçi'", status(eMus) === 400 && msg(eMus) === PROFILE_CUSTOMER_TYPE_MESSAGE, msg(eMus));
    check("400'de fason KAYDI doğmadı", (await prisma.subcontractor.count({ where: { code: `${T}-S3` } })) === 0);
    const ePasif = await hata(() => svc.update(ids.subBagsiz, { customerId: ids.cariPasif }, undefined));
    check("pasif cariye bağ → 400", status(ePasif) === 400 && msg(ePasif).includes("pasif"), msg(ePasif));
    const eYok = await hata(() => svc.update(ids.subBagsiz, { customerId: "00000000-0000-4000-8000-000000000000" }, undefined));
    check("olmayan cariye bağ → 400", status(eYok) === 400, msg(eYok));
    check("bağsız fason hâlâ bağsız (400'ler yazmadı)", (await prisma.subcontractor.findUnique({ where: { id: ids.subBagsiz }, select: { customerId: true } }))?.customerId === null);

    console.log("\n§3 tekillik");
    const eIkinci = await hata(() => svc.create({ code: `${T}-S4`, name: `${T} İkinci Profil`, customerId: ids.cariSup }, undefined));
    check("aynı cariye ikinci profil (create) → 409", status(eIkinci) === 409 && msg(eIkinci) === PROFILE_CUSTOMER_TAKEN_MESSAGE, msg(eIkinci));
    const eIkinciUpd = await hata(() => svc.update(ids.subBagsiz, { customerId: ids.cariSup }, undefined));
    check("aynı cariye ikinci profil (update) → 409", status(eIkinciUpd) === 409, msg(eIkinciUpd));
    const eDb = await hata(() => prisma.subcontractor.create({ data: { code: `${T}-S5`, name: `${T} DB Seddi`, customerId: ids.cariSup } }));
    check("DB seddi: doğrudan yazım P2002 (customerId tekil index)", eDb instanceof Prisma.PrismaClientKnownRequestError && eDb.code === "P2002", msg(eDb).slice(0, 80));

    console.log("\n§4 bağı kaldır / taşı / no-op");
    await svc.update(ids.subBagli, { customerId: null }, undefined);
    check("update(customerId:null) → bağ kalktı, kayıt duruyor", (await prisma.subcontractor.findUnique({ where: { id: ids.subBagli }, select: { customerId: true, isActive: true } }))?.customerId === null);
    await svc.update(ids.subBagli, { customerId: ids.cariBoth }, undefined);
    check("update(customerId:BOTH cari) → taşındı", (await prisma.subcontractor.findUnique({ where: { id: ids.subBagli }, select: { customerId: true } }))?.customerId === ids.cariBoth);
    const noop = await hata(() => svc.update(ids.subBagli, { customerId: ids.cariBoth, name: `${T} Boyahane 2` }, undefined));
    check("aynı cariye yeniden yazmak no-op (409 yok)", noop === null, msg(noop));
    const r3 = await svc.create({ code: `${T}-S6`, name: `${T} Üçüncü`, customerId: ids.cariSup }, undefined);
    ids.subIkinci = (r3.data as Row).id;
    check("bağı kalkan cari yeni profile açık", (r3.data as Row).customer?.id === ids.cariSup);

    console.log("\n§5 bağsız fasonun eski davranışı (mal kabul XOR)");
    const p1 = await resolveSupplierParty({ subcontractorId: ids.subBagsiz }, { required: false });
    check("bağsız fason `subcontractorId` ile çözülür", p1.subcontractorId === ids.subBagsiz && p1.supplierId === null);
    const p2 = await resolveSupplierParty({ subcontractorId: ids.subBagli }, { required: false });
    check("bağlı fason da `subcontractorId` ile çözülür (uç imzası değişmedi)", p2.subcontractorId === ids.subBagli);
    const eXor = await hata(() => resolveSupplierParty({ subcontractorId: ids.subBagsiz, supplierId: ids.cariSup }, { required: false }));
    check("XOR aynen: ikisi birden → 400", status(eXor) === 400, msg(eXor));

    console.log("\n§6 liste süzgeci customerId");
    // `null` elle okunmazsa Prisma "null" dizesini uuid sanır ve fırlatır — o da KIRMIZI olsun, çökme değil.
    const nullSonuc = await svc.findAll(fakeReq({ "filter[customerId]": "null", pageSize: "500", search: T })).catch((e: unknown) => e);
    const yalnizBagsiz = nullSonuc instanceof Error ? [] : ((nullSonuc as { data: Row[] }).data);
    check(
      "filter[customerId]=null → yalnız bağsız (fırlatmaz)",
      !(nullSonuc instanceof Error) && yalnizBagsiz.some((r) => r.id === ids.subBagsiz) && !yalnizBagsiz.some((r) => r.id === ids.subBagli || r.id === ids.subIkinci),
      nullSonuc instanceof Error ? msg(nullSonuc).slice(0, 80) : `${yalnizBagsiz.length} satır`,
    );
    const yalnizBoth = (await svc.findAll(fakeReq({ "filter[customerId]": ids.cariBoth, pageSize: "500" }))).data as Row[];
    check("filter[customerId]=<id> → yalnız o bağ", yalnizBoth.length === 1 && yalnizBoth[0]!.id === ids.subBagli && yalnizBoth[0]!.customer?.type === "BOTH");
    const hepsi = (await svc.findAll(fakeReq({ pageSize: "500", search: T }))).data as Row[];
    check("süzgeçsiz liste üçünü de taşır, her satırda customer alanı var", [ids.subBagli, ids.subBagsiz, ids.subIkinci].every((id) => hepsi.some((r) => r.id === id)) && hepsi.every((r) => "customer" in r));

    console.log("\n§7 global arama alt satırı");
    const res = await searchService.search(`${T}`, { permissions: ["subcontractor:read"], limit: 10 });
    const grup = res.groups.find((g) => g.entity === "subcontractor");
    const bagli = grup?.rows.find((r) => r.id === ids.subBagli);
    const bagsiz = grup?.rows.find((r) => r.id === ids.subBagsiz);
    check("bağlı fason → subtitle 'Cari: AD (KOD)'", bagli?.subtitle === `Cari: ${T} BOTH A.Ş. (${T}-BOTH)`, bagli?.subtitle ?? "(satır yok)");
    check("bağsız fason → subtitle null", bagsiz !== undefined && bagsiz.subtitle === null);

    console.log("\n§8 cari birleştirme: profil taşınır / iki profil 409");
    ids.cariM1 = await cari("M1", "SUPPLIER");
    ids.cariM2 = await cari("M2", "SUPPLIER");
    ids.cariM3 = await cari("M3", "SUPPLIER");
    const pM2 = (await svc.create({ code: `${T}-S7`, name: `${T} M2 Profili`, customerId: ids.cariM2 }, undefined)).data as Row;
    const pv1 = await MasterDataMergeService.preview("customer", ids.cariM1, [ids.cariM2]);
    check("tek taraflı profil (kaynakta) → önizleme blokçusuz", pv1.canMerge, pv1.blockers.map((b) => b.key).join(",") || "blokçu yok");
    await MasterDataMergeService.merge("customer", { survivorId: ids.cariM1, sourceIds: [ids.cariM2], reason: "fason profili tasima sondasi", acknowledgedConflicts: pv1.conflicts.length });
    const tasinan = await prisma.subcontractor.findUnique({ where: { id: pM2.id }, select: { customerId: true } });
    check("⭐ profil survivor'a TAŞINDI (tombstone'a bakmıyor)", tasinan?.customerId === ids.cariM1, String(tasinan?.customerId));
    await svc.create({ code: `${T}-S8`, name: `${T} M3 Profili`, customerId: ids.cariM3 }, undefined);
    const pv2 = await MasterDataMergeService.preview("customer", ids.cariM1, [ids.cariM3]);
    check("⭐ iki kartın da profili var → önizleme blokçu CONFLICT_SUBCONTRACTORS", !pv2.canMerge && pv2.blockers.some((b) => b.key === "CONFLICT_SUBCONTRACTORS"), pv2.blockers.map((b) => b.key).join(","));
    const eMerge = await hata(() => MasterDataMergeService.merge("customer", { survivorId: ids.cariM1, sourceIds: [ids.cariM3], reason: "iki profil sondasi", acknowledgedConflicts: pv2.conflicts.length }));
    check("uygulama katmanı 409 'önce profilleri birleştirin' (çift kapı)", status(eMerge) === 409 && msg(eMerge).includes("önce profilleri birleştirin"), msg(eMerge));
    const m3Profil = await prisma.subcontractor.findFirst({ where: { code: `${T}-S8` }, select: { customerId: true } });
    check("409'da hiçbir profil koparılmadı (sessiz SetNull yok)", m3Profil?.customerId === ids.cariM3 && tasinan?.customerId === ids.cariM1);

    console.log("\n§9 FK onDelete Restrict");
    const eDel = await hata(() => prisma.customer.delete({ where: { id: ids.cariM3 } }));
    check("⭐ profili olan cari sert silinemez (FK Restrict)", eDel instanceof Prisma.PrismaClientKnownRequestError && eDel.code === "P2003", msg(eDel).slice(0, 60));
    check("silme denemesinde profil bağlı kaldı", (await prisma.subcontractor.findFirst({ where: { code: `${T}-S8` }, select: { customerId: true } }))?.customerId === ids.cariM3);
  } finally {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}

async function temizle(): Promise<void> {
  await prisma.subcontractor.deleteMany({ where: { code: { startsWith: T } } });
  await prisma.customer.deleteMany({ where: { code: { startsWith: T } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
