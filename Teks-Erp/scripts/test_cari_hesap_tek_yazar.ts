// =============================================================================
// BEKÇİ — CARİ HESABIN TEK ADRESİ KART (rol modeli faz 2, dilim A; 1e ölçümü 2026-09-17 17:25)
// =============================================================================
// Delik: `ensureCariAccountTx` fason bacağını (`subcontractorId`) olduğu gibi kabul ediyordu; göçten sonra BAĞLI
// bir fasona kesilen fatura/ödeme/çek kartın hesabı dururken İKİNCİ bir hesap doğuruyordu ("tek cari hesap" bozuk).
// Kural: fason bacağı `resolvePartyToCardTx` ile profilin kartına ÇÖZÜLÜR; bağsız profil (göç koşulmamış kurulum)
// eskisi gibi fason hesabına gider (varsayılan = bugünkü davranış). Şema/CHECK dokunulmaz.
// §0 zemin: bağlı profil + kart, hesap 0 (sayım vakum değil: §1'de 1 olur)
// §1 bağlı fason → ALIŞ faturası → hesap KARTTA (`customerId` = kart, `subcontractorId` null, kind CUSTOMER), sayı 1
// §2 aynı fasona ÖDEME (OUT) ve VERİLEN ÇEK → aynı hesap, sayı hâlâ 1
// §3 kartın hesabı ZATEN varken (açık `cariService.create`) bağlı fasona fatura → aynı hesaba; `cariService.create`
//    `{subcontractorId}` ile bağlı profile → 409 "zaten açık" (ikinci hesap DOĞMAZ)
// §4 bağsız fason → eski yol (hesap `subcontractorId`de, kind SUBCONTRACTOR)
// §5 `resolvePartyToCardTx` saf sözleşmesi: müşteri verilirse dokunmaz; ikisi birden verilirse dokunmaz (XOR çağıranda)
// §6 cari HESAP listesi kartın rol süzgeciyle (`partnerRoleAccountWhere`, Cariler şeridiyle aynı çift): `filter[role]`
//    CSV OR · skaler bayrak AND · süzgeç varken kartsız (eski fason) hesap dışarıda, yokken içeride · satır `roles`
//    taşır (kartsızda null) · tanınmayan 400
// Negatif sonda (kırmızı görüldü): `ensureCariAccountTx`te `resolvePartyToCardTx` çağrısı kaldırılınca §1 "hesap kartta"
// ❌ ve §3 "aynı hesap" ❌ (iki hesap doğdu).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik yalnız `temizle`de.
// Koşum: npx tsx scripts/test_cari_hesap_tek_yazar.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import { chequeService } from "../src/services/cheque.service";
import { cariService } from "../src/services/cari.service";
import { resolvePartyToCardTx } from "../src/services/helpers/party-card.helper";
import { partnerRoleAccountWhere } from "../src/services/helpers/partner-roles.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗ FAIL:"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const status = (e: unknown) => (e instanceof AppError ? e.statusCode : -1);
async function hata(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

// Sunucu adı BÜYÜTÜR; damga büyük harf ki `startsWith` sayımları vakum olmasın.
const T = `TESTCARITEK${Date.now().toString(36).toUpperCase()}`;
const LINES = [{ description: "Fason işçilik", qty: 2, unit: "m", unitPrice: 150, vatRate: 20 }];
const invoiceIds: string[] = [];
const paymentIds: string[] = [];
const chequeIds: string[] = [];
const cashBoxIds: string[] = [];

async function kartVeProfil(suffix: string): Promise<{ customerId: string; subcontractorId: string }> {
  const kart = await prisma.customer.create({
    data: { code: `${T}-${suffix}`, name: `${T} ${suffix}`, isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: true },
    select: { id: true },
  });
  const prof = await prisma.subcontractor.create({ data: { code: `${T}-${suffix}-F`, name: `${T} ${suffix}`, customerId: kart.id }, select: { id: true } });
  return { customerId: kart.id, subcontractorId: prof.id };
}
/** Bu tarafın (kart ya da profil) hesapları — tek yazar iddiası bu sayının 1 kalmasıdır. */
const hesaplar = (p: { customerId?: string; subcontractorId?: string }) =>
  prisma.cariAccount.findMany({
    where: { OR: [{ customerId: p.customerId ?? "00000000-0000-0000-0000-000000000000" }, { subcontractorId: p.subcontractorId ?? "00000000-0000-0000-0000-000000000000" }] },
    select: { id: true, kind: true, customerId: true, subcontractorId: true },
  });
async function fatura(subcontractorId: string): Promise<{ id: string; cariId: string }> {
  const r = await invoiceService.createDraft({ type: "PURCHASE", subcontractorId, currency: "TRY", lines: LINES });
  invoiceIds.push(r.data.id);
  const row = await prisma.invoice.findUniqueOrThrow({ where: { id: r.data.id }, select: { cariId: true } });
  return { id: r.data.id, cariId: row.cariId };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU: ${engel}`);
  try {
    const box = await prisma.cashBox.create({ data: { code: `${T}-KS`, name: `${T} Kasa`, currency: "TRY" }, select: { id: true } });
    cashBoxIds.push(box.id);

    console.log("\n§0 zemin");
    const a = await kartVeProfil("A");
    check("bağlı profil + kart doğdu, hesap 0 (sayım vakum değil: §1'de 1 olmalı)", (await hesaplar(a)).length === 0);

    console.log("\n§1 bağlı fason → alış faturası → hesap KARTTA");
    const inv1 = await fatura(a.subcontractorId);
    const h1 = await hesaplar(a);
    check("⭐ hesap sayısı 1 (ikinci hesap doğmadı)", h1.length === 1, `${h1.length}`);
    check("⭐ hesap kartta: customerId = kart, subcontractorId null, kind CUSTOMER", h1[0]?.customerId === a.customerId && h1[0]?.subcontractorId === null && h1[0]?.kind === "CUSTOMER", JSON.stringify(h1[0]));
    check("faturanın cariId'si o hesap", inv1.cariId === h1[0]?.id);

    console.log("\n§2 aynı fasona ödeme + verilen çek → aynı hesap");
    const pay = await paymentService.create({ direction: "OUT", method: "CASH", subcontractorId: a.subcontractorId, currency: "TRY", amount: 100, cashBoxId: box.id });
    paymentIds.push(pay.data.id);
    const payRow = await prisma.payment.findUniqueOrThrow({ where: { id: pay.data.id }, select: { cariId: true } });
    check("⭐ ödeme kartın hesabına yazıldı", payRow.cariId === h1[0]?.id);
    const chq = await chequeService.create({ kind: "ISSUED", subcontractorId: a.subcontractorId, amount: 250, dueDate: new Date(Date.now() + 15 * 86400000) });
    chequeIds.push(chq.data.id);
    const chqRow = await prisma.cheque.findUniqueOrThrow({ where: { id: chq.data.id }, select: { cariId: true } });
    check("⭐ verilen çek kartın hesabına yazıldı", chqRow.cariId === h1[0]?.id);
    check("⭐ üç belge sonrası hesap sayısı hâlâ 1", (await hesaplar(a)).length === 1);
    const txn = await prisma.cariTransaction.count({ where: { cariId: h1[0]?.id } });
    check("defter satırları tek hesapta (fatura taslak yazmaz; ödeme + çek = 2)", txn === 2, `${txn}`);

    console.log("\n§3 kartın hesabı ZATEN varken");
    const b = await kartVeProfil("B");
    const acik = await cariService.create({ customerId: b.customerId, paymentTermDays: 45 });
    const inv3 = await fatura(b.subcontractorId);
    const h3 = await hesaplar(b);
    check("⭐ bağlı fasona fatura mevcut kart hesabına düştü (ikinci doğmadı)", h3.length === 1 && inv3.cariId === acik.data.id, `${h3.length} ${inv3.cariId === acik.data.id}`);
    const e3 = await hata(() => cariService.create({ subcontractorId: b.subcontractorId }));
    check("açık `cariService.create({subcontractorId})` bağlı profile → 409 zaten açık", status(e3) === 409 && msg(e3).includes("zaten açık"), msg(e3));
    const c = await kartVeProfil("C");
    const acikC = await cariService.create({ subcontractorId: c.subcontractorId });
    const hC = await hesaplar(c);
    check("açık create bağlı profile → hesap KARTA açıldı (kind CUSTOMER)", hC.length === 1 && hC[0]?.id === acikC.data.id && hC[0]?.customerId === c.customerId && hC[0]?.kind === "CUSTOMER", JSON.stringify(hC[0]));

    console.log("\n§4 bağsız fason → eski yol");
    const bagsiz = await prisma.subcontractor.create({ data: { code: `${T}-BAGSIZ`, name: `${T} Bagsiz` }, select: { id: true } });
    const inv4 = await fatura(bagsiz.id);
    const h4 = await hesaplar({ subcontractorId: bagsiz.id });
    check("bağsız profilin hesabı fason bacağında (kind SUBCONTRACTOR, customerId null) — varsayılan bugünkü davranış", h4.length === 1 && h4[0]?.kind === "SUBCONTRACTOR" && h4[0]?.customerId === null && inv4.cariId === h4[0]?.id, JSON.stringify(h4[0]));

    console.log("\n§5 çözücü sözleşmesi");
    const r1 = await resolvePartyToCardTx(prisma, { subcontractorId: a.subcontractorId });
    check("bağlı → {customerId: kart, subcontractorId: null}", r1.customerId === a.customerId && r1.subcontractorId === null);
    const r2 = await resolvePartyToCardTx(prisma, { subcontractorId: bagsiz.id });
    check("bağsız → olduğu gibi", r2.customerId === null && r2.subcontractorId === bagsiz.id);
    const r3 = await resolvePartyToCardTx(prisma, { customerId: a.customerId });
    check("müşteri verilirse dokunmaz", r3.customerId === a.customerId && r3.subcontractorId === null);
    const r4 = await resolvePartyToCardTx(prisma, { customerId: b.customerId, subcontractorId: a.subcontractorId });
    check("ikisi birden → dokunmaz (XOR kararı çağıranda: 400)", r4.customerId === b.customerId && r4.subcontractorId === a.subcontractorId);
    const e5 = await hata(() => invoiceService.createDraft({ type: "PURCHASE", customerId: b.customerId, subcontractorId: a.subcontractorId, currency: "TRY", lines: LINES }));
    check("ikisi birden verilen fatura → 400", status(e5) === 400, msg(e5));

    console.log("\n§6 cari hesap listesi — kartın rol süzgeci");
    const listele = async (filters: Record<string, string>) =>
      (await cariService.list({ pageSize: 200, search: T, roleWhere: partnerRoleAccountWhere(filters) as never })).data.map((r) => r.id);
    const hepsi = await listele({});
    const kartHesap = h1[0]?.id ?? "";
    const fasonHesap = h4[0]?.id ?? "";
    check("süzgeçsiz: kart hesabı DA eski fason hesabı DA listede (vakum değil)", hepsi.includes(kartHesap) && hepsi.includes(fasonHesap), `${hepsi.length}`);
    const tedarikci = await listele({ role: "supplier" });
    check("⭐ filter[role]=supplier → kartın hesabı var, kartsız (eski fason) hesap YOK", tedarikci.includes(kartHesap) && !tedarikci.includes(fasonHesap));
    const musteri = await listele({ role: "customer" });
    check("filter[role]=customer → tedarikçi-only kart hesabı yok", !musteri.includes(kartHesap));
    const csv = await listele({ role: "customer,supplier" });
    check("CSV = OR: customer,supplier → kart hesabı var", csv.includes(kartHesap));
    const fasonYapan = await listele({ isSubcontractorRole: "true" });
    const yapmayan = await listele({ isSubcontractorRole: "false" });
    check("skaler isSubcontractorRole=true → fason rollü kart var; =false → yok", fasonYapan.includes(kartHesap) && !yapmayan.includes(kartHesap));
    const and = await listele({ role: "supplier", isSubcontractorRole: "false" });
    check("role + skaler AND: supplier ∧ fason yapmayan → fason rollü tedarikçi kartı yok", !and.includes(kartHesap));
    const satirlar = (await cariService.list({ pageSize: 200, search: T })).data;
    const kartSatir = satirlar.find((r) => r.id === kartHesap);
    const fasonSatir = satirlar.find((r) => r.id === fasonHesap);
    check("satır kartın rollerini taşır (rozet kaynağı); kartsız eski fason hesabında roles null", kartSatir?.roles?.isSupplierRole === true && kartSatir?.roles?.isSubcontractorRole === true && fasonSatir?.roles === null, JSON.stringify(kartSatir?.roles));
    const e6 = await hata(async () => partnerRoleAccountWhere({ role: "bogus" }));
    const e6b = await hata(async () => partnerRoleAccountWhere({ isSupplierRole: "evet" }));
    check("tanınmayan rol / bayrak değeri → 400 (fail-closed)", status(e6) === 400 && status(e6b) === 400, `${msg(e6)} | ${msg(e6b)}`);
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
  if (chequeIds.length > 0) {
    await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: chequeIds } } });
    await prisma.cariTransaction.deleteMany({ where: { chequeId: { in: chequeIds } } });
    await prisma.cheque.deleteMany({ where: { id: { in: chequeIds } } });
  }
  if (invoiceIds.length > 0) {
    await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  if (paymentIds.length > 0) {
    await prisma.cariTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.cashTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } }); // tek yazar: ödeme satırı FK RESTRICT
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  }
  const cariler = await prisma.cariAccount.findMany({
    where: { OR: [{ customer: { code: { startsWith: T } } }, { subcontractor: { code: { startsWith: T } } }] },
    select: { id: true },
  });
  const cariIds = cariler.map((c) => c.id);
  if (cariIds.length > 0) {
    await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
    await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
    await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
  }
  if (cashBoxIds.length > 0) {
    await prisma.cashTransaction.deleteMany({ where: { cashBoxId: { in: cashBoxIds } } });
    await prisma.cashBox.deleteMany({ where: { id: { in: cashBoxIds } } });
  }
  await prisma.subcontractor.deleteMany({ where: { code: { startsWith: T } } });
  await prisma.customer.deleteMany({ where: { code: { startsWith: T } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
