// =============================================================================
// BEKÇİ — KURULUM GÜNÜ: devir bakiyeleri · carisiz kasa hareketi · virman
// =============================================================================
// Çalıştırma: npx tsx scripts/test_finance_opening.ts
//
// NEDEN: Bir firmanın programa geçtiği GÜN, sistemdeki her rakamın doğruluğu
// buraya bağlıdır. Devir girilemezse ya da yanlış girilirse hiçbir bakiye,
// hiçbir ekstre ve hiçbir yaşlandırma doğru olamaz — ve yanlışlığın kaynağı
// aylar sonra bile bulunamaz.
//
// İkinci konu: kasa bakiyesinin artık İKİ YAZARI var (Payment + CashTransaction).
// Bu, mutabakat formülünün en kolay unutulan genişlemesi; unutulursa ilk masraf
// fişinde §23 kırmızı verir (iyi) ya da daha kötüsü, formül tek-yazarlı kalıp
// yanlış "drift" raporlar.
//
// ÖLÇÜLENLER:
//   §1 Cari devir: defter satırı (ADJUSTMENT) + bakiye; POZİTİF=borçlu,
//      NEGATİF=alacaklı; İKİNCİ devir 409
//   §2 ⭐ Devir bakiyeye ELLE YAZILMAZ — defterden türer (§21 mutabakatı)
//   §3 Masraf fişi (carisiz): kasa bakiyesi düşer, CARİ defterine satır YOK
//   §4 Açılış hesap başına TEK (partial unique + anlamlı 409)
//   §5 ⭐ VİRMAN: tek uç iki satır, aynı grup, çıkan+giren dengeli, iki bakiye
//   §6 ⭐ Virman İPTALİ İKİ BACAĞI birden alır (tek bacak iptali yasak)
//   §7 Tür↔yön tutarlılığı DB'de kilitli (gider yön IN olamaz)
//   §8 Farklı para birimli virman reddedilir (kur işlemi ≠ virman)
//   §9 İdempotency: aynı clientToken ikinci kayıt açmaz
// =============================================================================
import { Prisma, CashTxnKind, PaymentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { cariService } from "../src/services/cari.service";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { D } from "../src/services/helpers/finance.helper";

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

const TAG = `TEST-OPEN-${Date.now()}`;
const cashBoxIds: string[] = [];
const bankIds: string[] = [];
const cariIds: string[] = [];
let customerId: string | null = null;

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

const boxBalance = async (id: string) =>
  D((await prisma.cashBox.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance);
const bankBalance = async (id: string) =>
  D((await prisma.bankAccount.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance);

async function main(): Promise<void> {
  console.log("=== Kurulum günü bekçisi ===\n");

  // Bekçi KENDİ fixture'ını yaratır (ortam verisine dokunmaz).
  const customer = await prisma.customer.create({
    data: { code: TAG, name: `${TAG} Müşteri` },
    select: { id: true },
  });
  customerId = customer.id;
  const cari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: customer.id },
    select: { id: true },
  });
  cariIds.push(cari.id);

  const box = await prisma.cashBox.create({
    data: { code: `${TAG}-KS`, name: `${TAG} Kasa`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxIds.push(box.id);
  const bank = await prisma.bankAccount.create({
    data: { code: `${TAG}-BN`, name: `${TAG} Banka`, currency: "TRY" },
    select: { id: true },
  });
  bankIds.push(bank.id);

  // ── §1 CARİ DEVİR ───────────────────────────────────────────────────────
  await cariService.setOpeningBalance({ cariId: cari.id, currency: "TRY", balance: 15000, description: "2025 devri" });
  const txns = await prisma.cariTransaction.findMany({
    where: { cariId: cari.id, sourceType: "ADJUSTMENT" },
    select: { debit: true, credit: true, description: true },
  });
  check("§1a Devir TEK defter satırı yazdı", txns.length === 1, `satır=${txns.length}`);
  check("§1b POZİTİF devir BORÇ kolonuna (cari bize borçlu)", txns[0] ? D(txns[0].debit).equals(15000) : false);
  const bal = await prisma.cariBalance.findUniqueOrThrow({
    where: { cariId_currency: { cariId: cari.id, currency: "TRY" } },
    select: { balance: true },
  });
  check("§1c Bakiye devir kadar", D(bal.balance).equals(15000), `bakiye=${bal.balance}`);

  const dupErr = await expectError(() =>
    cariService.setOpeningBalance({ cariId: cari.id, currency: "TRY", balance: 999 }),
  );
  check("§1d İKİNCİ devir REDDEDİLDİ", /zaten girilmiş/i.test(dupErr), dupErr.slice(0, 70));

  // Negatif devir (biz borçluyuz) — farklı para biriminde.
  await cariService.setOpeningBalance({ cariId: cari.id, currency: "USD", balance: -500, description: "USD devri" });
  const usdBal = await prisma.cariBalance.findUniqueOrThrow({
    where: { cariId_currency: { cariId: cari.id, currency: "USD" } },
    select: { balance: true },
  });
  check("§1e NEGATİF devir alacak kolonuna (biz borçluyuz)", D(usdBal.balance).equals(-500), `bakiye=${usdBal.balance}`);

  // ── §2 DEFTERDEN TÜRER (mutabakat) ──────────────────────────────────────
  const drift = await prisma.$queryRaw<Array<{ c: string }>>`
    SELECT b."cariId"::text AS c FROM cari_balances b
    LEFT JOIN (SELECT "cariId", currency, SUM(debit)-SUM(credit) AS t
                 FROM cari_transactions GROUP BY "cariId", currency) x
      ON x."cariId"=b."cariId" AND x.currency=b.currency
    WHERE b."cariId" = ${cari.id}::uuid AND b.balance <> COALESCE(x.t, 0)`;
  check("§2 ⭐ Devir bakiyesi DEFTERDEN türüyor (elle yazılmadı)", drift.length === 0);

  // ── §3 MASRAF FİŞİ (carisiz) ────────────────────────────────────────────
  const cariTxnBefore = await prisma.cariTransaction.count();
  await cashTransactionService.create({
    kind: "EXPENSE",
    cashBoxId: box.id,
    amount: 2500,
    category: "Kira",
    description: "Ağustos kirası",
  });
  check("§3a Masraf kasadan DÜŞTÜ", (await boxBalance(box.id)).equals(-2500), `bakiye=${await boxBalance(box.id)}`);
  check(
    "§3b ⭐ Carisiz hareket CARİ deftere satır YAZMADI",
    (await prisma.cariTransaction.count()) === cariTxnBefore,
  );

  // ── §4 AÇILIŞ HESAP BAŞINA TEK ──────────────────────────────────────────
  await cashTransactionService.create({ kind: "OPENING", cashBoxId: box.id, amount: 10000, description: "Kasa devri" });
  check("§4a Açılış kasaya girdi", (await boxBalance(box.id)).equals(7500), `bakiye=${await boxBalance(box.id)}`);
  const openErr = await expectError(() =>
    cashTransactionService.create({ kind: "OPENING", cashBoxId: box.id, amount: 1 }),
  );
  check("§4b İKİNCİ açılış REDDEDİLDİ (anlamlı mesaj)", /açılış bakiyesi zaten/i.test(openErr), openErr.slice(0, 70));

  // ── §5 VİRMAN ───────────────────────────────────────────────────────────
  const tr = await cashTransactionService.transfer({ fromCashBoxId: box.id, toBankAccountId: bank.id, amount: 3000 });
  check("§5a Tek uç İKİ belge üretti", tr.data.docNos.length === 2, tr.data.docNos.join(" / "));
  const legs = await prisma.cashTransaction.findMany({
    where: { id: { in: tr.data.ids } },
    select: { kind: true, direction: true, amount: true, transferGroupId: true },
  });
  check(
    "§5b Bacaklar AYNI grupta ve zıt yönde",
    legs.length === 2 &&
      legs[0]?.transferGroupId === legs[1]?.transferGroupId &&
      new Set(legs.map((l) => l.direction)).size === 2,
  );
  check("§5c Kasa düştü", (await boxBalance(box.id)).equals(4500), `kasa=${await boxBalance(box.id)}`);
  check("§5d Banka arttı", (await bankBalance(bank.id)).equals(3000), `banka=${await bankBalance(bank.id)}`);

  // ── §6 VİRMAN İPTALİ İKİ BACAK ──────────────────────────────────────────
  await cashTransactionService.cancel(tr.data.ids[0] as string, "bekçi");
  const cancelled = await prisma.cashTransaction.findMany({
    where: { id: { in: tr.data.ids } },
    select: { status: true },
  });
  check(
    "§6a ⭐ Tek bacak iptali İKİ bacağı birden aldı",
    cancelled.every((c) => c.status === PaymentStatus.CANCELLED),
    `iptal=${cancelled.filter((c) => c.status === "CANCELLED").length}/2`,
  );
  check("§6b Kasa geri döndü", (await boxBalance(box.id)).equals(7500), `kasa=${await boxBalance(box.id)}`);
  check("§6c Banka geri döndü", (await bankBalance(bank.id)).isZero(), `banka=${await bankBalance(bank.id)}`);

  // ── §7 TÜR↔YÖN DB'DE KİLİTLİ ────────────────────────────────────────────
  // Servis doğru yönü kendisi koyuyor; burada ölçülen DB seddi — servis bir gün
  // yanlış yön yazsa bile satır DB'ye giremesin.
  const chkErr = await expectError(() =>
    prisma.$executeRaw`INSERT INTO cash_transactions
      ("id","docNo","kind","direction","status","cashBoxId","currency","exchangeRate","amount","amountTry","txnDate","createdAt","updatedAt")
      VALUES (gen_random_uuid(), ${`${TAG}-BAD`}, 'EXPENSE', 'IN', 'ACTIVE', ${box.id}::uuid, 'TRY', 1, 100, 100, now(), now(), now())`,
  );
  check("§7 Gider yönü IN olamaz (CHECK)", /kind_matches_direction/i.test(chkErr), chkErr.slice(0, 60));

  // ── §8 FARKLI PARA BİRİMLİ VİRMAN ───────────────────────────────────────
  const usdBox = await prisma.cashBox.create({
    data: { code: `${TAG}-USD`, name: `${TAG} USD Kasa`, currency: "USD" },
    select: { id: true },
  });
  cashBoxIds.push(usdBox.id);
  const curErr = await expectError(() =>
    cashTransactionService.transfer({ fromCashBoxId: box.id, toCashBoxId: usdBox.id, amount: 100 }),
  );
  check("§8 Farklı para birimli virman REDDEDİLDİ", /farklı para birimleri/i.test(curErr), curErr.slice(0, 70));

  // ── §9 İDEMPOTENCY ──────────────────────────────────────────────────────
  const token = crypto.randomUUID();
  const first = await cashTransactionService.create({
    kind: "EXPENSE",
    cashBoxId: box.id,
    amount: 50,
    clientToken: token,
  });
  const second = await cashTransactionService.create({
    kind: "EXPENSE",
    cashBoxId: box.id,
    amount: 50,
    clientToken: token,
  });
  check("§9a Aynı token ikinci kayıt AÇMADI", first.data.id === second.data.id, `${first.data.docNo}`);
  check("§9b Bakiye TEK kez düştü", (await boxBalance(box.id)).equals(7450), `kasa=${await boxBalance(box.id)}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.cashTransaction.deleteMany({
      where: { OR: [{ cashBoxId: { in: cashBoxIds } }, { bankAccountId: { in: bankIds } }] },
    });
    if (cariIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
    }
    if (cashBoxIds.length > 0) await prisma.cashBox.deleteMany({ where: { id: { in: cashBoxIds } } });
    if (bankIds.length > 0) await prisma.bankAccount.deleteMany({ where: { id: { in: bankIds } } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
