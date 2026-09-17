// =============================================================================
// BEKÇİ — İŞ ORTAĞI ROL MODELİ (SAP BP sadeleştirilmiş, kullanıcı kararı 2026-09-17) — D1
// =============================================================================
// §1 BACKFILL doğruluğu: migration dosyasındaki UPDATE'ler gerçek satırlara koşulur — CUSTOMER → müşteri,
//    SUPPLIER → tedarikçi, BOTH → ikisi, bağlı profil → fason; ikinci koşum 0 değişiklik (idempotent)
// §2 `type` TÜRETİLMİŞ, tek yazar `resolveCompanyType`: bayrak → tip tablosu; create/update gövdesi rolleri
//    alır, `type`i servis yazar; istemcinin `type`i yalnız rollere ÇEVRİLİR (eski istemci) — DB'ye gitmez
// §3 en az bir rol (400); geçersiz tip (400); fason rolü gövdeden YAZILAMAZ (düşer — tek yazar profil bağı)
// §4 `filter[role]` CSV = OR; tanınmayan değer 400; `filter[type]` eski istemci için çalışır
// §5 profil bağı → fason rolü + `type` değişmez; cari update gövdesi fason rolünü silemez
// §6 KART + PROFİL TEK TX (kullanıcı 16:03): create `subcontractorRole:true` → profil kartla doğar (kod/ad karttan,
//    `customerId` bağ, fason rolü true); Tedarikçi rolsüz → 400, kart doğmaz; aynı adda bağsız fason → 409 ve KART
//    DA DOĞMAZ (tx geri alındı); `isSubcontractorRole:true` gövdesi tek başına profil doğurmaz
// Negatif sondalar (kırmızı görüldü): `applyPartnerRoles`'ta fason rolü gövdeden geçirilince §3 ❌;
// `CustomerService.extraWhere` kaldırılınca §4 ❌ (rol süzgeci sessizce düşer, müşteri-only satır gelir).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik yalnız `temizle`de.
// Koşum: npx tsx scripts/test_partner_roles.ts
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { customerService } from "../src/routes/customer.routes";
import { SubcontractorManagementService } from "../src/services/subcontractor-management.service";
import { NO_ROLE_MESSAGE, resolveCompanyType, rolesFromType } from "../src/services/helpers/partner-roles.helper";
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

type Flags = { id: string; type: string; isCustomerRole: boolean; isSupplierRole: boolean; isSubcontractorRole: boolean };
const stamp = Date.now().toString(36);
// Arama terimi tire İÇERMEZ: tireli terim KOD kovasına düşer (`isCodeLike`) ve ad araması koşmaz. BÜYÜK harf:
// sunucu adı büyütür — küçük harfli damga `startsWith` sayımlarını sessizce 0'a düşürüyordu (ölçüldü: tx sondası
// yeşil kaldı; sayım vakumdu).
const T = `TESTROL${stamp.toUpperCase()}`;
const subSvc = new SubcontractorManagementService();
const createdIds: string[] = [];

async function flagsOf(id: string): Promise<Flags> {
  return (await prisma.customer.findUnique({ where: { id }, select: { id: true, type: true, isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true } }))!;
}
async function create(body: Record<string, unknown>): Promise<Flags> {
  const { name, ...rest } = body;
  const r = await customerService.create({ ...rest, name: `${T} ${String(name ?? Math.random().toString(36).slice(2, 6))}` });
  const id = (r.data as { id: string }).id;
  createdIds.push(id);
  return flagsOf(id);
}
const sig = (f: Flags) => `${f.type}:${f.isCustomerRole ? "C" : "-"}${f.isSupplierRole ? "S" : "-"}${f.isSubcontractorRole ? "F" : "-"}`;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU: ${engel}`);
  try {
    console.log("\n§1 backfill (migration SQL'i gerçek satırlara)");
    const raw = async (type: "CUSTOMER" | "SUPPLIER" | "BOTH", suffix: string) =>
      (await prisma.customer.create({ data: { code: `${T}-BF-${suffix}`, name: `${T} BF ${suffix}`, type, isCustomerRole: false, isSupplierRole: false }, select: { id: true } })).id;
    const bfC = await raw("CUSTOMER", "C");
    const bfS = await raw("SUPPLIER", "S");
    const bfB = await raw("BOTH", "B");
    const bfF = await raw("SUPPLIER", "F");
    createdIds.push(bfC, bfS, bfB, bfF);
    const bfSub = await prisma.subcontractor.create({ data: { code: `${T}-BF-SUB`, name: `${T} BF Fason`, customerId: bfF }, select: { id: true } });
    const sql = readFileSync(join(__dirname, "..", "prisma", "migrations", "20260917080000_partner_roles", "migration.sql"), "utf8");
    const updates = sql.split(";").map((s) => s.trim()).filter((s) => /^UPDATE\s/i.test(s.replace(/^--.*$/gm, "").trim()));
    check("migration dosyasında iki backfill UPDATE'i var", updates.length === 2, `${updates.length}`);
    const run = async () => {
      let n = 0;
      for (const u of updates) n += await prisma.$executeRawUnsafe(u.replace(/^--.*$/gm, ""));
      return n;
    };
    await run();
    check("CUSTOMER → yalnız müşteri", sig(await flagsOf(bfC)) === "CUSTOMER:C--");
    check("SUPPLIER → yalnız tedarikçi", sig(await flagsOf(bfS)) === "SUPPLIER:-S-");
    check("BOTH → ikisi", sig(await flagsOf(bfB)) === "BOTH:CS-");
    check("⭐ bağlı profil → fason rolü (+ tipten tedarikçi)", sig(await flagsOf(bfF)) === "SUPPLIER:-SF");
    const ikinci = await run();
    check("⭐ ikinci koşum bu satırlara dokunmadı (idempotent) — sayı yalnız başka rolsüz satır varsa artar", ikinci === 0 || (sig(await flagsOf(bfC)) === "CUSTOMER:C--" && sig(await flagsOf(bfF)) === "SUPPLIER:-SF"), `${ikinci} satır`);
    await prisma.subcontractor.delete({ where: { id: bfSub.id } });

    console.log("\n§2 türetme tek yazar");
    const table: Array<[boolean, boolean, boolean, string]> = [
      [true, false, false, "CUSTOMER"], [false, true, false, "SUPPLIER"], [true, true, false, "BOTH"],
      [false, false, true, "SUPPLIER"], [true, true, true, "BOTH"], [true, false, true, "CUSTOMER"], [false, false, false, "CUSTOMER"],
    ];
    check("resolveCompanyType tablosu (fason satıcıdır; rolsüz → şema varsayılanı)", table.every(([c, s, f, t]) => resolveCompanyType({ isCustomerRole: c, isSupplierRole: s, isSubcontractorRole: f }) === t));
    check("rolesFromType BOTH → ikisi, geçersiz → 400", JSON.stringify(rolesFromType("BOTH")) === JSON.stringify({ isCustomerRole: true, isSupplierRole: true }) && status(await hata(async () => rolesFromType("SUBCONTRACTOR"))) === 400);
    const s1 = await create({ name: "s1", isSupplierRole: true });
    check("create(isSupplierRole) → type SUPPLIER türetildi", sig(s1) === "SUPPLIER:-S-", sig(s1));
    const s2 = await create({ name: "s2", type: "BOTH" });
    check("⭐ eski istemci create(type:BOTH) → roller ikisi + type BOTH", sig(s2) === "BOTH:CS-", sig(s2));
    const s3 = await create({ name: "s3" });
    check("rolsüz/tipsiz create → bugünkü varsayılan: yalnız Müşteri", sig(s3) === "CUSTOMER:C--", sig(s3));
    const s4 = await create({ name: "s4", type: "SUPPLIER", isCustomerRole: true });
    check("⭐ bayrak ile type çelişirse BAYRAK kazanır (type türetilir: CUSTOMER)", sig(s4) === "CUSTOMER:C--", sig(s4));
    await customerService.update(s3.id, { isSupplierRole: true });
    check("update(isSupplierRole:true) → BOTH (mevcut müşteri rolü korunur)", sig(await flagsOf(s3.id)) === "BOTH:CS-");
    await customerService.update(s3.id, { type: "CUSTOMER" });
    check("eski istemci update(type:CUSTOMER) → yalnız müşteri", sig(await flagsOf(s3.id)) === "CUSTOMER:C--");
    await customerService.update(s3.id, { name: `${T} s3 ad` });
    check("rolsüz update roller/tip dokunmaz", sig(await flagsOf(s3.id)) === "CUSTOMER:C--");

    console.log("\n§3 kural: en az bir rol · geçersiz tip · fason rolü gövdeden yazılamaz");
    const eNone = await hata(() => create({ name: "e1", isCustomerRole: false, isSupplierRole: false }));
    check("hiç rol → 400", status(eNone) === 400 && msg(eNone) === NO_ROLE_MESSAGE, msg(eNone));
    const eType = await hata(() => create({ name: "e2", type: "SUBCONTRACTOR" }));
    check("geçersiz type → 400", status(eType) === 400, msg(eType));
    const eDrop = await hata(() => customerService.update(s3.id, { isCustomerRole: false }));
    check("son rolü düşüren update → 400", status(eDrop) === 400 && sig(await flagsOf(s3.id)) === "CUSTOMER:C--", msg(eDrop));
    const s5 = await create({ name: "s5", isSupplierRole: true, isSubcontractorRole: true });
    check("⭐ create gövdesindeki isSubcontractorRole DÜŞER (profil yok → false)", sig(s5) === "SUPPLIER:-S-", sig(s5));
    const eBad = await hata(() => create({ name: "e3", isSupplierRole: "evet" }));
    check("boolean olmayan bayrak → 400", status(eBad) === 400);

    console.log("\n§4 filter[role]");
    const ids = (r: unknown) => ((r as { data: Array<{ id: string }> }).data ?? []).map((x) => x.id);
    const sup = ids(await customerService.findAll(fakeReq({ "filter[role]": "supplier", pageSize: "500", search: T })));
    check("⭐ role=supplier → tedarikçi/ikisi var, yalnız-müşteri YOK", sup.includes(s1.id) && sup.includes(s2.id) && !sup.includes(s3.id), `${sup.length} satır`);
    const csv = ids(await customerService.findAll(fakeReq({ "filter[role]": "customer,subcontractor", pageSize: "500", search: T })));
    check("CSV = OR (customer,subcontractor): müşteri kartı gelir, yalnız-tedarikçi gelmez", csv.includes(s3.id) && !csv.includes(s1.id));
    const eRole = await hata(() => customerService.findAll(fakeReq({ "filter[role]": "boss", pageSize: "5" })));
    check("tanınmayan rol → 400 (fail-closed)", status(eRole) === 400, msg(eRole));
    const legacy = ids(await customerService.findAll(fakeReq({ "filter[type]": "BOTH", pageSize: "500", search: T })));
    check("filter[type]=BOTH eski istemci için çalışır", legacy.includes(s2.id) && !legacy.includes(s1.id));

    console.log("\n§5 profil bağı ↔ fason rolü");
    const prof = await subSvc.create({ code: `${T}-P1`, name: `${T} Profil`, customerId: s1.id }, undefined);
    createdIds.push(); // profil temizlikte silinir
    check("⭐ profil bağlanınca fason rolü true, type SUPPLIER kalır", sig(await flagsOf(s1.id)) === "SUPPLIER:-SF");
    await customerService.update(s1.id, { isSubcontractorRole: false, name: `${T} s1 ad` });
    check("⭐ cari update gövdesi fason rolünü SİLEMEZ (tek yazar profil)", sig(await flagsOf(s1.id)) === "SUPPLIER:-SF");
    await subSvc.update((prof.data as { id: string }).id, { customerId: null }, undefined);
    check("bağ kalkınca false", sig(await flagsOf(s1.id)) === "SUPPLIER:-S-");
    const eProfMus = await hata(() => subSvc.update((prof.data as { id: string }).id, { customerId: s3.id }, undefined));
    check("Tedarikçi rolü olmayan karta profil → 400", status(eProfMus) === 400 && msg(eProfMus).includes("Tedarikçi rolü"), msg(eProfMus));
    const cariDetay = (await customerService.findById(s1.id)).data as Record<string, unknown>;
    check("GET /customers projeksiyonu üç rolü taşır", typeof cariDetay.isCustomerRole === "boolean" && typeof cariDetay.isSupplierRole === "boolean" && typeof cariDetay.isSubcontractorRole === "boolean");

    console.log("\n§6 kart + profil tek tx (subcontractorRole)");
    const s6 = await create({ name: "s6", isSupplierRole: true, subcontractorRole: true });
    const prof6 = await prisma.subcontractor.findFirst({ where: { customerId: s6.id }, select: { id: true, code: true, name: true, isActive: true } });
    const kart6 = await prisma.customer.findUnique({ where: { id: s6.id }, select: { code: true, name: true } });
    check("⭐ create(subcontractorRole) → profil kartla doğdu (kod/ad karttan, bağlı, aktif) ve fason rolü true", prof6 !== null && prof6.code === kart6?.code && prof6.name === kart6?.name && prof6.isActive && sig(s6) === "SUPPLIER:-SF", `${JSON.stringify(prof6)} ${sig(s6)}`);
    const kartSayisiOnce = await prisma.customer.count({ where: { name: { startsWith: T } } });
    check("sayım vakum değil (ön koşul): bu bekçinin kartları sayılıyor", kartSayisiOnce >= 5, `${kartSayisiOnce}`);
    const e6 = await hata(() => create({ name: "s7", isCustomerRole: true, subcontractorRole: true }));
    check("Tedarikçi rolsüz + subcontractorRole → 400 'önce Tedarikçi rolü', kart doğmadı", status(e6) === 400 && msg(e6).includes("Tedarikçi rolü") && (await prisma.customer.count({ where: { name: { startsWith: T } } })) === kartSayisiOnce, msg(e6));
    await prisma.subcontractor.create({ data: { code: `${T}-BAGSIZ`, name: `${T} S8` } });
    const e8 = await hata(() => create({ name: "s8", isSupplierRole: true, subcontractorRole: true }));
    check("⭐ aynı adda bağsız fason varken → 409 yönlendirme ve KART DA DOĞMADI (tek tx geri alındı)", status(e8) === 409 && msg(e8).includes("Fason Firmalar") && (await prisma.customer.count({ where: { name: { startsWith: T } } })) === kartSayisiOnce, msg(e8));
    const s9 = await create({ name: "s9", isSupplierRole: true, isSubcontractorRole: true });
    check("isSubcontractorRole:true gövdesi (subcontractorRole olmadan) profil DOĞURMAZ, bayrak false", (await prisma.subcontractor.count({ where: { customerId: s9.id } })) === 0 && sig(s9) === "SUPPLIER:-S-");
  } catch (e) {
    fail++;
    console.log(`  ✗ FAIL: beklenmeyen hata — ${msg(e).slice(0, 300)}`);
  } finally {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}

async function temizle(): Promise<void> {
  await prisma.subcontractor.deleteMany({ where: { OR: [{ code: { startsWith: T } }, { customer: { name: { startsWith: T } } }] } });
  await prisma.customer.deleteMany({ where: { OR: [{ name: { startsWith: T } }, { code: { startsWith: T } }] } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
