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
//   §7 ⭐ EŞZAMANLI clientToken ÇİFT-GÖNDERİMİ (I2, cash-transaction.create):
//      pencere elle açık tutulan tx ile deterministik (kazananın token'ı unique
//      indekste UNCOMMITTED → ön kontrol göremez, kaybeden indekste bekler) →
//      kaybeden cached yanıt alır; TAM BİR kayıt; eşzamanlı = ardışık replay
//      BAYT-BAYT.
//   §8 ⭐ AYNISI transfer için: token yalnız ÇIKAN bacakta; cached yanıt İKİ
//      bacağı OUT-önce sırayla döner (loadTransferByToken tek kaynak — ön
//      kontrol ile çarpışma catch'i aynı helper'ı çağırır).
//   §9 ⭐ KABLOLAMA TARAMASI (AST, metot seviyesi): kasa/banka bakiyesine yazan
//      HER İLERİ servis yolu `assertCashBalanceCoversTx` çağırıyor — yeni yazar
//      doğarsa guard'sız doğamaz (test_cash_period_close §9 emsali, ama İKİ
//      YÖNLÜ: ileri yol guard'SIZSA kırmızı, TERS yol guard'LIYSA da kırmızı —
//      §4 muafiyetinin mekanik ikizi). Körlük zemini + muaf listesi iki yönlü
//      denetimli. ⚠️ Yazılı sınır: sınıflandırma METOT ADINDAN (/cancel/i =
//      ters yol); iptali "cancel" içermeyen bir adla yazan yeni yol İLERİ
//      sayılır ve guard ister — bu bilinçli (yanlış tarafa düşmek gürültülü).
//
// NEGATİF SONDALAR (2026-08-14, boz-ölç-geri yükle cp+shasum ile):
//   • Guard körleştirilince (enabled kontrolü her zaman false) → §2/§3c/§6
//     kırmızı. • Guard payment.cancel'a eklenince → §4a kırmızı (muafiyet
//     sondası). • updateSchema'dan financeDefaultVatRate düşünce →
//     test_feature_flag_contract kırmızı (o bekçinin sondası).
//   • I2 sondası: cash-transaction.create'in withBarcodeRetry predicate'i
//     (`!isClientTokenP2002`) düşürülünce token P2002'si 5 tur boşa retry
//     edilir → §7 kırmızı ("Barkod üretimi ... başarısız" ham 409'u).
//   • Kablolama sondası: create'ten `assertCashBalanceCoversTx` çağrısı
//     silinince → §9 kırmızı (+ §2b/§3c işlevsel kırmızı).
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

/** §7/§8 yarış sondaları — pencereyi elle açık tutmak için (goods_receipt_invoice §10 emsali). */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e?: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

  // Bu noktadan sonrası eksi-kasa bayrağını ölçmüyor — kapat ki §7/§8'in
  // masraf fişleri 0 bakiyeli kasada 409'a takılmasın (bugünkü varsayılan).
  await setFlag(false);

  // ── §7 ⭐ EŞZAMANLI clientToken ÇİFT-GÖNDERİMİ (I2, create) ──────────────
  // Pencere zamanlamayla DEĞİL elle açık tutulan tx ile kurulur (yarış bekçisi
  // kuralı): kazananın satırı unique indekse UNCOMMITTED yazılıdır → kaybedenin
  // ön kontrolü göremez (READ COMMITTED), INSERT'i indeks kilidinde bekler;
  // gate commit → P2002 → predicate propagate → catch cached yanıta çevirir.
  {
    const box8 = await makeBox("B8");
    const rplToken = crypto.randomUUID();
    const rplLock = deferred<{ id: string; docNo: string }>();
    const rplGate = deferred<void>();
    const rplTx = prisma.$transaction(
      async (tx) => {
        const winner = await tx.cashTransaction.create({
          data: {
            docNo: `${TAG}-RPL1`,
            kind: "EXPENSE",
            direction: PaymentDirection.OUT,
            cashBoxId: box8,
            amount: new Prisma.Decimal(40),
            amountTry: new Prisma.Decimal(40),
            txnDate: new Date(),
            clientToken: rplToken,
          },
          select: { id: true, docNo: true },
        });
        rplLock.resolve(winner);
        await rplGate.promise;
        return winner;
      },
      { timeout: 20_000 },
    );
    // Gate-tx promise'i await'ten önce reddedebilir — no-op catch olmadan
    // unhandled rejection süreci Sonuç satırı basılmadan öldürür (CLAUDE.md eki ②).
    void rplTx.catch(() => {});
    const winner = await rplLock.promise;

    let loserSettled = false;
    const loserP = cashTransactionService
      .create({ kind: "EXPENSE", cashBoxId: box8, amount: 40, clientToken: rplToken })
      .finally(() => {
        loserSettled = true;
      });
    void loserP.catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    check("§7a ⭐ kaybeden UNIQUE indekste BEKLEDİ (ön kontrol kazananı görmedi → pencere gerçek)", !loserSettled);
    rplGate.resolve();
    await rplTx;
    const loserRes = await loserP;
    check(
      "§7b ⭐ kaybeden BAŞARILI ve KAZANANIN kaydını aldı (ham hata yok, mükerrer yok)",
      loserRes.success === true && loserRes.data.id === winner.id && loserRes.data.docNo === winner.docNo,
      `docNo=${loserRes.data?.docNo}`,
    );
    const seqRes = await cashTransactionService.create({
      kind: "EXPENSE",
      cashBoxId: box8,
      amount: 40,
      clientToken: rplToken,
    });
    check(
      "§7c ⭐ eşzamanlı replay yanıtı ardışık replay ile BAYT-BAYT aynı",
      JSON.stringify(loserRes) === JSON.stringify(seqRes),
      `eşzamanlı=${JSON.stringify(loserRes)}`,
    );
    check("§7d token'lı TAM BİR kayıt", (await prisma.cashTransaction.count({ where: { clientToken: rplToken } })) === 1);
    check(
      "§7e kaybedenin tx'i GERİ SARILDI: kasa bakiyesi oynamadı (gate satırı bakiye yazmaz)",
      (await balanceOf({ cashBoxId: box8 })) === "0.00",
      await balanceOf({ cashBoxId: box8 }),
    );
  }

  // ── §8 ⭐ AYNISI VİRMAN İÇİN (token yalnız ÇIKAN bacakta) ────────────────
  {
    const box9 = await makeBox("B9");
    const bank3 = await makeBank("BK3");
    const rplToken = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    const rplLock = deferred<{ outId: string; outNo: string; inId: string; inNo: string }>();
    const rplGate = deferred<void>();
    const rplTx = prisma.$transaction(
      async (tx) => {
        const outRow = await tx.cashTransaction.create({
          data: {
            docNo: `${TAG}-RPL2A`,
            kind: "TRANSFER_OUT",
            direction: PaymentDirection.OUT,
            cashBoxId: box9,
            amount: new Prisma.Decimal(25),
            amountTry: new Prisma.Decimal(25),
            txnDate: new Date(),
            transferGroupId: groupId,
            clientToken: rplToken,
          },
          select: { id: true, docNo: true },
        });
        const inRow = await tx.cashTransaction.create({
          data: {
            docNo: `${TAG}-RPL2B`,
            kind: "TRANSFER_IN",
            direction: PaymentDirection.IN,
            bankAccountId: bank3,
            amount: new Prisma.Decimal(25),
            amountTry: new Prisma.Decimal(25),
            txnDate: new Date(),
            transferGroupId: groupId,
          },
          select: { id: true, docNo: true },
        });
        rplLock.resolve({ outId: outRow.id, outNo: outRow.docNo, inId: inRow.id, inNo: inRow.docNo });
        await rplGate.promise;
      },
      { timeout: 20_000 },
    );
    void rplTx.catch(() => {});
    const winner = await rplLock.promise;

    let loserSettled = false;
    const loserP = cashTransactionService
      .transfer({ fromCashBoxId: box9, toBankAccountId: bank3, amount: 25, clientToken: rplToken })
      .finally(() => {
        loserSettled = true;
      });
    void loserP.catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    check("§8a ⭐ kaybeden virman UNIQUE indekste BEKLEDİ", !loserSettled);
    rplGate.resolve();
    await rplTx;
    const loserRes = await loserP;
    check(
      "§8b ⭐ kaybeden BAŞARILI: iki bacak, ÇIKAN-önce sırayla (normal yanıtın [out,in] sırası)",
      loserRes.success === true &&
        JSON.stringify(loserRes.data.ids) === JSON.stringify([winner.outId, winner.inId]) &&
        JSON.stringify(loserRes.data.docNos) === JSON.stringify([winner.outNo, winner.inNo]),
      `ids=${JSON.stringify(loserRes.data?.ids)}`,
    );
    const seqRes = await cashTransactionService.transfer({
      fromCashBoxId: box9,
      toBankAccountId: bank3,
      amount: 25,
      clientToken: rplToken,
    });
    check(
      "§8c ⭐ eşzamanlı replay yanıtı ardışık replay ile BAYT-BAYT aynı (tek kaynak: loadTransferByToken)",
      JSON.stringify(loserRes) === JSON.stringify(seqRes),
      `eşzamanlı=${JSON.stringify(loserRes)}`,
    );
    check(
      "§8d grupta TAM İKİ bacak (kaybedenin tx'i geri sarıldı — 4 bacak yok)",
      (await prisma.cashTransaction.count({ where: { transferGroupId: groupId } })) === 2,
    );
    check(
      "§8e bakiyeler oynamadı (kaybeden yarım virman bırakmadı)",
      (await balanceOf({ cashBoxId: box9 })) === "0.00" && (await balanceOf({ bankAccountId: bank3 })) === "0.00",
    );
  }

  // ── §9 ⭐ KABLOLAMA TARAMASI — eksi-kasa guard'ı HER İLERİ yazara bağlı mı ─
  // test_cash_period_close §9 emsali (o, DÖNEM guard'ını dosya seviyesinde
  // tarar); burası EKSİ-KASA guard'ını METOT seviyesinde tarar, çünkü kural
  // yön ayrımlıdır: aynı dosyada ileri yol guard İSTER (payment.create), ters
  // yol guard'dan MUAF olmak ZORUNDADIR (payment.cancel — §4'ün mekanik ikizi).
  // Dosya seviyesi bu ayrımı göremezdi.
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const ts = await import("typescript");
    const servicesDir = path.resolve(__dirname, "..", "src", "services");

    type Unit = { file: string; name: string; writes: boolean; guards: boolean };
    const units = new Map<string, Unit>();

    const scanFile = (full: string, rel: string): void => {
      const sf = ts.createSourceFile(full, fs.readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true);
      const stack: string[] = [];
      const unitKey = (): string => `${rel}#${stack[0] ?? "(module)"}`;
      const mark = (patch: Partial<Unit>): void => {
        const key = unitKey();
        const cur = units.get(key) ?? { file: rel, name: stack[0] ?? "(module)", writes: false, guards: false };
        units.set(key, { ...cur, ...patch });
      };
      const visit = (n: import("typescript").Node): void => {
        // Adlı birim = sınıf metodu ya da modül fonksiyonu. İç içe adlı birim
        // (tx callback'i gibi ok fonksiyonları ADSIZDIR) dış birime yazılır —
        // yazma/guard tespiti için doğru atıf budur (kilit-sırası taramasının
        // tersi; oradaki gövde ayrımı burada yanlış olurdu).
        const named =
          (ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name && ts.isIdentifier(n.name)
            ? n.name.text
            : null;
        if (named) stack.push(named);
        if (ts.isCallExpression(n)) {
          const e = n.expression;
          if (ts.isIdentifier(e)) {
            if (e.text.startsWith("moveAccountBalance")) mark({ writes: true });
            if (e.text === "assertCashBalanceCoversTx") mark({ guards: true });
          }
          // Doğrudan yazım: `tx.cashBox.update` / `tx.bankAccount.update`
          // (payment.create sarmalayıcısız yazar — desen adı değil YAPIYI arar).
          if (ts.isPropertyAccessExpression(e) && e.name.text === "update") {
            const owner = e.expression;
            if (
              ts.isPropertyAccessExpression(owner) &&
              (owner.name.text === "cashBox" || owner.name.text === "bankAccount")
            ) {
              mark({ writes: true });
            }
          }
        }
        ts.forEachChild(n, visit);
        if (named) stack.pop();
      };
      visit(sf);
    };

    const walkTs = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walkTs(full);
        return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
      });
    for (const full of walkTs(servicesDir)) scanFile(full, path.relative(servicesDir, full));

    // `moveAccountBalance*` birimlerinin KENDİSİ yazma ilkelidir (guard çağıranda
    // yaşar) — yazar listesinden düşülür; sınıflandırma çağıranlar üzerinde.
    const writers = [...units.values()].filter((u) => u.writes && !u.name.startsWith("moveAccountBalance"));
    const isReverse = (u: Unit): boolean => /cancel/i.test(u.name);
    const forward = writers.filter((u) => !isReverse(u));
    const reverse = writers.filter(isReverse);

    /** İLERİ olup guard İSTEMEYEN tek meşru sınıf: para GİREN yol. İki yönlü
     *  denetimli — birim kaybolursa YA DA guard kazanırsa muaf bayatlar (red). */
    const EXEMPT_FORWARD: Record<string, string> = {
      "cheque.service.ts#collect": "para GİREN yol (tahsilat) — eksi kasa riski yok, guard yalnız ÇIKIŞLARI kapılar",
    };

    check(
      "§9a KÖRLÜK ZEMİNİ: kasa/banka bakiyesi yazan birimler bulundu (≥3 dosya, ≥7 birim)",
      new Set(writers.map((u) => u.file)).size >= 3 && writers.length >= 7,
      `${writers.length} birim: ${writers.map((u) => `${u.file}#${u.name}`).join(", ")}`,
    );
    const unguardedForward = forward.filter((u) => !u.guards && !(`${u.file}#${u.name}` in EXEMPT_FORWARD));
    check(
      "§9b ⭐ İLERİ yazan HER birim assertCashBalanceCoversTx çağırıyor (yeni yazar guard'sız doğamaz)",
      unguardedForward.length === 0,
      unguardedForward.length === 0
        ? "hepsi bağlı"
        : `BAĞLANMAMIŞ: ${unguardedForward.map((u) => `${u.file}#${u.name}`).join(", ")} — bakiye yazımından ÖNCE aynı tx'te çağır (banka/giriş muafsa EXEMPT_FORWARD'a gerekçeyle yaz)`,
    );
    const guardedReverse = reverse.filter((u) => u.guards);
    check(
      "§9c ⭐ TERS yol (storno/iptal) guard'SIZ — §4 muafiyetinin mekanik ikizi",
      reverse.length >= 3 && guardedReverse.length === 0,
      guardedReverse.length > 0
        ? `guard EKLENMİŞ: ${guardedReverse.map((u) => `${u.file}#${u.name}`).join(", ")} — para gerçeği ekran kuralından önce gelir`
        : `ters yol=${reverse.map((u) => u.name).join(",")}`,
    );
    const staleExempt = Object.keys(EXEMPT_FORWARD).filter((key) => {
      const u = writers.find((w) => `${w.file}#${w.name}` === key);
      return !u || u.guards || isReverse(u);
    });
    check(
      "§9d Muaf listesi bayat değil (birim var + hâlâ ileri + hâlâ guard'sız)",
      staleExempt.length === 0,
      staleExempt.join(",") || `muaf=${Object.keys(EXEMPT_FORWARD).join(",")}`,
    );
  }

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
          await prisma.cashTransaction.deleteMany({ where: { paymentId: { in: allPayIds } } }); // tek yazar: ödeme satırı FK RESTRICT
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
