// =============================================================================
// BEKÇİ — EKSİ KASA ENGELİ (finance.blockNegativeCashEnabled)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_cash_negative_guard.ts
//
// NEDEN VAR: Sektör kuralı (Logo kasa fişi eksi bakiye kontrolü / SAP B1
// negative block) OPT-IN bir bayrakla geldi. Bekçinin kilitlediği sözleşme:
//
//   §1 ⭐ BAYRAK KAPALI (varsayılan) → eksiye düşen yazım GEÇER — bugünkü
//      davranış bayt-bayt korunur (fabrika sıfır-fark garantisi).
//   §2 ⭐ BAYRAK AÇIK → 4 İLERİ yol 409: ödeme OUT · masraf fişi · virmanın
//      çıkan KASA bacağı · çek ödeme. Mesaj SOMUT (kasa adı + mevcut bakiye +
//      istenen tutar + "açılış" ipucu). Reddedilen tx İZ BIRAKMAZ (satır yok,
//      bakiye değişmedi).
//   §3 Yeterli bakiye + para GİREN türler (OPENING/INCOME/IN) bayrak açıkken
//      de serbest.
//   §4 ⭐ TERS YOLLAR MUAF (muafiyet sondası): payment.cancel ·
//      cashTransaction.cancel · cheque.cancelCollect bakiyeyi eksiye
//      DÜŞÜREBİLİR — muafiyet kaldırılırsa (guard bir ters yola eklenirse)
//      bu bölüm kırmızı verir. Gerekçe: yanlış tahsilat "kasa yetmez" diye
//      iptal edilemez kalamaz; para gerçeği ekran kuralından önce gelir.
//   §5 ⭐ BANKA MUAF: eksiye düşen banka çıkışı bayrak açıkken de geçer
//      (kredili mevduat meşru).
//   §6 ⭐ TOCTOU: aynı kasadan 2 PARALEL çekim (100 bakiye, 2×80) → TAM BİRİ
//      geçer, biri 409; bakiye 20. ⚠️ Bilinen ölçüm sınırı: bu bölüm ÖZELLİĞİ
//      ölçer, mekanizmayı değil — guard'daki FOR UPDATE körleştirilse bile
//      kasa-dönem guard'ının hesap-bazlı advisory kilidi (8028) aynı hesabın
//      yazarlarını zaten serileştirdiği için yeşil kalabilir. FOR UPDATE
//      derinlik savunmasıdır (advisory kilit bir gün yeniden sıralanırsa /
//      kaldırılırsa guard kendi ayakları üstünde durur); silmeden önce yerine
//      ne koyduğunu bil (CLAUDE.md "tx içi tazeleme" emsali).
//
// NEGATİF SONDALAR (2026-08-14, boz-ölç-geri yükle cp+shasum ile):
//   • Guard körleştirilince (enabled kontrolü her zaman false) → §2/§3c/§6
//     kırmızı. • Guard payment.cancel'a eklenince → §4a kırmızı (muafiyet
//     sondası). • updateSchema'dan financeDefaultVatRate düşünce →
//     test_feature_flag_contract kırmızı (o bekçinin sondası).
// =============================================================================
import { Prisma, PaymentDirection, PaymentMethod, ChequeKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { paymentService } from "../src/services/payment.service";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { chequeService } from "../src/services/cheque.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

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

const TAG = `TCNG${Date.now() % 1e9}`; // code VarChar(32) sınırı — kısa tut
const boxIds: string[] = [];
const bankIds: string[] = [];
const cariIds: string[] = [];
const customerIds: string[] = [];
const paymentIds: string[] = [];
const chequeIds: string[] = [];
const FLAG_KEY = SETTING_KEYS.FINANCE_BLOCK_NEGATIVE_CASH_ENABLED;
let priorFlagRow: { value: Prisma.JsonValue } | null = null;
let flagRowExisted = false;

async function setFlag(on: boolean): Promise<void> {
  // Doğrudan ayar yazımı BİLİNÇLİ: enforcement reader cache'siz olduğu için
  // anında etkilidir; HTTP/route sözleşmesini test_feature_flag_contract ölçer.
  await prisma.systemSetting.upsert({
    where: { key: FLAG_KEY },
    create: { key: FLAG_KEY, value: on },
    update: { value: on },
  });
}

async function makeBox(suffix: string): Promise<string> {
  const b = await prisma.cashBox.create({
    data: { code: `${TAG}-${suffix}`, name: `${TAG} kasa ${suffix}`, currency: "TRY" },
    select: { id: true },
  });
  boxIds.push(b.id);
  return b.id;
}

async function makeBank(suffix: string): Promise<string> {
  const b = await prisma.bankAccount.create({
    data: { code: `${TAG}-${suffix}`, name: `${TAG} banka ${suffix}`, currency: "TRY" },
    select: { id: true },
  });
  bankIds.push(b.id);
  return b.id;
}

async function balanceOf(ref: { cashBoxId?: string; bankAccountId?: string }): Promise<string> {
  if (ref.cashBoxId) {
    const r = await prisma.cashBox.findUniqueOrThrow({ where: { id: ref.cashBoxId }, select: { balance: true } });
    return r.balance.toFixed(2);
  }
  const r = await prisma.bankAccount.findUniqueOrThrow({
    where: { id: ref.bankAccountId as string },
    select: { balance: true },
  });
  return r.balance.toFixed(2);
}

async function expectConflict(fn: () => Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await fn();
    return { status: 0, message: "(hata fırlamadı)" };
  } catch (e) {
    const err = e as AppError;
    return { status: err.statusCode ?? -1, message: err.message || "(mesajsız)" };
  }
}

async function main() {
  console.log("=== Eksi kasa engeli (finance.blockNegativeCashEnabled) ===\n");

  // ── §0 Fixture + bayrak fotoğrafı ──────────────────────────────────────────
  priorFlagRow = await prisma.systemSetting.findUnique({ where: { key: FLAG_KEY }, select: { value: true } });
  flagRowExisted = priorFlagRow !== null;

  const customer = await prisma.customer.create({
    data: { code: `${TAG}-C`, name: `${TAG} müşteri` },
    select: { id: true },
  });
  customerIds.push(customer.id);

  // ── §1 BAYRAK KAPALI → bugünkü davranış: eksiye düşen yazım GEÇER ─────────
  await setFlag(false);
  const box1 = await makeBox("B1");
  const r1 = await cashTransactionService.create({
    kind: "EXPENSE",
    cashBoxId: box1,
    amount: 100,
    category: "test",
    clientToken: crypto.randomUUID(),
  });
  check("§1a bayrak KAPALI: 0 bakiyeli kasadan 100 masraf GEÇER (bugünkü davranış)", r1.success === true);
  check("§1b bakiye -100.00 (eksi bakiye bayrak kapalıyken serbest)", (await balanceOf({ cashBoxId: box1 })) === "-100.00");

  // ── §2 BAYRAK AÇIK → 4 İLERİ YOL 409 ──────────────────────────────────────
  await setFlag(true);

  // 2a — payment.create OUT (kasadan ödeme)
  const box2 = await makeBox("B2");
  const payBaseline = await prisma.payment.count({ where: { cashBoxId: box2 } });
  const e2a = await expectConflict(() =>
    paymentService.create({
      direction: PaymentDirection.OUT,
      method: PaymentMethod.CASH,
      customerId: customer.id,
      amount: 100,
      cashBoxId: box2,
      clientToken: crypto.randomUUID(),
    }),
  );
  check("§2a ödeme (OUT, kasa) → 409", e2a.status === 409, e2a.message);
  check(
    "§2a mesaj SOMUT: kasa adı + mevcut bakiye + istenen tutar + açılış ipucu",
    e2a.message.includes(`${TAG} kasa B2`) &&
      e2a.message.includes("0.00") &&
      e2a.message.includes("100.00") &&
      e2a.message.toLocaleLowerCase("tr").includes("açılış"),
    e2a.message,
  );
  check("§2a reddedilen tx İZ BIRAKMADI (payment satırı yok)", (await prisma.payment.count({ where: { cashBoxId: box2 } })) === payBaseline);
  check("§2a bakiye değişmedi (0.00)", (await balanceOf({ cashBoxId: box2 })) === "0.00");

  // 2b — cash-transaction EXPENSE
  const e2b = await expectConflict(() =>
    cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box2, amount: 50, clientToken: crypto.randomUUID() }),
  );
  check("§2b masraf fişi (EXPENSE, kasa) → 409", e2b.status === 409, e2b.message);
  check("§2b masraf satırı doğmadı", (await prisma.cashTransaction.count({ where: { cashBoxId: box2 } })) === 0);

  // 2c — virmanın ÇIKAN kasa bacağı
  const bank1 = await makeBank("BK1");
  const e2c = await expectConflict(() =>
    cashTransactionService.transfer({ fromCashBoxId: box2, toBankAccountId: bank1, amount: 70, clientToken: crypto.randomUUID() }),
  );
  check("§2c virman (kasa → banka, kasa yetersiz) → 409", e2c.status === 409, e2c.message);
  check("§2c virman bacakları doğmadı", (await prisma.cashTransaction.count({ where: { OR: [{ cashBoxId: box2 }, { bankAccountId: bank1 }] } })) === 0);

  // 2d — çek ödeme (kendi çekimiz kasadan)
  const issued = await chequeService.create({
    kind: ChequeKind.ISSUED,
    customerId: customer.id,
    amount: 100,
    dueDate: new Date(),
    clientToken: crypto.randomUUID(),
  });
  chequeIds.push(issued.data.id);
  const e2d = await expectConflict(() => chequeService.pay(issued.data.id, { cashBoxId: box2 }));
  check("§2d çek ödeme (kasadan) → 409", e2d.status === 409, e2d.message);
  const chq = await prisma.cheque.findUniqueOrThrow({ where: { id: issued.data.id }, select: { status: true } });
  check("§2d çek ISSUED'da kaldı (claim geri sarıldı)", chq.status === "ISSUED", chq.status);

  // ── §3 Bayrak açıkken meşru yollar ────────────────────────────────────────
  const opening = await cashTransactionService.create({
    kind: "OPENING",
    cashBoxId: box2,
    amount: 100,
    clientToken: crypto.randomUUID(),
  });
  check("§3a açılış (OPENING, para GİRER) bayrak açıkken serbest", opening.success === true);
  const spend = await cashTransactionService.create({
    kind: "EXPENSE",
    cashBoxId: box2,
    amount: 60,
    clientToken: crypto.randomUUID(),
  });
  check("§3b yeterli bakiyede masraf GEÇER (100 → 40)", spend.success === true && (await balanceOf({ cashBoxId: box2 })) === "40.00");
  const e3c = await expectConflict(() =>
    cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box2, amount: 50, clientToken: crypto.randomUUID() }),
  );
  check("§3c bakiyeyi aşan ikinci masraf (40 < 50) → 409", e3c.status === 409, e3c.message);

  // ── §4 TERS YOLLAR MUAF (muafiyet sondası) ────────────────────────────────
  // 4a — payment.cancel: IN tahsilatın stornosu kasayı eksiye düşürebilir.
  const box4 = await makeBox("B4");
  const payIn = await paymentService.create({
    direction: PaymentDirection.IN,
    method: PaymentMethod.CASH,
    customerId: customer.id,
    amount: 100,
    cashBoxId: box4,
    clientToken: crypto.randomUUID(),
  });
  paymentIds.push(payIn.data.id);
  await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box4, amount: 100, clientToken: crypto.randomUUID() });
  check("§4a kurulum: tahsilat 100 + masraf 100 → bakiye 0.00", (await balanceOf({ cashBoxId: box4 })) === "0.00");
  const cancelIn = await paymentService.cancel(payIn.data.id, "test stornosu");
  check(
    "§4a ⭐ payment.cancel bayrak AÇIKKEN eksiye düşürerek GEÇER (storno muaf)",
    cancelIn.success === true && (await balanceOf({ cashBoxId: box4 })) === "-100.00",
    await balanceOf({ cashBoxId: box4 }),
  );

  // 4b — cashTransaction.cancel: INCOME iptali.
  const box5 = await makeBox("B5");
  const income = await cashTransactionService.create({
    kind: "INCOME",
    cashBoxId: box5,
    amount: 50,
    clientToken: crypto.randomUUID(),
  });
  await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box5, amount: 50, clientToken: crypto.randomUUID() });
  const cancelIncome = await cashTransactionService.cancel(income.data.id, "test");
  check(
    "§4b ⭐ cashTransaction.cancel eksiye düşürerek GEÇER (iptal muaf)",
    cancelIncome.success === true && (await balanceOf({ cashBoxId: box5 })) === "-50.00",
    await balanceOf({ cashBoxId: box5 }),
  );

  // 4c — cheque.cancelCollect (K-2 tahsil stornosu).
  const box6 = await makeBox("B6");
  const received = await chequeService.create({
    kind: ChequeKind.RECEIVED,
    customerId: customer.id,
    amount: 100,
    dueDate: new Date(),
    clientToken: crypto.randomUUID(),
  });
  chequeIds.push(received.data.id);
  await chequeService.collect(received.data.id, { cashBoxId: box6 });
  await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box6, amount: 100, clientToken: crypto.randomUUID() });
  const undoCollect = await chequeService.cancelCollect(received.data.id, "yanlış tahsil — test");
  check(
    "§4c ⭐ cheque.cancelCollect eksiye düşürerek GEÇER (K-2 stornosu muaf)",
    undoCollect.success === true && (await balanceOf({ cashBoxId: box6 })) === "-100.00",
    await balanceOf({ cashBoxId: box6 }),
  );

  // ── §5 BANKA MUAF ─────────────────────────────────────────────────────────
  const bank2 = await makeBank("BK2");
  const bankOut = await paymentService.create({
    direction: PaymentDirection.OUT,
    method: PaymentMethod.BANK_TRANSFER,
    customerId: customer.id,
    amount: 100,
    bankAccountId: bank2,
    clientToken: crypto.randomUUID(),
  });
  paymentIds.push(bankOut.data.id);
  check(
    "§5 ⭐ banka MUAF: 0 bakiyeli bankadan 100 ödeme bayrak AÇIKKEN geçer (kredili mevduat)",
    bankOut.success === true && (await balanceOf({ bankAccountId: bank2 })) === "-100.00",
  );

  // ── §6 TOCTOU: 2 paralel çekim → TAM BİRİ geçer ───────────────────────────
  const box7 = await makeBox("B7");
  await cashTransactionService.create({ kind: "OPENING", cashBoxId: box7, amount: 100, clientToken: crypto.randomUUID() });
  // İki AYRI üst-düzey servis çağrısı = iki ayrı tx (perf kuralı 11 tek tx
  // client'ını paylaşmaya ilişkindir; burada paylaşım yok — KK1 bekçisi emsali).
  const results = await Promise.allSettled([
    cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box7, amount: 80, clientToken: crypto.randomUUID() }),
    cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box7, amount: 80, clientToken: crypto.randomUUID() }),
  ]);
  const okCount = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  check("§6a ⭐ 2 paralel 80'lik çekimden TAM BİRİ geçti", okCount === 1, `geçen=${okCount}`);
  check(
    "§6b kaybeden 409 aldı (guard taze bakiyeyi gördü)",
    rejected !== undefined && (rejected.reason as AppError).statusCode === 409,
    rejected ? (rejected.reason as Error).message : "(reddedilen yok)",
  );
  check("§6c bakiye 20.00 (çifte harcama yok)", (await balanceOf({ cashBoxId: box7 })) === "20.00");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    try {
      // Bayrağı fotoğrafına geri döndür (paylaşımlı dev DB — iz bırakma).
      if (flagRowExisted && priorFlagRow) {
        await prisma.systemSetting.update({
          where: { key: FLAG_KEY },
          data: { value: priorFlagRow.value ?? Prisma.JsonNull },
        });
      } else {
        await prisma.systemSetting.deleteMany({ where: { key: FLAG_KEY } });
      }

      if (chequeIds.length > 0) {
        await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: chequeIds } } });
        await prisma.cariTransaction.deleteMany({ where: { chequeId: { in: chequeIds } } });
      }
      const caris = await prisma.cariAccount.findMany({
        where: { customerId: { in: customerIds } },
        select: { id: true },
      });
      cariIds.push(...caris.map((c) => c.id));
      if (paymentIds.length > 0 || cariIds.length > 0) {
        const pays = await prisma.payment.findMany({ where: { cariId: { in: cariIds } }, select: { id: true } });
        const allPayIds = [...new Set([...paymentIds, ...pays.map((p) => p.id)])];
        if (allPayIds.length > 0) {
          await prisma.printedDocument.deleteMany({ where: { sourceId: { in: allPayIds } } });
          await prisma.cariTransaction.deleteMany({ where: { paymentId: { in: allPayIds } } });
          await prisma.payment.deleteMany({ where: { id: { in: allPayIds } } });
        }
      }
      if (chequeIds.length > 0) await prisma.cheque.deleteMany({ where: { id: { in: chequeIds } } });
      if (cariIds.length > 0) {
        await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
      }
      if (boxIds.length > 0 || bankIds.length > 0) {
        await prisma.cashTransaction.deleteMany({
          where: { OR: [{ cashBoxId: { in: boxIds } }, { bankAccountId: { in: bankIds } }] },
        });
      }
      if (boxIds.length > 0) await prisma.cashBox.deleteMany({ where: { id: { in: boxIds } } });
      if (bankIds.length > 0) await prisma.bankAccount.deleteMany({ where: { id: { in: bankIds } } });
      if (customerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    } catch (e) {
      console.error("CLEANUP HATASI:", e);
      fail++;
    }
    await prisma.$disconnect().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
