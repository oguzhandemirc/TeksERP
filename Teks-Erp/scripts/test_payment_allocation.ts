// =============================================================================
// BEKÇİ — FATURA KAPAMA (`PaymentAllocation`, Paket C2)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_payment_allocation.ts
//
// NEDEN: Kapama ÜÇ denormalize sayaç üzerinde yaşıyor (`Invoice.paidTotal`,
// `Payment.allocatedTotal`, `Cheque.allocatedTotal`) ve bu sayaçlar "hangi
// fatura hâlâ açık" sorusunun TEK kaynağı. Sayaçlar defterden bağımsız
// hareket ettiği için sapmaları CARİ BAKİYE ÖRTER: bakiye doğru kalır, yalnız
// yaşlandırma raporu yanlış olur — yani hata ay sonunda değil, müşteriyle
// oturulan gün ortaya çıkar.
//
// ⚠️ Bu bekçi kırmızıya dönerse doğru tepki testi gevşetmek DEĞİL.
//
// ÖLÇÜLENLER:
//   §0  KÖRLÜK ZEMİNİ — mutlu yol gerçekten çalışıyor (yoksa her şey "yeşil")
//   §1  KISMİ kapama: iki sayaç birlikte oynar, fatura AÇIK kalır
//   §2  ÇOKLU kapama: aynı fatura+kaynak birden çok satırla kapanır (unique YOK)
//   §3  ⭐ AŞIRI KAPAMA → 409 ve sayaçlar OYNAMAZ (ham UPDATE'in tavan koşulu)
//   §4  KAYNAK tarafı aşımı → 409 (`allocatedTotal <= amount`)
//   §5  ⭐ EŞZAMANLI KAPAMA YARIŞI: 5 paralel × 300 → grandTotal AŞILMAZ
//   §6  ALLOCATION DEFTERE SATIR YAZMAZ (bakiye ve satır sayısı sabit)
//   §7  STORNO ÇÖZÜLMESİ — yardımcının KENDİSİ (§7a-e) + ⭐ ÇAĞRILDIĞI (§7f,
//       gerçek `paymentService.cancel` / `invoiceService.cancel` üzerinden)
//   §8  BİLİNÇLİ DAR KURALLAR (cari · kur · yön · taslak · iptal · iade · karşılıksız çek)
//   §9  ROTA TARAMASI: her uç izin guard'ı taşıyor + bayrak kapısına mount edilmiş
//   §10 FIFO ÖNERİSİ: vade sıralı, deterministik, saf fonksiyon
//   §11 DEALLOCATE (elle düzeltme) — sayaçlar düşer, negatife inmez
//   §12 MUTABAKAT: SUM(allocation) === üç sayacın hepsi (TÜM DB)
//
// NEGATİF SONDA — DÖRDÜ DE GERÇEKTEN KOŞULDU, sonuçlar ÖLÇÜLEN hâlleriyle
// yazılmıştır (tahmin edilen değil; taban 82/82 yeşil):
//   ① `bumpInvoicePaid`'ten `AND "paidTotal" + $a <= "grandTotal"` silindi
//      → 80/2: §3a + §3e kırmızı.
//      ⚠️ ÖNEMLİ VE SEZGİYE AYKIRI: §5 (yarış) ve §12 (mutabakat) YEŞİL KALDI.
//      Sebep kusur değil TASARIM: aşımı ikinci katman — DB CHECK'i
//      `invoices_paid_total_range` — yakaladı, tx geri sardı ve yarışta yine
//      tam 3 kapama geçti. Yani §5'in ölçtüğü şey "uygulama koşulu" değil
//      "iki katmanın BİRLİKTE tuttuğu"dur; ham UPDATE koşulunun TEK ölçen
//      kontrolleri §3a/§3e'dir. Bu ayrımı bilmeden §3'ü zayıflatan biri,
//      uygulama katmanının anlamlı 409'unu kaybedip yerine çıplak bir
//      constraint hatası koyduğunu fark etmez. (CHECK de kaldırılırsa §5 ve
//      §12 kırmızıya döner — ikinci katmanın gerçekten yük taşıdığının kanıtı.)
//   ② `allocateOneTx`'teki `src.cariId !== inv.cariId` kontrolü silindi
//      → 81/1: §8a kırmızı (başka carinin parasıyla kapama sessizce geçti).
//   ③ `releaseRowsTx`'teki `dropInvoicePaid` çağrısı silindi
//      → 78/4: §7b2 · §7b4 · §7d4 · §12a kırmızı. En değerli sonda: storno
//      satırları siliyor ama sayacı düşürmüyor → "kapalı görünen ama parası
//      yok olmuş fatura" tam olarak bu şekilde doğar ve §12a onu adıyla
//      raporladı (SF…09: 600≠0, SF…11: 900≠0, SF…08: 800≠0).
//   ④ `allocateBulk`'un tek `$transaction` sarmalayıcısı kaldırılıp her bacak
//      ayrı tx yapıldı → §8m + §8n kırmızı (ilk bacak kalıcı yazıldı).
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PaymentDirection, ChequeKind, ChequeStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import {
  paymentAllocationService,
  releaseAllocationsForPaymentTx,
  releaseAllocationsForInvoiceTx,
  releaseAllocationsForChequeTx,
  suggestFifo,
} from "../src/services/payment-allocation.service";
import { D, D0 } from "../src/services/helpers/finance.helper";

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

const TAG = `TEST-ALLOC-${Date.now()}`;
const invoiceIds: string[] = [];
const paymentIds: string[] = [];
const chequeIds: string[] = [];
const cariIds: string[] = [];
const customerIds: string[] = [];
const subcontractorIds: string[] = [];
let cashBoxId: string | null = null;

/** Hata mesajını çıkaran küçük yardımcı — try/catch gürültüsünü azaltır. */
async function err(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

async function invoiceCounters(id: string): Promise<{ grand: Prisma.Decimal; paid: Prisma.Decimal }> {
  const r = await prisma.invoice.findUniqueOrThrow({
    where: { id },
    select: { grandTotal: true, paidTotal: true },
  });
  return { grand: D(r.grandTotal), paid: D(r.paidTotal) };
}

async function paymentAllocated(id: string): Promise<Prisma.Decimal> {
  const r = await prisma.payment.findUniqueOrThrow({ where: { id }, select: { allocatedTotal: true } });
  return D(r.allocatedTotal);
}

async function chequeAllocated(id: string): Promise<Prisma.Decimal> {
  const r = await prisma.cheque.findUniqueOrThrow({ where: { id }, select: { allocatedTotal: true } });
  return D(r.allocatedTotal);
}

/**
 * ONAYLI fatura üretir — tutarı satırdan TAM belirlenir (KDV 0 → grandTotal = qty×fiyat).
 * Kur/vergi karmaşası bu bekçinin ölçtüğü şey değil; sade tutar okunabilirliği artırır.
 */
async function makeInvoice(opts: {
  customerId?: string;
  subcontractorId?: string;
  type?: "SALES" | "PURCHASE" | "SALES_RETURN";
  total: number;
  dueDate?: Date | null;
  issueDate?: Date;
  confirm?: boolean;
}): Promise<string> {
  const r = await invoiceService.createDraft({
    type: opts.type ?? "SALES",
    customerId: opts.customerId ?? null,
    subcontractorId: opts.subcontractorId ?? null,
    currency: "TRY",
    issueDate: opts.issueDate,
    dueDate: opts.dueDate ?? null,
    lines: [{ description: `${TAG} satır`, qty: 1, unitPrice: opts.total, vatRate: 0 }],
  });
  invoiceIds.push(r.data.id);
  if (opts.confirm !== false) await invoiceService.confirm(r.data.id);
  return r.data.id;
}

async function makePayment(opts: {
  customerId?: string;
  subcontractorId?: string;
  direction?: "IN" | "OUT";
  amount: number;
}): Promise<string> {
  const r = await paymentService.create({
    direction: opts.direction ?? "IN",
    method: "CASH",
    customerId: opts.customerId ?? null,
    subcontractorId: opts.subcontractorId ?? null,
    currency: "TRY",
    amount: opts.amount,
    cashBoxId,
  });
  paymentIds.push(r.data.id);
  return r.data.id;
}

/**
 * Çeki DOĞRUDAN Prisma ile yaratır.
 *
 * ⚠️ `cheque.service` (C1) PARALEL yazılıyor ve bu bekçi ona bağlanmaz: bağlansa
 * C1'in her ara hâli bu bekçiyi kırardı ve kırmızı, C2'de olmayan bir hatayı
 * işaret ederdi. Ölçtüğümüz şey zaten çekin YAŞAM DÖNGÜSÜ değil, çek SAYACININ
 * kapama tarafından doğru hareket ettirilmesi.
 */
async function makeCheque(opts: {
  cariId: string;
  amount: number;
  kind?: ChequeKind;
  status?: ChequeStatus;
}): Promise<string> {
  const c = await prisma.cheque.create({
    data: {
      docNo: `${TAG}-CK${chequeIds.length + 1}`.slice(0, 32),
      kind: opts.kind ?? ChequeKind.RECEIVED,
      status: opts.status ?? ChequeStatus.PORTFOLIO,
      cariId: opts.cariId,
      currency: "TRY",
      exchangeRate: 1,
      amount: opts.amount,
      amountTry: opts.amount,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 86400_000),
    },
    select: { id: true },
  });
  chequeIds.push(c.id);
  return c.id;
}

async function main(): Promise<void> {
  console.log("=== Fatura kapama bekçisi ===\n");

  // ── FİKSTÜR ──────────────────────────────────────────────────────────────
  // Bekçi KENDİ tarafını yaratır: ortamdaki gerçek müşteriye dokunmak, onun
  // bakiyesini test temizliğinde silmek demekti (test_finance_invoice'ta
  // yaşanmış bir hata).
  const customer = await prisma.customer.create({ data: { code: TAG, name: `${TAG} Müşteri` }, select: { id: true } });
  customerIds.push(customer.id);
  const other = await prisma.customer.create({ data: { code: `${TAG}-B`, name: `${TAG} Diğer` }, select: { id: true } });
  customerIds.push(other.id);
  const box = await prisma.cashBox.create({
    data: { code: `${TAG}-KS`.slice(0, 32), name: `${TAG} Kasa`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxId = box.id;

  // ── §0 KÖRLÜK ZEMİNİ ─────────────────────────────────────────────────────
  // Bu bölüm olmadan §3/§4/§8'in "409 geldi" kontrolleri, servis tamamen bozuk
  // olsa da (her çağrı fırlatıyor olsa da) YEŞİL kalırdı.
  const inv1 = await makeInvoice({ customerId: customer.id, total: 1000 });
  const cari = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: customer.id }, select: { id: true } });
  cariIds.push(cari.id);
  const pay1 = await makePayment({ customerId: customer.id, amount: 1000 });

  const first = await paymentAllocationService.allocate({ invoiceId: inv1, paymentId: pay1, amount: 300 });
  check("§0a KÖRLÜK ZEMİNİ: kapama yazıldı", Boolean(first.data.id), first.data.id);
  check("§0b Fatura henüz KAPANMADI (kısmi)", first.data.invoiceClosed === false);

  // ── §1 KISMİ KAPAMA ──────────────────────────────────────────────────────
  {
    const c = await invoiceCounters(inv1);
    check("§1a Invoice.paidTotal 300 oldu", c.paid.equals(300), `paidTotal=${c.paid.toString()}`);
    check("§1b Payment.allocatedTotal 300 oldu", (await paymentAllocated(pay1)).equals(300));
    const open = await paymentAllocationService.listOpenInvoices({ cariId: cari.id, currency: "TRY", direction: PaymentDirection.IN });
    const row = open.data.find((r) => r.id === inv1);
    check("§1c Fatura hâlâ AÇIK listede", Boolean(row), row ? `açık=${row.openTotal}` : "yok");
    check("§1d Açık tutar 700", row?.openTotal === "700");
  }

  // ── §2 ÇOKLU KAPAMA ──────────────────────────────────────────────────────
  // ⚠️ `@@unique([invoiceId, paymentId])` BİLİNÇLİ olarak yok (migration notu):
  // aynı tahsilatın aynı faturaya ikinci kısmi kapaması meşru bir düzeltmedir.
  {
    const second = await paymentAllocationService.allocate({ invoiceId: inv1, paymentId: pay1, amount: 700 });
    check("§2a İkinci kapama aynı fatura+kaynak için KABUL edildi", Boolean(second.data.id));
    check("§2b Fatura KAPANDI (türetilmiş, kolon değil)", second.data.invoiceClosed === true);
    const c = await invoiceCounters(inv1);
    check("§2c paidTotal === grandTotal", c.paid.equals(c.grand), `${c.paid.toString()}/${c.grand.toString()}`);
    const rows = await prisma.paymentAllocation.count({ where: { invoiceId: inv1 } });
    check("§2d İki AYRI kapama satırı duruyor", rows === 2, `satır=${rows}`);
    const open = await paymentAllocationService.listOpenInvoices({ cariId: cari.id, currency: "TRY", direction: PaymentDirection.IN });
    check("§2e Kapanan fatura AÇIK listeden düştü", !open.data.some((r) => r.id === inv1));
  }

  // ── §3 AŞIRI KAPAMA ──────────────────────────────────────────────────────
  {
    const before = await invoiceCounters(inv1);
    const pay2 = await makePayment({ customerId: customer.id, amount: 500 });
    const m = await err(() => paymentAllocationService.allocate({ invoiceId: inv1, paymentId: pay2, amount: 1 }));
    // ⚠️ Hata metni TEK SATIRA indirilip basılır: ham Prisma hatası çok satırlıdır
    // ve kırmızı çıktığında ilk 80 karakter yalnız "Invalid `prisma.$executeRaw()`
    // invocation" gösterip ASIL sebebi (hangi CHECK/hangi tutar) gizler.
    check("§3a Kapalı faturaya 1 TL daha → RED", /kapatılabilecek tutar/i.test(m), m.replace(/\s+/g, " ").slice(0, 120));
    const after = await invoiceCounters(inv1);
    check("§3b Reddedilen kapama sayacı OYNATMADI", after.paid.equals(before.paid), `paidTotal=${after.paid.toString()}`);
    check("§3c Reddedilen kapama SATIR yazmadı", (await paymentAllocated(pay2)).isZero());
    check("§3d Kapama satır sayısı değişmedi", (await prisma.paymentAllocation.count({ where: { invoiceId: inv1 } })) === 2);

    // Kısmi aşım: 400'lük açık faturaya 500 yazılamaz (tam sığmayan reddedilir,
    // "sığdığı kadarını yaz" gibi bir sessiz kırpma YOK — kırpma kullanıcının
    // görmediği bir kapama üretirdi).
    const inv2 = await makeInvoice({ customerId: customer.id, total: 400 });
    const m2 = await err(() => paymentAllocationService.allocate({ invoiceId: inv2, paymentId: pay2, amount: 500 }));
    check("§3e Kısmen sığan kapama KIRPILMADAN reddedildi", /kapatılabilecek tutar/i.test(m2), m2.replace(/\s+/g, " ").slice(0, 120));
    check("§3f Kırpma olmadı (paidTotal 0 kaldı)", (await invoiceCounters(inv2)).paid.isZero());
  }

  // ── §4 KAYNAK TARAFI AŞIMI ───────────────────────────────────────────────
  {
    const invA = await makeInvoice({ customerId: customer.id, total: 5000 });
    const payS = await makePayment({ customerId: customer.id, amount: 500 });
    await paymentAllocationService.allocate({ invoiceId: invA, paymentId: payS, amount: 400 });
    const m = await err(() => paymentAllocationService.allocate({ invoiceId: invA, paymentId: payS, amount: 200 }));
    check("§4a Tahsilatın kalanını aşan kapama → RED", /kapamaya kalan tutar/i.test(m), m.slice(0, 80));
    check("§4b Kaynak sayacı 400'de kaldı", (await paymentAllocated(payS)).equals(400));
    // ⚠️ Fatura sayacı da geri sarmalı: fatura UPDATE'i kaynak UPDATE'inden ÖNCE
    // koşuyor; tx rollback etmeseydi fatura 600 kapanmış görünürdü ama parası
    // yalnız 400'dü — sessiz bir 200 TL kaybı.
    check("§4c Fatura sayacı da GERİ SARDI (tek tx)", (await invoiceCounters(invA)).paid.equals(400), `paidTotal=${(await invoiceCounters(invA)).paid.toString()}`);
  }

  // ── §5 EŞZAMANLI KAPAMA YARIŞI ───────────────────────────────────────────
  // ⚠️ `Promise.allSettled` burada MEŞRU: beş AYRI transaction var (perf kuralı
  // 11 tek tx client'ını paylaşmaya ilişkindir). Sıralı hale getirilirse bekçi
  // sessizce ölür — ölçtüğü şey tam olarak eşzamanlılıktır.
  {
    const invR = await makeInvoice({ customerId: customer.id, total: 1000 });
    const payR = await makePayment({ customerId: customer.id, amount: 5000 });
    const race = await Promise.allSettled(
      Array.from({ length: 5 }, () => paymentAllocationService.allocate({ invoiceId: invR, paymentId: payR, amount: 300 })),
    );
    const ok = race.filter((r) => r.status === "fulfilled").length;
    const c = await invoiceCounters(invR);
    check("§5a 1000'lik faturaya 5×300 yarışından TAM 3'ü geçti", ok === 3, `başarılı=${ok}`);
    check("§5b paidTotal grandTotal'ı AŞMADI", c.paid.lte(c.grand), `${c.paid.toString()} <= ${c.grand.toString()}`);
    check("§5c paidTotal geçen kapamalarla BİREBİR", c.paid.equals(D(ok).mul(300)), `paidTotal=${c.paid.toString()}`);
    check("§5d Kaynak sayacı da birebir", (await paymentAllocated(payR)).equals(D(ok).mul(300)));
    check("§5e Satır sayısı geçen kapama sayısıyla eşit", (await prisma.paymentAllocation.count({ where: { invoiceId: invR } })) === ok);
  }

  // ── §6 DEFTERE SATIR YAZMAZ ──────────────────────────────────────────────
  // Bakiye faturanın ONAYINDA ve tahsilatın KAYDINDA zaten oynadı. Kapama
  // üçüncü bir satır yazsaydı aynı para üçüncü kez muhasebeleşirdi.
  {
    const invL = await makeInvoice({ customerId: customer.id, total: 250 });
    const payL = await makePayment({ customerId: customer.id, amount: 250 });
    const txnBefore = await prisma.cariTransaction.count({ where: { cariId: cari.id } });
    const balBefore = D(
      (await prisma.cariBalance.findUniqueOrThrow({ where: { cariId_currency: { cariId: cari.id, currency: "TRY" } }, select: { balance: true } })).balance,
    );
    await paymentAllocationService.allocate({ invoiceId: invL, paymentId: payL, amount: 250 });
    const txnAfter = await prisma.cariTransaction.count({ where: { cariId: cari.id } });
    const balAfter = D(
      (await prisma.cariBalance.findUniqueOrThrow({ where: { cariId_currency: { cariId: cari.id, currency: "TRY" } }, select: { balance: true } })).balance,
    );
    check("§6a Kapama DEFTER SATIRI yazmadı", txnAfter === txnBefore, `${txnBefore} → ${txnAfter}`);
    check("§6b Kapama CARİ BAKİYEYİ oynatmadı", balAfter.equals(balBefore), `${balBefore.toString()} → ${balAfter.toString()}`);
  }

  // ── §7 STORNO ÇÖZÜLMESİ ──────────────────────────────────────────────────
  {
    // §7a ⭐ "ENTEGRASYON ATLANIRSA" KANITI
    // ------------------------------------------------------------------
    // Tahsilatı SERVİSTEN GEÇMEDEN elle CANCELLED'a çekmek, tam olarak
    // "entegrasyon satırı unutulmuş" durumunu üretir. Aşağıdaki iki kontrol o
    // durumun neye benzediğini KAYDA GEÇİRİR: fatura hâlâ kapalı görünür ve
    // açık faturalar listesinde HİÇ çıkmaz — yani alacak tahsil edilmeden
    // gözden kaybolur. Gerekçe, satır bir gün silinmek istendiğinde burada
    // duruyor olsun diye yazılıdır.
    //
    // ⚠️ Bu bölüm çağrının VARLIĞINI ölçmez, YOKLUĞUNUN bedelini ölçer.
    // Varlığı §7f uçtan uca doğrular — ikisi birlikte gerekli.
    const invP = await makeInvoice({ customerId: customer.id, total: 800 });
    const payP = await makePayment({ customerId: customer.id, amount: 800 });
    await paymentAllocationService.allocate({ invoiceId: invP, paymentId: payP, amount: 800 });
    await prisma.payment.update({ where: { id: payP }, data: { status: "CANCELLED", cancelledAt: new Date() } });

    const stale = await invoiceCounters(invP);
    check(
      "§7a1 KANIT: entegrasyon ATLANIRSA iptal edilmiş tahsilat faturayı KAPALI tutar",
      stale.paid.equals(800),
      `paidTotal=${stale.paid.toString()} (iptal edilmiş tahsilata rağmen)`,
    );
    const openStale = await paymentAllocationService.listOpenInvoices({ cariId: cari.id, currency: "TRY", direction: PaymentDirection.IN });
    check(
      "§7a2 KANIT: fatura AÇIK listede GÖRÜNMEZ → yaşlandırma onu hiç saymaz",
      !openStale.data.some((r) => r.id === invP),
      "işte 'kapalı görünen ama parası yok olmuş fatura'",
    );

    // Şimdi entegrasyon satırının yaptığı işi yapalım — düzelmeli.
    const rel = await prisma.$transaction(async (tx) => releaseAllocationsForPaymentTx(tx, payP, { reason: "PAYMENT_CANCEL" }));
    check("§7b1 releaseAllocationsForPaymentTx kapamaları çözdü", rel.count === 1 && rel.total.equals(800), `count=${rel.count} total=${rel.total.toString()}`);
    check("§7b2 Fatura sayacı SIFIRLANDI", (await invoiceCounters(invP)).paid.isZero());
    check("§7b3 Kapama satırları SİLİNDİ", (await prisma.paymentAllocation.count({ where: { paymentId: payP } })) === 0);
    const openFixed = await paymentAllocationService.listOpenInvoices({ cariId: cari.id, currency: "TRY", direction: PaymentDirection.IN });
    check("§7b4 Fatura AÇIK listeye GERİ DÖNDÜ", openFixed.data.some((r) => r.id === invP));

    // §7c FATURA STORNOSU → kaynak SERBEST kalır
    const invI = await makeInvoice({ customerId: customer.id, total: 600 });
    const payI = await makePayment({ customerId: customer.id, amount: 600 });
    await paymentAllocationService.allocate({ invoiceId: invI, paymentId: payI, amount: 600 });
    check("§7c1 Kapama öncesi kaynak bağlı", (await paymentAllocated(payI)).equals(600));
    const relI = await prisma.$transaction(async (tx) => releaseAllocationsForInvoiceTx(tx, invI, { reason: "INVOICE_CANCEL" }));
    check("§7c2 releaseAllocationsForInvoiceTx çözdü", relI.count === 1);
    check("§7c3 Tahsilat SERBEST kaldı (başka faturaya bağlanabilir)", (await paymentAllocated(payI)).isZero());
    const invI2 = await makeInvoice({ customerId: customer.id, total: 600 });
    const reused = await paymentAllocationService.allocate({ invoiceId: invI2, paymentId: payI, amount: 600 });
    check("§7c4 Serbest kalan tahsilat GERÇEKTEN yeniden kullanılabildi", Boolean(reused.data.id));

    // §7d ÇEK — C1'in çağıracağı export
    const chq = await makeCheque({ cariId: cari.id, amount: 900 });
    const invC = await makeInvoice({ customerId: customer.id, total: 900 });
    await paymentAllocationService.allocate({ invoiceId: invC, chequeId: chq, amount: 900 });
    check("§7d1 Çekle kapama yazıldı", (await chequeAllocated(chq)).equals(900));
    check("§7d2 Fatura çekle kapandı", (await invoiceCounters(invC)).paid.equals(900));
    // Karşılıksız: C1 önce durumu BOUNCED yapar, sonra bu export'u çağırır.
    await prisma.cheque.update({ where: { id: chq }, data: { status: ChequeStatus.BOUNCED } });
    const relC = await prisma.$transaction(async (tx) => releaseAllocationsForChequeTx(tx, chq, { reason: "CHEQUE_BOUNCE" }));
    check("§7d3 releaseAllocationsForChequeTx çözdü", relC.count === 1 && relC.total.equals(900));
    check("§7d4 Fatura yeniden AÇIK", (await invoiceCounters(invC)).paid.isZero());
    check("§7d5 Çek sayacı sıfırlandı", (await chequeAllocated(chq)).isZero());
    // ⚠️ `dropChequeAllocated` durum süzgeci TAŞIMAMALI: çağrıldığı an çek zaten
    // BOUNCED'dır. Süzgeç konsaydı, çözülmesi gereken TEK durumda çözmezdi.
    check("§7d6 BOUNCED çekte de çözülme çalıştı (durum süzgeci YOK)", relC.count === 1);

    // Boş küme: idempotent ve sessiz.
    const relEmpty = await prisma.$transaction(async (tx) => releaseAllocationsForChequeTx(tx, chq));
    check("§7e Kapaması olmayan kaynakta çözülme NO-OP", relEmpty.count === 0 && relEmpty.total.isZero());

    // ── §7f UÇTAN UCA: ENTEGRASYON SATIRI GERÇEKTEN BAĞLI MI ────────────────
    // ⚠️ §7a/§7b yardımcının KENDİSİNİ ölçer; bu bölüm onun ÇAĞRILDIĞINI ölçer
    // ve ikisi FARKLI sorulardır. Yardımcı kusursuz çalışsa bile çağrı satırı
    // `payment.service.cancel()` / `invoice.service.cancel()` içinden bir
    // refactor'da düşerse hiçbir şey kırmızı vermez — modülün önlemek için var
    // olduğu "kapalı görünen ama parası yok olmuş fatura" sessizce geri gelir.
    // Bu yüzden storno GERÇEK SERVİSTEN geçirilir, elle CANCELLED yazılmaz.
    const invE = await makeInvoice({ customerId: customer.id, total: 700 });
    const payE = await makePayment({ customerId: customer.id, amount: 700 });
    await paymentAllocationService.allocate({ invoiceId: invE, paymentId: payE, amount: 700 });
    check("§7f1 Ön koşul: fatura kapandı", (await invoiceCounters(invE)).paid.equals(700));
    await paymentService.cancel(payE, "bekçi storno");
    check(
      "§7f2 paymentService.cancel() kapamayı ÇÖZDÜ (entegrasyon satırı bağlı)",
      (await invoiceCounters(invE)).paid.isZero(),
      `paidTotal=${(await invoiceCounters(invE)).paid.toString()}`,
    );
    check("§7f3 Kapama satırı silindi", (await prisma.paymentAllocation.count({ where: { paymentId: payE } })) === 0);
    const openE = await paymentAllocationService.listOpenInvoices({ cariId: cari.id, currency: "TRY", direction: PaymentDirection.IN });
    check("§7f4 Fatura AÇIK listeye döndü (yaşlandırma onu yine sayar)", openE.data.some((r) => r.id === invE));

    // Fatura tarafı: iptal edilen fatura tahsilatı SERBEST bırakmalı.
    const invF = await makeInvoice({ customerId: customer.id, total: 400 });
    const payF = await makePayment({ customerId: customer.id, amount: 400 });
    await paymentAllocationService.allocate({ invoiceId: invF, paymentId: payF, amount: 400 });
    await invoiceService.cancel(invF, "bekçi storno");
    check(
      "§7f5 invoiceService.cancel() tahsilatı SERBEST bıraktı",
      (await paymentAllocated(payF)).isZero(),
      `allocatedTotal=${(await paymentAllocated(payF)).toString()}`,
    );
  }

  // ── §8 BİLİNÇLİ DAR KURALLAR ─────────────────────────────────────────────
  {
    const invX = await makeInvoice({ customerId: customer.id, total: 100 });

    // Farklı cari
    const payOther = await makePayment({ customerId: other.id, amount: 100 });
    const otherCari = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: other.id }, select: { id: true } });
    cariIds.push(otherCari.id);
    const m1 = await err(() => paymentAllocationService.allocate({ invoiceId: invX, paymentId: payOther, amount: 100 }));
    check("§8a Farklı carinin ödemesiyle kapama → RED", /başka bir cariye ait/i.test(m1), m1.slice(0, 70));

    // Yön: ÖDEME (OUT) satış faturasını kapatamaz
    const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} Fason` }, select: { id: true } });
    subcontractorIds.push(sub.id);
    const payOut = await makePayment({ subcontractorId: sub.id, direction: "OUT", amount: 100 });
    const subCari = await prisma.cariAccount.findFirstOrThrow({ where: { subcontractorId: sub.id }, select: { id: true } });
    cariIds.push(subCari.id);
    const invSalesForSub = await makeInvoice({ subcontractorId: sub.id, type: "SALES", total: 100 });
    const m2 = await err(() => paymentAllocationService.allocate({ invoiceId: invSalesForSub, paymentId: payOut, amount: 100 }));
    check("§8b ÖDEME (OUT) satış faturasını kapatamaz", /ÖDEMEDİR/i.test(m2), m2.slice(0, 70));
    // Körlük zemini: aynı ödeme ALIŞ faturasını kapatabilmeli (kural yön ayrımı
    // yapıyor, "her şeyi reddet" değil).
    const invPurchase = await makeInvoice({ subcontractorId: sub.id, type: "PURCHASE", total: 100 });
    const okOut = await paymentAllocationService.allocate({ invoiceId: invPurchase, paymentId: payOut, amount: 100 });
    check("§8c KÖRLÜK ZEMİNİ: aynı ödeme ALIŞ faturasını kapattı", Boolean(okOut.data.id));

    // İade faturası kapsam DIŞI (Faz 3) — ama sebebi söylenerek
    const invRet = await makeInvoice({ customerId: customer.id, type: "SALES_RETURN", total: 50 });
    const payRet = await makePayment({ customerId: customer.id, amount: 50 });
    const m3 = await err(() => paymentAllocationService.allocate({ invoiceId: invRet, paymentId: payRet, amount: 50 }));
    check("§8d İade faturası kapama kapsamı DIŞINDA (sebep söyleniyor)", /TAHSİLATTIR|SATIŞ faturasını/i.test(m3), m3.slice(0, 70));

    // TASLAK fatura
    const invDraft = await makeInvoice({ customerId: customer.id, total: 90, confirm: false });
    const m4 = await err(() => paymentAllocationService.allocate({ invoiceId: invDraft, paymentId: payRet, amount: 50 }));
    check("§8e TASLAK fatura kapatılamaz", /onaylanmamış/i.test(m4), m4.slice(0, 70));

    // İPTAL edilmiş tahsilat
    await prisma.payment.update({ where: { id: payRet }, data: { status: "CANCELLED" } });
    const invY = await makeInvoice({ customerId: customer.id, total: 50 });
    const m5 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, paymentId: payRet, amount: 50 }));
    check("§8f İPTAL edilmiş tahsilatla kapama → RED", /iptal edilmiş/i.test(m5), m5.slice(0, 70));

    // KARŞILIKSIZ çek
    const bad = await makeCheque({ cariId: cari.id, amount: 50, status: ChequeStatus.BOUNCED });
    const m6 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, chequeId: bad, amount: 50 }));
    check("§8g KARŞILIKSIZ çekle kapama → RED", /BOUNCED|kapatılamaz/i.test(m6), m6.slice(0, 70));

    // VERİLEN çek satış faturasını kapatamaz
    const issued = await makeCheque({ cariId: cari.id, amount: 50, kind: ChequeKind.ISSUED, status: ChequeStatus.ISSUED });
    const m7 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, chequeId: issued, amount: 50 }));
    check("§8h VERİLEN çek SATIŞ faturasını kapatamaz", /VERİLEN/i.test(m7), m7.slice(0, 70));

    // XOR: iki kaynak birden / hiçbiri
    const m8 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, paymentId: pay1, chequeId: issued, amount: 10 }));
    check("§8i İki kaynak birden → RED (XOR)", /VEYA çek seçilmeli/i.test(m8), m8.slice(0, 60));
    const m9 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, amount: 10 }));
    check("§8j Kaynaksız kapama → RED (XOR)", /VEYA çek seçilmeli/i.test(m9), m9.slice(0, 60));

    // Sıfır/negatif tutar
    const m10 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, paymentId: pay1, amount: 0 }));
    check("§8k Sıfır tutarlı kapama → RED", /sıfırdan büyük/i.test(m10), m10.slice(0, 60));

    // BULK hepsi-ya-hiç
    const invB1 = await makeInvoice({ customerId: customer.id, total: 100 });
    const invB2 = await makeInvoice({ customerId: customer.id, total: 100 });
    const payB = await makePayment({ customerId: customer.id, amount: 150 });
    const mBulk = await err(() =>
      paymentAllocationService.allocateBulk({
        paymentId: payB,
        items: [
          { invoiceId: invB1, amount: 100 },
          { invoiceId: invB2, amount: 100 },
        ],
      }),
    );
    check("§8l BULK: ikincisi sığmayınca tamamı reddedildi", /kapamaya kalan tutar/i.test(mBulk), mBulk.slice(0, 70));
    check("§8m BULK: İLK satır da yazılmadı (hepsi-ya-hiç)", (await invoiceCounters(invB1)).paid.isZero());
    check("§8n BULK: kaynak sayacı da temiz", (await paymentAllocated(payB)).isZero());
    const okBulk = await paymentAllocationService.allocateBulk({
      paymentId: payB,
      items: [
        { invoiceId: invB1, amount: 100 },
        { invoiceId: invB2, amount: 50 },
      ],
    });
    check("§8o KÖRLÜK ZEMİNİ: sığan BULK dağıtım yazıldı", okBulk.data.count === 2 && okBulk.data.total === "150");
  }

  // ── §9 ROTA TARAMASI ─────────────────────────────────────────────────────
  // `test_finance_flag_off` §4 YALNIZ `finance.routes.ts`'i okur; alt router'ın
  // uçları o taramaya GİRMEZ. Aynı iki güvence burada, kendi dosyası üzerinde
  // ölçülür — yoksa bayrak/izin kapısı alt router'da sessizce eksik kalabilirdi.
  {
    const src = readFileSync(join(__dirname, "..", "src", "routes", "finance-allocation.routes.ts"), "utf8");
    const endpoints = (src.match(/router\.(get|post|patch|delete)\(/g) ?? []).length;
    check("§9a KÖRLÜK ZEMİNİ: taramada uç bulundu", endpoints >= 5, `uç=${endpoints}`);
    const guardless = src
      .split("\n")
      .filter((l) => /router\.(get|post|patch|delete)\(/.test(l) && !/requirePermission\(/.test(l));
    check(
      "§9b Alt router'ın HER ucu izin guard'ı taşıyor",
      guardless.length === 0,
      guardless.length > 0 ? guardless.map((l) => l.trim().slice(0, 50)).join(" | ") : "guard'sız uç yok",
    );
    // Yazan uçlar `finance:payment`, okuyanlar `finance:read` — yeni izin AÇILMADI.
    const newPerm = src.match(/requirePermission\("([^"]+)"\)/g) ?? [];
    const unexpected = newPerm.filter((p) => !/finance:(read|payment)/.test(p));
    check("§9c Yeni izin kodu AÇILMADI (yalnız finance:read / finance:payment)", unexpected.length === 0, unexpected.join(", ") || "temiz");

    // Bayrak kapısı: alt router `app.ts`'e DEĞİL, finance.routes'a mount edilmeli.
    const parent = readFileSync(join(__dirname, "..", "src", "routes", "finance.routes.ts"), "utf8");
    check(
      "§9d Alt router bayrak kapılı ana router'a mount edilmiş",
      /router\.use\(\s*"\/allocations"\s*,/.test(parent),
      "finance.routes.ts → router.use('/allocations', ...)",
    );
    const app = readFileSync(join(__dirname, "..", "src", "app.ts"), "utf8");
    check(
      "§9e `app.ts` kapama router'ını DOĞRUDAN mount ETMİYOR (bayrak kapısı atlanmasın)",
      !/finance-allocation/.test(app),
      "app.ts temiz",
    );
  }

  // ── §10 FIFO ÖNERİSİ ─────────────────────────────────────────────────────
  {
    // Saf fonksiyon önce — dağıtım mantığı DB'siz ölçülür.
    const dist = suggestFifo([D(100), D(200), D(300)], D(250));
    check(
      "§10a suggestFifo en eskiden başlayarak dağıtır",
      dist.map((d) => d.toString()).join("/") === "100/150/0",
      dist.map((d) => d.toString()).join("/"),
    );
    const distOver = suggestFifo([D(100)], D(500));
    check("§10b Fazla tutar taşmaz (açık kadar dağıtılır)", distOver[0]?.equals(100) === true);
    check("§10c Kalan artık ÖNERİLMEZ (sanal kapama uydurulmaz)", suggestFifo([], D(500)).length === 0);

    // Sıralama: vadesi ÖNCE olan üstte, vadesizde keşide tarihi geçerli.
    const fifoCustomer = await prisma.customer.create({ data: { code: `${TAG}-F2`, name: `${TAG} FIFO` }, select: { id: true } });
    customerIds.push(fifoCustomer.id);
    const day = 86400_000;
    const late = await makeInvoice({ customerId: fifoCustomer.id, total: 100, dueDate: new Date(Date.now() + 30 * day) });
    const early = await makeInvoice({ customerId: fifoCustomer.id, total: 200, dueDate: new Date(Date.now() + 5 * day) });
    // Vadesiz ama ÇOK ESKİ keşideli: efektif vade `issueDate`'tir → en üstte
    // olmalı. `dueDate` nulls-last ile sıralansaydı en ALTA düşer ve FIFO
    // önerisi en eski borcu en son öderdi.
    const oldNoDue = await makeInvoice({ customerId: fifoCustomer.id, total: 300, dueDate: null, issueDate: new Date(Date.now() - 100 * day) });
    const fifoCari = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: fifoCustomer.id }, select: { id: true } });
    cariIds.push(fifoCari.id);

    const open = await paymentAllocationService.listOpenInvoices({
      cariId: fifoCari.id,
      currency: "TRY",
      direction: PaymentDirection.IN,
      amount: 350,
    });
    const order = open.data.map((r) => r.id);
    check("§10d Efektif vade sırası: vadesiz-eski → yakın vade → uzak vade", order.join(",") === [oldNoDue, early, late].join(","), order.length === 3 ? "3 fatura doğru sırada" : `sıra=${order.length}`);
    check("§10e Toplam açık doğru", open.totalOpen === "600", open.totalOpen);
    check(
      "§10f FIFO önerisi tutarı sırayla dağıttı (300/50/0)",
      open.data.map((r) => r.suggested).join("/") === "300/50/0",
      open.data.map((r) => r.suggested).join("/"),
    );
    // Determinizm: aynı sorgu iki kez → aynı sıra.
    const again = await paymentAllocationService.listOpenInvoices({ cariId: fifoCari.id, currency: "TRY", direction: PaymentDirection.IN });
    check("§10g Sıra DETERMİNİSTİK (aynı sorgu → aynı sıra)", again.data.map((r) => r.id).join(",") === order.join(","));
    // `amount` verilmezse öneri HİÇ üretilmez — okuma ucu sessizce kapama önermez.
    check("§10h `amount` yokken öneri alanı BASILMAZ", again.data.every((r) => r.suggested === undefined));

    // Serbest tahsilat listesi
    const freePay = await makePayment({ customerId: fifoCustomer.id, amount: 400 });
    await paymentAllocationService.allocate({ invoiceId: oldNoDue, paymentId: freePay, amount: 300 });
    const un = await paymentAllocationService.listUnallocatedPayments({ cariId: fifoCari.id, currency: "TRY", direction: PaymentDirection.IN });
    const freeRow = un.data.find((r) => r.id === freePay);
    check("§10i Serbest tahsilat listesi kalanı doğru gösterdi", freeRow?.freeTotal === "100", freeRow?.freeTotal ?? "yok");
    check("§10j Tamamen bağlanmış tahsilat listede YOK", !un.data.some((r) => r.id === pay1));
  }

  // ── §11 DEALLOCATE (elle düzeltme) ───────────────────────────────────────
  {
    const invD = await makeInvoice({ customerId: customer.id, total: 700 });
    const payD = await makePayment({ customerId: customer.id, amount: 700 });
    const a = await paymentAllocationService.allocate({ invoiceId: invD, paymentId: payD, amount: 700 });
    await paymentAllocationService.deallocate(a.data.id);
    check("§11a Kapama çözüldü — fatura sayacı sıfır", (await invoiceCounters(invD)).paid.isZero());
    check("§11b Kaynak sayacı sıfır", (await paymentAllocated(payD)).isZero());
    check("§11c Satır silindi", (await prisma.paymentAllocation.count({ where: { id: a.data.id } })) === 0);
    const m = await err(() => paymentAllocationService.deallocate(a.data.id));
    check("§11d İkinci çözme → 404 (sayaç İKİNCİ KEZ düşmez)", /bulunamadı/i.test(m), m.slice(0, 60));
  }

  // ── §12 MUTABAKAT (TÜM DB) ───────────────────────────────────────────────
  // Üç sayacın da kapama satırlarıyla birebir olması gerekir. Bu, C2'nin
  // `test_consistency`ye taşınacak çekirdeğidir: sayaçlar defterden bağımsız
  // yaşadığı için sapmalarını başka hiçbir kontrol göremez.
  {
    const invDrift = await prisma.$queryRaw<Array<{ docNo: string; stored: string; summed: string }>>`
      SELECT i."docNo", i."paidTotal"::text AS stored, COALESCE(a.total, 0)::text AS summed
        FROM "invoices" i
        LEFT JOIN (SELECT "invoiceId", SUM("amount") AS total FROM "payment_allocations" GROUP BY "invoiceId") a
               ON a."invoiceId" = i."id"
       WHERE i."paidTotal" <> COALESCE(a.total, 0)
    `;
    check(
      "§12a SUM(allocation) === Invoice.paidTotal (tüm faturalar)",
      invDrift.length === 0,
      invDrift.length > 0 ? invDrift.map((d) => `${d.docNo}: ${d.stored}≠${d.summed}`).join(", ") : "sapma yok",
    );
    const payDrift = await prisma.$queryRaw<Array<{ docNo: string; stored: string; summed: string }>>`
      SELECT p."docNo", p."allocatedTotal"::text AS stored, COALESCE(a.total, 0)::text AS summed
        FROM "payments" p
        LEFT JOIN (SELECT "paymentId", SUM("amount") AS total FROM "payment_allocations" WHERE "paymentId" IS NOT NULL GROUP BY "paymentId") a
               ON a."paymentId" = p."id"
       WHERE p."allocatedTotal" <> COALESCE(a.total, 0)
    `;
    check(
      "§12b SUM(allocation) === Payment.allocatedTotal (tüm tahsilatlar)",
      payDrift.length === 0,
      payDrift.length > 0 ? payDrift.map((d) => `${d.docNo}: ${d.stored}≠${d.summed}`).join(", ") : "sapma yok",
    );
    const chqDrift = await prisma.$queryRaw<Array<{ docNo: string; stored: string; summed: string }>>`
      SELECT c."docNo", c."allocatedTotal"::text AS stored, COALESCE(a.total, 0)::text AS summed
        FROM "cheques" c
        LEFT JOIN (SELECT "chequeId", SUM("amount") AS total FROM "payment_allocations" WHERE "chequeId" IS NOT NULL GROUP BY "chequeId") a
               ON a."chequeId" = c."id"
       WHERE c."allocatedTotal" <> COALESCE(a.total, 0)
    `;
    check(
      "§12c SUM(allocation) === Cheque.allocatedTotal (tüm çekler)",
      chqDrift.length === 0,
      chqDrift.length > 0 ? chqDrift.map((d) => `${d.docNo}: ${d.stored}≠${d.summed}`).join(", ") : "sapma yok",
    );
    // Tavan seddi: hiçbir fatura kendi tutarından fazla kapanmış olamaz.
    const over = await prisma.$queryRaw<Array<{ docNo: string }>>`
      SELECT "docNo" FROM "invoices" WHERE "paidTotal" > "grandTotal" OR "paidTotal" < 0
    `;
    check("§12d Hiçbir faturada paidTotal > grandTotal (DB CHECK'in ikinci ölçümü)", over.length === 0, over.map((o) => o.docNo).join(", ") || "temiz");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // TEMİZLİK SIRASI FK'lara bağlı: allocation → invoice/payment/cheque hepsi
    // RESTRICT. Kapama satırları önce silinmezse fatura silinemez ve bekçi bir
    // sonraki koşuda "TAG zaten var" ile çöker.
    try {
      if (invoiceIds.length > 0) await prisma.paymentAllocation.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      if (paymentIds.length > 0) await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
      if (chequeIds.length > 0) await prisma.paymentAllocation.deleteMany({ where: { chequeId: { in: chequeIds } } });

      if (chequeIds.length > 0) {
        await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: chequeIds } } });
        await prisma.cheque.deleteMany({ where: { id: { in: chequeIds } } });
      }
      if (invoiceIds.length > 0) {
        await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        // Donmuş belgelerin FK'sı yok (polimorfik sourceId) → ayrıca silinir,
        // yoksa her koşuda birikirler.
        await prisma.printedDocument.deleteMany({ where: { docType: "INVOICE_INTERNAL", sourceId: { in: invoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      if (paymentIds.length > 0) {
        await prisma.cariTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } });
        await prisma.printedDocument.deleteMany({ where: { docType: "PAYMENT_RECEIPT", sourceId: { in: paymentIds } } });
        await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      }
      if (cariIds.length > 0) {
        await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
      }
      if (cashBoxId) await prisma.cashBox.deleteMany({ where: { id: cashBoxId } });
      if (customerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      if (subcontractorIds.length > 0) await prisma.subcontractor.deleteMany({ where: { id: { in: subcontractorIds } } });
    } catch (e) {
      console.error("⚠️  Temizlik tamamlanamadı:", (e as Error).message);
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
