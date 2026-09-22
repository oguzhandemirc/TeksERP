// =============================================================================
// Test: şubenin sevk yönü — yazılabilirlik + doğrulama (S3, 2026-09-23)
// Çalıştır: npx tsx scripts/test_customer_branch_destination.ts
// Üç yazma yolu da ölçülür: route Zod şeması (alanı SİLMEMELİ) · CustomerBranchService
// create/update · müşteri create'indeki satır-içi şube (`validateAndShapeBranches`).
// Doğrulananlar:
//   1. Route şeması `defaultDestination`ı geçirir (Zod bilinmeyen anahtarı sessizce siler).
//   2. create: EXPORT yazılır · "" → null · alan yok → null · enum dışı → 400 TR, kayıt doğmaz.
//   3. update: DOMESTIC'e çevrilir · alan gönderilmezse DEĞİŞMEZ · null ile temizlenir ·
//      enum dışı → 400 ve kayıt değişmez.
//   4. Satır-içi şube: yön yazılır · enum dışı → satır numaralı 400.
//   5. Şube yönü değişince o şubeye giden PLANLI sevkiyat kendi yönünü korur.
// Negatif sondalar (2026-09-23, geri alındı → 16/0): ① route Zod'dan alan düştü → 1a/1b ❌ ·
//   ② create yazmaz → 2a ❌ · ③ update alan yokken null yazar → 3b/3d ❌ · ④ enum serbest →
//   2d/4b ❌ · ⑤ satır-içi şube yazmaz → 4a/4b/4c ❌ (bu sonda kalıntı bıraktı → 4c artık
//   doğan kaydı temizliğe ekler).
// =============================================================================
import prisma from "../src/lib/prisma";
import { CustomerService } from "../src/services/customer.service";
import { CustomerBranchService } from "../src/services/customer-branch.service";
import { branchCreateSchema, branchUpdateSchema } from "../src/routes/customer-branch.routes";
import { AppError } from "../src/utils/app-error";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TS = Date.now().toString(36);
const customers = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  searchFields: ["name"],
  codeSearchFields: ["code", "taxNumber", "exportCode"],
  defaultInclude: undefined,
  uniqueField: "code",
  nestedCreateFields: ["branches"],
});
const branches = new CustomerBranchService();
const createdIds: string[] = [];
let shipmentId: string | null = null;

async function hata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e : null; }
}

async function yon(id: string) {
  return (await prisma.customerBranch.findUnique({ where: { id }, select: { defaultDestination: true } }))?.defaultDestination;
}

async function main() {
  // 1) route şeması
  const c1 = branchCreateSchema.parse({ name: "X", defaultDestination: "EXPORT" }) as Record<string, unknown>;
  check("1a create şeması alanı geçirir", c1.defaultDestination === "EXPORT", JSON.stringify(c1));
  const u1 = branchUpdateSchema.parse({ defaultDestination: null }) as Record<string, unknown>;
  check("1b update şeması null'ı geçirir", "defaultDestination" in u1 && u1.defaultDestination === null, JSON.stringify(u1));

  const cari = (await customers.create({ name: `TEST Şube Yön ${TS}` }, undefined)).data as { id: string };
  createdIds.push(cari.id);

  // 2) create
  const b1 = (await branches.create(cari.id, { name: `TEST ŞY1 ${TS}`, defaultDestination: "EXPORT" })).data as { id: string };
  check("2a create EXPORT yazıldı", (await yon(b1.id)) === "EXPORT");
  const b2 = (await branches.create(cari.id, { name: `TEST ŞY2 ${TS}`, defaultDestination: "" })).data as { id: string };
  check("2b create '' → null", (await yon(b2.id)) === null);
  const b3 = (await branches.create(cari.id, { name: `TEST ŞY3 ${TS}` })).data as { id: string };
  check("2c create alan yok → null (bugünkü davranış)", (await yon(b3.id)) === null);
  const e2 = await hata(() => branches.create(cari.id, { name: `TEST ŞY4 ${TS}`, defaultDestination: "OVERSEAS" }));
  check("2d create enum dışı → 400 Türkçe", e2?.statusCode === 400 && e2.message.includes("Şube sevk yönü"), e2?.message ?? "hata yok");
  const sizan = await prisma.customerBranch.count({ where: { customerId: cari.id, name: { contains: "ŞY4" } } });
  check("2e reddedilen şube DOĞMADI", sizan === 0, String(sizan));

  // 3) update
  await branches.update(cari.id, b1.id, { defaultDestination: "DOMESTIC" });
  check("3a update DOMESTIC", (await yon(b1.id)) === "DOMESTIC");
  await branches.update(cari.id, b1.id, { notes: "yön gönderilmedi" });
  check("3b alan gönderilmedi → yön DEĞİŞMEDİ", (await yon(b1.id)) === "DOMESTIC");
  const e3 = await hata(() => branches.update(cari.id, b1.id, { defaultDestination: 1 }));
  check("3c update enum dışı → 400", e3?.statusCode === 400, e3?.message ?? "hata yok");
  check("3d geçersiz deneme kaydı değiştirmedi", (await yon(b1.id)) === "DOMESTIC");
  await branches.update(cari.id, b1.id, { defaultDestination: null });
  check("3e null ile temizlendi", (await yon(b1.id)) === null);

  // 4) satır-içi şube
  const inline = (await customers.create({
    name: `TEST Şube Yön Satır ${TS}`,
    branches: [{ name: `TEST SATIR A ${TS}`, defaultDestination: "EXPORT" }, { name: `TEST SATIR B ${TS}` }],
  }, undefined)).data as { id: string };
  createdIds.push(inline.id);
  const satirlar = await prisma.customerBranch.findMany({ where: { customerId: inline.id }, select: { name: true, defaultDestination: true }, orderBy: { name: "asc" } });
  check("4a satır-içi şube yönü yazıldı / boş satır null", satirlar[0]?.defaultDestination === "EXPORT" && satirlar[1]?.defaultDestination === null, JSON.stringify(satirlar));
  const e4 = await hata(() => customers.create({ name: `TEST Şube Yön Bozuk ${TS}`, branches: [{ name: "A" }, { name: "B", defaultDestination: "YURTDISI" }] }, undefined));
  check("4b satır-içi enum dışı → satır numaralı 400", e4?.statusCode === 400 && e4.message.startsWith("2. şube"), e4?.message ?? "hata yok");
  // Doğduysa (sonda altında) temizliğe de girsin — kalıntı sonraki koşumu kirletmesin.
  const bozuk = await prisma.customer.findMany({ where: { name: { contains: `Bozuk ${TS}`, mode: "insensitive" } }, select: { id: true } });
  createdIds.push(...bozuk.map((c) => c.id));
  check("4c bozuk istekte cari de doğmadı", bozuk.length === 0, String(bozuk.length));

  // 5) şube yönü değişince planlı sevkiyat donar
  await branches.update(cari.id, b3.id, { defaultDestination: "EXPORT" });
  const sh = await prisma.shipment.create({
    data: { shipmentNo: `TEST-SY-${TS}`, customerId: cari.id, branchId: b3.id, status: "PLANNED", destination: "EXPORT" },
    select: { id: true },
  });
  shipmentId = sh.id;
  await branches.update(cari.id, b3.id, { defaultDestination: "DOMESTIC" });
  const donmus = (await prisma.shipment.findUnique({ where: { id: sh.id }, select: { destination: true } }))?.destination;
  check("5 şube yönü değişti → planlı sevkiyat hâlâ EXPORT", donmus === "EXPORT", String(donmus));
}

async function temizlik(): Promise<void> {
  if (shipmentId) await prisma.shipment.deleteMany({ where: { id: shipmentId } });
  await cleanupTestCustomers(createdIds);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    try { await temizlik(); } catch (e) { console.error("❌ temizlik düştü:", e); fail++; }
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
