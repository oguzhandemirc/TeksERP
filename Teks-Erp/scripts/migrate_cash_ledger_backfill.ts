// =============================================================================
// KASA/BANKA DEFTERİ GEÇMİŞ DOLDURMA — satırsız tahsilat/ödemelere defter satırı (2026-09-18, tek yazar dilimi)
// =============================================================================
// KURU KOŞUM VARSAYILAN. Yazmak için: --apply
//   npx tsx scripts/migrate_cash_ledger_backfill.ts
//   npx tsx scripts/migrate_cash_ledger_backfill.ts --apply
//
// NEDEN: tek yazar dilimine kadar carili tahsilat/ödeme (`Payment`) kasa/banka defterine SATIR YAZMIYOR, bakiyeyi
// doğrudan oynatıyordu → Kasa Hareketleri o parayı göstermiyordu. Yeni ödemeler satırla doğar; ESKİ ödemeler için satır
// bu script açar. BAKİYEYE DOKUNMAZ: eski yazar bakiyeyi zaten işlemişti; satır açılırken bakiye bir daha oynatılmaz.
// NEDEN OTOMATİK DEĞİL: canlı veriye toplu INSERT — dry-run her aday kaydı listeler, operatör görür, sonra --apply.
// İDEMPOTENT: `cash_transactions.paymentId` @unique — ikinci koşum 0 yeni satır. GERİ ALMA: `DELETE FROM cash_transactions
// WHERE "paymentId" IS NOT NULL AND "createdAt" >= <koşum anı>` (yalnız bu script'in yazdığı satırlar; yeni ödemelerin
// satırlarına DOKUNMA — createdAt koşumdan sonraysa ödeme de sonradır, önce ödemeyi kontrol et).
// SONUNDA: hesap başına `balance ↔ Σ ACTIVE satır` eşitlik raporu — fark varsa LİSTELENİR, otomatik düzeltilmez (ayrı karar).
// Okuyucular satırsız ödemeyi `NOT EXISTS (paymentId)` ile zaten sayıyor: backfill öncesi de sonrası da rapor doğrudur.
// =============================================================================
import { CashTxnKind, PaymentDirection, PaymentStatus, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";
import { nextCashNoTx } from "../src/services/helpers/cash-ledger.helper";
import { izDustuUyarisi, onarimIziYaz } from "./lib/onarim-izi";

const APPLY = process.argv.includes("--apply");

type Aday = {
  id: string; docNo: string; direction: PaymentDirection; status: PaymentStatus; amount: Prisma.Decimal; currency: string; exchangeRate: Prisma.Decimal;
  cashBoxId: string | null; bankAccountId: string | null; paymentDate: Date; reference: string | null; createdById: string | null;
  cancelledAt: Date | null; cancelledById: string | null; cancelReason: string | null;
};

async function esitlikRaporu(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ hesap: string; ad: string; kayitli: Prisma.Decimal; hesaplanan: Prisma.Decimal }>>`
    SELECT 'KASA' || ' ' || c.name AS ad, c.id::text AS hesap, c.balance AS kayitli,
           COALESCE((SELECT SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) FROM cash_transactions t WHERE t."cashBoxId" = c.id AND t.status <> 'CANCELLED'), 0)
         + COALESCE((SELECT SUM(CASE WHEN p.direction = 'IN' THEN p.amount ELSE -p.amount END) FROM payments p WHERE p."cashBoxId" = c.id AND p.status <> 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM cash_transactions x WHERE x."paymentId" = p.id)), 0) AS hesaplanan
      FROM cash_boxes c
    UNION ALL
    SELECT 'BANKA' || ' ' || b.name, b.id::text, b.balance,
           COALESCE((SELECT SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) FROM cash_transactions t WHERE t."bankAccountId" = b.id AND t.status <> 'CANCELLED'), 0)
         + COALESCE((SELECT SUM(CASE WHEN p.direction = 'IN' THEN p.amount ELSE -p.amount END) FROM payments p WHERE p."bankAccountId" = b.id AND p.status <> 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM cash_transactions x WHERE x."paymentId" = p.id)), 0)
      FROM bank_accounts b`;
  // ⚠️ Çek olayları (ChequeEvent) bu rapora GİRMEZ — bu script yalnız ödeme satırlarını ölçer; tam formül test_consistency §23/§24.
  const farkli = rows.filter((r) => !new Prisma.Decimal(r.kayitli).equals(new Prisma.Decimal(r.hesaplanan)));
  console.log(`\nEşitlik raporu (bakiye ↔ Σ kasa defteri + satırsız ödeme; çek olayları HARİÇ): ${rows.length} hesap, ${farkli.length} fark`);
  for (const r of farkli) console.log(`  ⚠️ ${r.ad.padEnd(28)} kayıtlı ${String(r.kayitli).padStart(14)}  Σ ${String(r.hesaplanan).padStart(14)}  fark ${new Prisma.Decimal(r.kayitli).minus(r.hesaplanan).toString()}  (çek tahsilatı/ödemesi varsa fark beklenir)`);
  return farkli.length;
}

async function main(): Promise<void> {
  console.log(`\n=== Kasa defteri geçmiş doldurma — ${APPLY ? "UYGULAMA" : "KURU KOŞUM"} ===`);
  console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}\n`);

  const adaylar = await prisma.payment.findMany({
    where: { OR: [{ cashBoxId: { not: null } }, { bankAccountId: { not: null } }], cashTransaction: null },
    select: { id: true, docNo: true, direction: true, status: true, amount: true, currency: true, exchangeRate: true, cashBoxId: true, bankAccountId: true, paymentDate: true, reference: true, createdById: true, cancelledAt: true, cancelledById: true, cancelReason: true },
    orderBy: [{ paymentDate: "asc" }, { docNo: "asc" }],
  });
  if (adaylar.length === 0) {
    console.log("Satırsız tahsilat/ödeme YOK — yapılacak iş yok.");
    await esitlikRaporu();
    return;
  }
  console.log(`${"Belge".padEnd(16)} ${"Yön".padEnd(4)} ${"Durum".padEnd(10)} ${"Tutar".padStart(14)} ${"Hesap".padEnd(6)} Tarih`);
  let toplam = new Prisma.Decimal(0);
  for (const a of adaylar as Aday[]) {
    console.log(`${a.docNo.padEnd(16)} ${a.direction.padEnd(4)} ${a.status.padEnd(10)} ${String(a.amount).padStart(14)} ${(a.cashBoxId ? "KASA" : "BANKA").padEnd(6)} ${a.paymentDate.toISOString().slice(0, 10)}`);
    if (a.status === PaymentStatus.ACTIVE) toplam = toplam.plus(a.direction === PaymentDirection.IN ? a.amount : new Prisma.Decimal(a.amount).negated());
  }
  console.log(`TOPLAM: ${adaylar.length} ödeme (aktif net ${toplam.toString()})\n`);

  if (!APPLY) {
    console.log("KURU KOŞUM — hiçbir şey yazılmadı. Yazmak için: --apply\n");
    await esitlikRaporu();
    return;
  }

  let yazildi = 0;
  for (const a of adaylar as Aday[]) {
    // Satır başına tx; yarış koruması: bu arada satırı doğmuş ödeme (yeni akış ya da paralel koşum) @unique ile atlanır.
    try {
      await prisma.$transaction(async (tx) => {
        const docNo = await nextCashNoTx(tx, a.paymentDate);
        await tx.cashTransaction.create({
          data: {
            docNo,
            kind: a.direction === PaymentDirection.IN ? CashTxnKind.COLLECTION : CashTxnKind.PAYMENT,
            direction: a.direction,
            status: a.status,
            cashBoxId: a.cashBoxId, bankAccountId: a.bankAccountId,
            currency: a.currency as never, exchangeRate: a.exchangeRate, amount: a.amount,
            amountTry: new Prisma.Decimal(a.amount).mul(a.exchangeRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
            txnDate: a.paymentDate,
            description: `${a.docNo}${a.reference ? ` — ${a.reference}` : ""} (geçmiş doldurma)`,
            reference: a.reference,
            paymentId: a.id,
            createdById: a.createdById,
            cancelledAt: a.cancelledAt, cancelledById: a.cancelledById, cancelReason: a.cancelReason,
          },
        });
      });
      yazildi++;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "P2002") console.log(`  ↷ ${a.docNo}: satırı bu arada doğmuş — atlandı.`);
      else throw e;
    }
  }
  console.log(`✅ ${yazildi} defter satırı açıldı (aday ${adaylar.length}). BAKİYE DEĞİŞTİRİLMEDİ.`);
  const fark = await esitlikRaporu();

  const SCRIPT = "scripts/migrate_cash_ledger_backfill.ts";
  const iz = await onarimIziYaz({ script: SCRIPT, action: "CASH_LEDGER_PAYMENT_BACKFILL", tableName: "CASH_TRANSACTION", olcum: { yazilan: yazildi, aday: adaylar.length, atlanan: adaylar.length - yazildi, farkliHesap: fark } });
  if (!iz) { console.error(izDustuUyarisi(SCRIPT, false)); process.exitCode = 1; }
}

main()
  .catch((e) => { console.error("HATA:", e instanceof Error ? e.message : String(e)); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
