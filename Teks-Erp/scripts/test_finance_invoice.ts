// =============================================================================
// BEKÇİ — FATURA: onay · storno · yarış · bakiye mutabakatı
// =============================================================================
// Çalıştırma: npx tsx scripts/test_finance_invoice.ts
//
// NEDEN: Cari bakiyesi DENORMALİZE bir alandır ve DB seddi YOKTUR. Tek koruma
// "defter satırı ile bakiye AYNI transaction'da, atomik increment ile yazılır"
// disiplinidir. Bu disiplin sessizce kırılır: hata çıkmaz, log çıkmaz, yalnız
// ay sonunda müşteriyle rakam tutmaz.
//
// ÖLÇÜLENLER:
//   §1 Taslak deftere HİÇBİR ŞEY yazmaz (bakiye değişmez)
//   §2 Onay → tek defter satırı + bakiye tam tutar kadar
//   §3 ⭐ EŞZAMANLI ONAY YARIŞI: 5 paralel confirm → 1 başarılı + 4×409, defterde
//      TEK satır. Atomik claim düşerse bakiye 5 katına çıkar.
//   §4 Onaylı fatura DÜZENLENEMEZ / SİLİNEMEZ
//   §5 STORNO: ters satır yazılır, ORİJİNAL SATIR DURUR, bakiye sıfırlanır
//   §6 Alış faturası TERS yöne yazar (yön tek kaynaktan)
//   §7 "Bir kaynak → tek aktif fatura" (partial unique + anlamlı mesaj)
//   §8 Fiyatsız satırla ONAY reddedilir (taslakta serbest)
//   §9 Kur bulunamazsa 400 — sessizce 1'e DÜŞMEZ
//   §10 MUTABAKAT: SUM(defter) === CariBalance
// =============================================================================
import { Prisma, InvoiceStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { invoiceService } from "../src/services/invoice.service";
import { computeInvoiceTotals, D } from "../src/services/helpers/finance.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const invoiceIds: string[] = [];
let cariId: string | null = null;
let customerId: string | null = null;

const LINES = [
  { description: "Perde kumaşı", qty: 100, unitPrice: 25, vatRate: 20 },
  { description: "Fason işçilik", qty: 2, unitPrice: 150, vatRate: 20, discountRate: 10 },
];

async function balanceOf(currency: "TRY" | "USD" = "TRY"): Promise<Prisma.Decimal> {
  if (!cariId) return new Prisma.Decimal(0);
  const b = await prisma.cariBalance.findUnique({
    where: { cariId_currency: { cariId, currency } },
    select: { balance: true },
  });
  return D(b?.balance ?? 0);
}

async function main(): Promise<void> {
  console.log("=== Fatura bekçisi ===\n");

  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  if (!customer) throw new Error("Test verisi yetersiz — aktif Customer yok.");
  customerId = customer.id;

  // Test carisini temiz başlat: önceki koşumdan kalan bakiye varsa ölçümler
  // kayar. (Cari kaydı KALIR — başka testler de aynı müşteriyi kullanabilir.)
  const existingCari = await prisma.cariAccount.findFirst({ where: { customerId }, select: { id: true } });
  if (existingCari) {
    cariId = existingCari.id;
    await prisma.cariBalance.deleteMany({ where: { cariId } });
  }

  const totals = computeInvoiceTotals(LINES);
  console.log(`   (beklenen tutar: ${totals.grandTotal.toString()} TRY)\n`);

  // ── §1 TASLAK DEFTERE YAZMAZ ────────────────────────────────────────────
  const draft = await invoiceService.createDraft({ type: "SALES", customerId, currency: "TRY", lines: LINES });
  invoiceIds.push(draft.data.id);
  if (!cariId) {
    const c = await prisma.cariAccount.findFirstOrThrow({ where: { customerId }, select: { id: true } });
    cariId = c.id;
    await prisma.cariBalance.deleteMany({ where: { cariId } });
  }
  check("§1a Taslak oluştu ve belge no aldı", /^SF\d{10}$/.test(draft.data.docNo), draft.data.docNo);
  const txnAfterDraft = await prisma.cariTransaction.count({ where: { invoiceId: draft.data.id } });
  check("§1b Taslak defter satırı YAZMADI", txnAfterDraft === 0, `satır=${txnAfterDraft}`);
  check("§1c Taslak bakiyeyi DEĞİŞTİRMEDİ", (await balanceOf()).isZero(), `bakiye=${(await balanceOf()).toString()}`);

  // ── §3 EŞZAMANLI ONAY YARIŞI (§2'yi de kapsar) ──────────────────────────
  // ⚠️ `Promise.allSettled` burada MEŞRU: beş AYRI transaction var (perf kuralı
  // 11 tek tx client'ını paylaşmaya ilişkindir). "Düzeltip" sıralı hale
  // getirirsen bekçi sessizce ölür — ölçtüğü şey tam olarak eşzamanlılıktır.
  const race = await Promise.allSettled(
    Array.from({ length: 5 }, () => invoiceService.confirm(draft.data.id)),
  );
  const ok = race.filter((r) => r.status === "fulfilled").length;
  const conflicts = race.filter(
    (r) => r.status === "rejected" && /zaten onayl/i.test(String((r.reason as Error).message)),
  ).length;
  check("§3a 5 eşzamanlı onaydan YALNIZ BİRİ geçti", ok === 1, `başarılı=${ok}`);
  check("§3b Diğer 4'ü 409 aldı", conflicts === 4, `çakışma=${conflicts}`);

  const txns = await prisma.cariTransaction.findMany({
    where: { invoiceId: draft.data.id, sourceType: "INVOICE" },
    select: { debit: true, credit: true },
  });
  check("§2a Defterde TEK satır", txns.length === 1, `satır=${txns.length}`);
  check("§2b Satış faturası BORÇ yazdı", txns[0] ? D(txns[0].debit).equals(totals.grandTotal) : false, `borç=${txns[0]?.debit}`);
  check("§2c Alacak kolonu boş", txns[0] ? D(txns[0].credit).isZero() : false);
  const afterConfirm = await balanceOf();
  check("§2d Bakiye TAM tutar kadar arttı", afterConfirm.equals(totals.grandTotal), `bakiye=${afterConfirm.toString()}`);

  // ── §4 ONAYLI FATURA DOKUNULMAZ ─────────────────────────────────────────
  let editErr = "";
  try {
    await invoiceService.updateDraft(draft.data.id, { notes: "değişiklik" });
  } catch (e) {
    editErr = (e as Error).message;
  }
  check("§4a Onaylı fatura DÜZENLENEMEZ", /onaylanmış/i.test(editErr), editErr.slice(0, 60));
  let delErr = "";
  try {
    await invoiceService.deleteDraft(draft.data.id);
  } catch (e) {
    delErr = (e as Error).message;
  }
  check("§4b Onaylı fatura SİLİNEMEZ", /taslak değil/i.test(delErr), delErr.slice(0, 60));

  // ── §7 BİR KAYNAK → TEK AKTİF FATURA ────────────────────────────────────
  const shipment = await prisma.shipment.findFirst({ select: { id: true } });
  if (shipment) {
    const first = await invoiceService.createDraft({
      type: "SALES",
      customerId,
      lines: [LINES[0] as never],
      shipmentId: shipment.id,
    });
    invoiceIds.push(first.data.id);
    let dupErr = "";
    try {
      await invoiceService.createDraft({
        type: "SALES",
        customerId,
        lines: [LINES[0] as never],
        shipmentId: shipment.id,
      });
    } catch (e) {
      dupErr = (e as Error).message;
    }
    check("§7a İkinci fatura REDDEDİLDİ", /zaten bir fatura var/i.test(dupErr), dupErr.slice(0, 70));
    check("§7b Mesaj mevcut belgeyi ADIYLA söylüyor", dupErr.includes(first.data.docNo));
    // İptal edilen fatura yeni fatura kesilmesini ENGELLEMEMELİ (storno'nun amacı).
    await invoiceService.cancel(first.data.id, "bekçi");
    const afterCancel = await invoiceService.createDraft({
      type: "SALES",
      customerId,
      lines: [LINES[0] as never],
      shipmentId: shipment.id,
    });
    invoiceIds.push(afterCancel.data.id);
    check("§7c İptalden SONRA yeni fatura kesilebiliyor", Boolean(afterCancel.data.id));
    await invoiceService.cancel(afterCancel.data.id, "bekçi temizlik");
  } else {
    console.log("   ⏭️  §7 atlandı — DB'de sevkiyat yok");
  }

  // ── §8 FİYATSIZ SATIRLA ONAY ────────────────────────────────────────────
  const zeroDraft = await invoiceService.createDraft({
    type: "SALES",
    customerId,
    lines: [{ description: "Fiyatı sonra girilecek", qty: 10, unitPrice: 0 }],
  });
  invoiceIds.push(zeroDraft.data.id);
  check("§8a Fiyatsız satır TASLAKTA serbest", Boolean(zeroDraft.data.id));
  let zeroErr = "";
  try {
    await invoiceService.confirm(zeroDraft.data.id);
  } catch (e) {
    zeroErr = (e as Error).message;
  }
  check("§8b Fiyatsız satırla ONAY reddedildi", /fiyat/i.test(zeroErr), zeroErr.slice(0, 70));
  check("§8c Reddedilen fatura TASLAK kaldı", await isStatus(zeroDraft.data.id, "DRAFT"));

  // ── §9 KUR BULUNAMAZSA 400 ──────────────────────────────────────────────
  // ⚠️ Sessizce 1'e düşmek 1000 USD'lik faturayı 1000 TL yazardı — bakiye ~30
  // kat yanlış, hata da log da çıkmadan.
  await prisma.exchangeRate.deleteMany({ where: { currency: "USD" } });
  let rateErr = "";
  try {
    await invoiceService.createDraft({ type: "SALES", customerId, currency: "USD", lines: LINES });
  } catch (e) {
    rateErr = (e as Error).message;
  }
  check("§9a Kursuz döviz faturası REDDEDİLDİ", /kur bulunamadı/i.test(rateErr), rateErr.slice(0, 70));
  // Kur girilince geçmeli (körlük zemini: §9a "hiçbir fatura açılamıyor" ile de yeşil kalırdı).
  await prisma.exchangeRate.create({
    data: { rateDate: new Date(), currency: "USD", rate: new Prisma.Decimal("34.5") },
  });
  const usd = await invoiceService.createDraft({ type: "SALES", customerId, currency: "USD", lines: LINES });
  invoiceIds.push(usd.data.id);
  const usdRow = await prisma.invoice.findUniqueOrThrow({
    where: { id: usd.data.id },
    select: { exchangeRate: true, grandTotalTry: true, grandTotal: true },
  });
  check("§9b KÖRLÜK ZEMİNİ: kur girilince fatura açılıyor", D(usdRow.exchangeRate).equals(D("34.5")));
  check(
    "§9c TL karşılığı kurla damgalandı",
    D(usdRow.grandTotalTry).equals(D(usdRow.grandTotal).mul(D("34.5")).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)),
    `${usdRow.grandTotal} × 34.5 = ${usdRow.grandTotalTry}`,
  );

  // ── §6 ALIŞ FATURASI TERS YÖN ───────────────────────────────────────────
  const sub = await prisma.subcontractor.findFirst({ where: { isActive: true }, select: { id: true } });
  if (sub) {
    const purchase = await invoiceService.createDraft({
      type: "PURCHASE",
      subcontractorId: sub.id,
      lines: [{ description: "Boya hizmeti", qty: 500, unitPrice: 3, vatRate: 20 }],
    });
    invoiceIds.push(purchase.data.id);
    await invoiceService.confirm(purchase.data.id);
    const pTxn = await prisma.cariTransaction.findFirstOrThrow({
      where: { invoiceId: purchase.data.id, sourceType: "INVOICE" },
      select: { debit: true, credit: true, cariId: true },
    });
    check("§6a Alış faturası ALACAK yazdı (biz borçluyuz)", D(pTxn.credit).gt(0) && D(pTxn.debit).isZero());
    const subBal = await prisma.cariBalance.findUniqueOrThrow({
      where: { cariId_currency: { cariId: pTxn.cariId, currency: "TRY" } },
      select: { balance: true },
    });
    check("§6b Fason bakiyesi NEGATİF (bizim borcumuz)", D(subBal.balance).lt(0), `bakiye=${subBal.balance}`);
    await invoiceService.cancel(purchase.data.id, "bekçi temizlik");
    const subBal2 = await prisma.cariBalance.findUniqueOrThrow({
      where: { cariId_currency: { cariId: pTxn.cariId, currency: "TRY" } },
      select: { balance: true },
    });
    check("§6c Storno fason bakiyesini SIFIRLADI", D(subBal2.balance).isZero(), `bakiye=${subBal2.balance}`);
  } else {
    console.log("   ⏭️  §6 atlandı — DB'de fason firma yok");
  }

  // ── §5 STORNO ───────────────────────────────────────────────────────────
  await invoiceService.cancel(draft.data.id, "yanlış müşteriye kesildi");
  const allTxns = await prisma.cariTransaction.findMany({
    where: { invoiceId: draft.data.id },
    select: { sourceType: true, debit: true, credit: true },
    orderBy: { createdAt: "asc" },
  });
  check("§5a Defterde İKİ satır (fatura + storno)", allTxns.length === 2, `satır=${allTxns.length}`);
  check(
    "§5b ORİJİNAL satır DURUYOR (silinmedi)",
    allTxns[0]?.sourceType === "INVOICE" && D(allTxns[0].debit).equals(totals.grandTotal),
  );
  check(
    "§5c Storno TERS yönde",
    allTxns[1]?.sourceType === "INVOICE_CANCEL" && D(allTxns[1].credit).equals(totals.grandTotal),
  );
  const afterStorno = await balanceOf();
  check("§5d Bakiye sıfırlandı", afterStorno.isZero(), `bakiye=${afterStorno.toString()}`);
  check("§5e Fatura CANCELLED", await isStatus(draft.data.id, "CANCELLED"));

  // İptal edilmiş fatura ikinci kez iptal EDİLEMEZ (atomik claim).
  let reCancel = "";
  try {
    await invoiceService.cancel(draft.data.id, "tekrar");
  } catch (e) {
    reCancel = (e as Error).message;
  }
  check("§5f İkinci iptal 409", /zaten iptal/i.test(reCancel), reCancel.slice(0, 60));

  // ── §10 MUTABAKAT ───────────────────────────────────────────────────────
  // Bu, `test_consistency`nin muhasebe bölümünün çekirdeği: bakiye denormalize
  // ve DB seddi yok; tek koruma bu eşitliğin ölçülmesi.
  const drift = await prisma.$queryRaw<Array<{ cariId: string; currency: string; ledger: string; stored: string }>>`
    SELECT b."cariId"::text AS "cariId", b.currency::text AS currency,
           COALESCE(t.total, 0)::text AS ledger, b.balance::text AS stored
      FROM cari_balances b
      LEFT JOIN (
        SELECT "cariId", currency, SUM(debit) - SUM(credit) AS total
          FROM cari_transactions GROUP BY "cariId", currency
      ) t ON t."cariId" = b."cariId" AND t.currency = b.currency
     WHERE b.balance <> COALESCE(t.total, 0)
  `;
  check(
    "§10 SUM(defter) === CariBalance (tüm cariler)",
    drift.length === 0,
    drift.length > 0 ? `SAPMA: ${drift.map((d) => `${d.currency} ${d.stored}≠${d.ledger}`).join(", ")}` : "sapma yok",
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function isStatus(id: string, status: InvoiceStatus): Promise<boolean> {
  const r = await prisma.invoice.findUnique({ where: { id }, select: { status: true } });
  return r?.status === status;
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // Temizlik: defter satırları FK ile faturaya bağlı (RESTRICT) → önce onlar.
    if (invoiceIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    // Fason tarafında da kalan olabilir (§6 iptal edilmiş faturası).
    await prisma.exchangeRate.deleteMany({ where: { currency: "USD" } });
    if (cariId) await prisma.cariBalance.deleteMany({ where: { cariId } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
