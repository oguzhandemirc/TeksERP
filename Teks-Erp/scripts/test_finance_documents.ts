// =============================================================================
// BEKÇİ — ÖN MUHASEBE ÇIKTILARI (iç fatura + tahsilat/ödeme makbuzu)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_finance_documents.ts
//
// NEDEN: Fatura ve makbuz RESMİ KAYITTIR. Donmuş belge zincirine bağlanmalarının
// tek sebebi budur: içerik sonradan değişirse elde duran kâğıt yalan söyler.
// Bu bekçi "belge doğuyor mu" değil, **NE ZAMAN doğduğunu** ve **iptalde ne
// olduğunu** kilitler — iki tarihin de yanlış olması sessiz bir arızadır.
//
// ⚠️ İKİ BELGENİN DONMA ANI FARKLI ve bu bilinçli:
//   • FATURA → ONAYDA donar. Taslak serbestçe düzenlenip silinebilir; resmi
//     kayıt onayla doğar. Taslakta dondurmak, sonradan değişecek bir metni
//     "resmi" ilan etmek olurdu.
//   • MAKBUZ → KAYITTA donar. Para el değiştirdiği an makbuz verilir; "onay"
//     diye ikinci bir adım YOKTUR.
// Birini diğerine benzetmek en kolay yapılacak hatadır; §1c ve §3b bunu ölçer.
//
// ÖLÇÜLENLER:
//   §1 Fatura: taslakta belge YOK → onayda DONAR (versiyon 1)
//   §2 Fatura stornosu → belge VOIDED (SİLİNMEZ; İPTAL filigranıyla basılır)
//   §3 Makbuz: kayıt anında DONAR
//   §4 Makbuz iptali → VOIDED
//   §5 ⭐ Tutarlar SNAPSHOT'tan basılır (yeniden hesaplanmaz)
//   §6 İzin hizası: read ⊇ write (görüp basamama kapanı yok)
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `invoice.service.ts` onay yolundaki
//    `freezeForSource(..., INVOICE_INTERNAL, ...)` çağrısı kaldırıldı → ÜÇ kontrol
//    KIRMIZI (§1b belge dondu · §1c versiyon 1 ve aktif · §5a snapshot toplamı).
//    Geri konunca 20/20 yeşil. Bekçi "fatura deftere işlendi ama resmi belge
//    doğmadı" sınıfını yakalıyor — o sınıf sessizdir, hata ancak baskıda çıkar.
// =============================================================================
import { PrintedDocType, PrintedDocStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { DOC_PERMISSIONS } from "../src/routes/printed-document.routes";

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

const TAG = `TEST-FDOC-${Date.now()}`;
const invoiceIds: string[] = [];
const paymentIds: string[] = [];
let customerId: string | null = null;
let cariId: string | null = null;
let cashBoxId: string | null = null;

const docsOf = (sourceId: string, docType: PrintedDocType) =>
  prisma.printedDocument.findMany({
    where: { docType, sourceId },
    select: { id: true, version: true, status: true, snapshot: true },
    orderBy: { version: "asc" },
  });

async function main(): Promise<void> {
  console.log("=== Ön muhasebe belgeleri bekçisi ===\n");

  const actor = await prisma.user.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  const customer = await prisma.customer.create({
    data: { code: TAG, name: `${TAG} Müşteri` },
    select: { id: true },
  });
  customerId = customer.id;

  // ── §1 FATURA: taslak → onay ────────────────────────────────────────────
  const draft = await invoiceService.createDraft(
    {
      type: "SALES",
      customerId: customer.id,
      currency: "TRY",
      lines: [
        { description: `${TAG} Patos Gri`, qty: 100, unit: "m", unitPrice: 12.5, vatRate: 20 },
        { description: `${TAG} Nakliye`, qty: 1, unit: "adet", unitPrice: 250, vatRate: 20 },
      ],
    },
    actor.id,
  );
  const invId = (draft.data as { id: string }).id;
  invoiceIds.push(invId);
  cariId = (await prisma.invoice.findUniqueOrThrow({ where: { id: invId }, select: { cariId: true } })).cariId;

  check("§1a TASLAK fatura belge DOĞURMAZ", (await docsOf(invId, PrintedDocType.INVOICE_INTERNAL)).length === 0);

  await invoiceService.confirm(invId, actor.id);
  const afterConfirm = await docsOf(invId, PrintedDocType.INVOICE_INTERNAL);
  check("§1b ⭐ ONAYDA belge DONDU", afterConfirm.length === 1, `n=${afterConfirm.length}`);
  check("§1c Versiyon 1 ve AKTİF", afterConfirm[0]?.version === 1 && afterConfirm[0]?.status === PrintedDocStatus.ACTIVE);

  // §5 — tutarlar snapshot'tan; belgeye DAMGALANMIŞ olmalı.
  const snap = afterConfirm[0]?.snapshot as { doc?: { totals?: Record<string, string> } } | null;
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invId },
    select: { grandTotal: true, subtotal: true },
  });
  check(
    "§5a ⭐ Genel toplam SNAPSHOT'ta ve defterle BİREBİR",
    snap?.doc?.totals?.grand === inv.grandTotal.toString(),
    `snapshot=${snap?.doc?.totals?.grand} defter=${inv.grandTotal.toString()}`,
  );
  check(
    "§5b Ara toplam da snapshot'ta",
    snap?.doc?.totals?.net === inv.subtotal.toString(),
    `${snap?.doc?.totals?.net}`,
  );

  // HTML gerçekten üretiliyor mu (renderer bağlı mı)?
  const html = (await printedDocumentService.getHtml(PrintedDocType.INVOICE_INTERNAL, invId)).data?.html ?? "";
  check("§5c Belge HTML'i üretildi", html.includes("<html"), `${html.length} bayt`);
  // Genel toplam 1800,00 (1500 net + 300 KDV) — kâğıtta tr-TR biçiminde.
  check("§5d ⭐ Tutar KÂĞIDA basıldı (tr-TR biçiminde)", html.includes("1.800,00"), "1.800,00 aranıyor");

  // ── §2 FATURA STORNOSU ──────────────────────────────────────────────────
  await invoiceService.cancel(invId, `${TAG} deneme iptali`, actor.id);
  const afterCancel = await docsOf(invId, PrintedDocType.INVOICE_INTERNAL);
  check("§2a Belge SİLİNMEDİ (donmuş belge kuralı)", afterCancel.length === 1);
  check(
    "§2b ⭐ Belge VOIDED'a çekildi (İPTAL filigranıyla basılabilir)",
    afterCancel[0]?.status === PrintedDocStatus.VOIDED,
    `status=${afterCancel[0]?.status}`,
  );

  // ── §3 MAKBUZ: kayıt anında donar ───────────────────────────────────────
  const box = await prisma.cashBox.create({
    data: { code: `${TAG}-KASA`, name: `${TAG} Kasa`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxId = box.id;
  const pay = await paymentService.create(
    {
      direction: "IN",
      method: "CASH",
      customerId: customer.id,
      cashBoxId: box.id,
      currency: "TRY",
      amount: 500,
      paymentDate: new Date(),
      notes: `${TAG} tahsilat`,
    },
    actor.id,
  );
  const payId = (pay.data as { id: string }).id;
  paymentIds.push(payId);

  const payDocs = await docsOf(payId, PrintedDocType.PAYMENT_RECEIPT);
  check("§3a ⭐ Makbuz KAYIT anında DONDU (onay adımı yok)", payDocs.length === 1, `n=${payDocs.length}`);
  check("§3b Versiyon 1 ve AKTİF", payDocs[0]?.version === 1 && payDocs[0]?.status === PrintedDocStatus.ACTIVE);

  const payHtml = (await printedDocumentService.getHtml(PrintedDocType.PAYMENT_RECEIPT, payId)).data?.html ?? "";
  check("§3c Makbuz HTML'i üretildi", payHtml.includes("<html"), `${payHtml.length} bayt`);
  check(
    "§3d ⭐ Başlık YÖNDEN geldi (tahsilat ≠ ödeme)",
    payHtml.toLocaleUpperCase("tr").includes("TAHSİLAT MAKBUZU"),
  );

  // ── §4 MAKBUZ İPTALİ ────────────────────────────────────────────────────
  await paymentService.cancel(payId, `${TAG} deneme iptali`, actor.id);
  const payAfter = await docsOf(payId, PrintedDocType.PAYMENT_RECEIPT);
  check("§4a Makbuz SİLİNMEDİ", payAfter.length === 1);
  check("§4b ⭐ Makbuz VOIDED", payAfter[0]?.status === PrintedDocStatus.VOIDED, `status=${payAfter[0]?.status}`);

  // ── §6 İZİN HİZASI ──────────────────────────────────────────────────────
  // Liste izniyle baskı izni ayrışırsa kullanıcı belgeyi GÖRÜR, basar, hiçbir
  // şey olmaz (sessiz 403). READ, WRITE'ı KAPSAMALI.
  for (const dt of [PrintedDocType.INVOICE_INTERNAL, PrintedDocType.PAYMENT_RECEIPT]) {
    const entry = DOC_PERMISSIONS[dt];
    check(`§6a ${dt} DOC_PERMISSIONS'ta tanımlı`, Boolean(entry?.read?.length && entry?.write?.length));
    check(
      `§6b ${dt} read ⊇ write (görüp basamama kapanı yok)`,
      (entry?.write ?? []).every((w) => (entry?.read ?? []).includes(w)),
      `read=${entry?.read?.join(",")} write=${entry?.write?.join(",")}`,
    );
  }
  // Körlük zemini: DOC_PERMISSIONS gerçekten dolu mu?
  check("§6c KÖRLÜK ZEMİNİ: DOC_PERMISSIONS dolu", Object.keys(DOC_PERMISSIONS).length >= 9, `${Object.keys(DOC_PERMISSIONS).length} tip`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    const srcIds = [...invoiceIds, ...paymentIds];
    if (srcIds.length > 0) await prisma.printedDocument.deleteMany({ where: { sourceId: { in: srcIds } } });
    if (paymentIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await prisma.cashTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } }); // tek yazar: ödeme satırı FK RESTRICT
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    if (invoiceIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    if (cariId) {
      await prisma.cariTransaction.deleteMany({ where: { cariId } });
      await prisma.cariBalance.deleteMany({ where: { cariId } });
      await prisma.cariAccount.deleteMany({ where: { id: cariId } });
    }
    if (cashBoxId) await prisma.cashBox.deleteMany({ where: { id: cashBoxId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
