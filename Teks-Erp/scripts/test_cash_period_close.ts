// =============================================================================
// BEKÇİ — KASA/BANKA DÖNEM KAPANIŞI (K-1): fotoğraf · kilit · reopen · XOR
// =============================================================================
// Çalıştırma: npx tsx scripts/test_cash_period_close.ts
//
// NEDEN VAR: Kasa dönem kapanışı "yazdırılmış kasa defteri bir daha değişmez"
// sözüdür ve `test_period_close`ün (cari) HESAP-bazlı ikizidir. Buradaki ek
// tuzaklar:
//   1. Fotoğrafın kaynağı TEK tablo değil ÜÇ YAZAR (payments ·
//      cash_transactions · cheque_events COLLECT/PAY/COLLECT_CANCEL) — bir
//      kolun sessizce düşmesi rakamı değiştirir ama hata üretmez.
//   2. Boyut HESAP (kasa XOR banka) — yanlış kolona süzmek ya da XOR'u
//      kaçırmak iki hesabın defterini birbirine karıştırır.
//   3. Kilit uzayı 8028, cari 8026'dan AYRI olmalı.
//
// ÖLÇÜLENLER:
//   §1 ⭐ Fotoğraf ÜÇ yazardan doğru — CANCELLED dışarıda, gün sınırı fabrika
//      takviminde, kapanış hiçbir deftere satır yazmaz; SINIR ANI (yerel
//      23:30 / 00:30) doğru güne çözülür — preview VE close yolunda
//   §2 ⭐ Kapalı döneme yazma 409 (helper DOĞRUDAN — yazar dikişini §9 tarar);
//      hesap bazlılık; XOR girdisi; ÇOĞUL helper
//   §3 Gelecek dönem 400 · aynı dönem 409 · geriye kapanış 409
//   §4 ⭐ Reopen: gerekçe · LIFO · satır silinmez · atomik claim · yeniden
//      kapatma (partial unique ×2 ispatı)
//   §5 ⭐ Verify: guard'ı atlayan yazım drift olarak GÖRÜNÜR (salt okuma) —
//      ÜÇ yazarın HER BİRİNDEN ayrı ayrı (yeniden türetim üç kolu da okur)
//   §6 ⭐ XOR CHECK — DB seddi (`cash_period_close_account_xor`): servis
//      atlansa bile satırın kendisi direnir
//   §7 ⭐ EŞZAMANLILIK: kapanış ile kasa yazımı serileşir (advisory lock) —
//      NEGATİF SONDA HEDEFİ: close()'daki kilit satırı silinirse 7c kırmızı
//   §8 Saf katman: kilit uzayları ayrık · kesim anı sözleşmesi
//   §9 ⭐ KABLOLAMA: bakiye yazan her servis guard'ı çağırıyor (AST, rekürsif)
//   §10 ⭐ KİLİT SIRASI: tek fonksiyon gövdesinde ≥2 ELLE tekil cash-guard
//      çağrısı YASAK (Sınıf 3 — sırasız çift kilit ayna çiftte deadlock;
//      çok hesap = ÇOĞUL helper). ⚠️ Bilinen statik sınır: döngü içinden tek
//      çağrı noktasıyla N kilit almayı AST göremez.
//   §11 ⭐ ÜRETİM YOLU (K5 kasa yarısı): kasa defteri DEVRİ mühürden okunur —
//      guard-atlatan sızıntı devri DEĞİŞTİRMEZ, storedDiff'te GÖRÜNÜR;
//      pencere üç yazardan + zaman-çıpalı (dönem içinde iptal edilen pencere
//      belgesi devirde durur). Negatif sonda 2026-08-14: cash-book.report'taki
//      mühür override'ı körleştirildi → TAM 3 kırmızı ölçüldü (§11b devir ·
//      §11d kapanış · §11e storedDiff 0'a düştü — yani sızıntı da görünmez
//      olurdu); §11f yeşil kaldı (resolver'ı doğrudan ölçer, rapor bağını
//      değil — bu yüzden §11b silinemez). cp yedeği shasum ile BİREBİR geri
//      yüklendi (dosya değiştirilmiş/izlenen — git checkout değil).
//   §12 ⭐ MÜHÜRSÜZ PARİTE: kapanış yokken rapor CTE'si ile resolver'ın düz
//      yolu AYNI sayı; mühür izi (sealedThrough/not) basılmaz.
//
// KÖRLÜK ZEMİNİ: §0 fixture sayımı — üç yazar tablosunun ÜÇÜ de fixture'da
// temsil edilmeden fotoğraf kontrolleri koşmaz ("hiçbir şey ölçülmedi" ile
// "her şey doğru" aynı yeşile çıkamaz).
// =============================================================================
import { Prisma, PaymentDirection, PaymentStatus, CashTxnKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { cashPeriodCloseService } from "../src/services/cash-period-close.service";
import { getCashBookReport } from "../src/services/reports/cash-book.report";
import {
  assertCashPeriodOpenTx,
  assertCashPeriodsOpenTx,
  CashAccountRef,
  CASH_PERIOD_CLOSE_LOCK_NS,
} from "../src/services/helpers/cash-period-guard.helper";
import { PERIOD_CLOSE_LOCK_NS, periodEndCutExclusive } from "../src/services/helpers/period-guard.helper";
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

const TAG = `TCPC${Date.now()}`; // docNo VarChar(32) sınırı — kısa tut
const boxIds: string[] = [];
const bankIds: string[] = [];
const chequeIds: string[] = [];
const cariIds: string[] = [];
const customerIds: string[] = [];
let seq = 0;

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message || "(mesajsız hata)";
  }
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

async function makeCari(): Promise<string> {
  const c = await prisma.customer.create({
    data: { code: `${TAG}-C`, name: `${TAG} müşteri` },
    select: { id: true },
  });
  customerIds.push(c.id);
  const cari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: c.id },
    select: { id: true },
  });
  cariIds.push(cari.id);
  return cari.id;
}

/** Hesap bakiyesini fixture yazımlarıyla senkron tut — `test_consistency`
 *  §23/§24 mutabakatı fixture yaşarken kırmızı olmasın (cari bekçisi emsali). */
async function bumpBalance(ref: CashAccountRef, delta: Prisma.Decimal): Promise<void> {
  if (ref.cashBoxId) {
    await prisma.cashBox.update({ where: { id: ref.cashBoxId }, data: { balance: { increment: delta } } });
  } else if (ref.bankAccountId) {
    await prisma.bankAccount.update({ where: { id: ref.bankAccountId }, data: { balance: { increment: delta } } });
  }
}

/** YAZAR 1 — Payment satırı, GUARD'SIZ (fixture + §5 sızıntı simülasyonu). */
async function payRow(
  ref: CashAccountRef,
  cariId: string,
  direction: PaymentDirection,
  amount: number,
  date: Date,
  status: PaymentStatus = PaymentStatus.ACTIVE,
): Promise<void> {
  await prisma.payment.create({
    data: {
      docNo: `${TAG}-P${++seq}`,
      direction,
      method: "CASH",
      status,
      cariId,
      currency: "TRY",
      exchangeRate: D(1),
      amount: D(amount),
      amountTry: D(amount),
      cashBoxId: ref.cashBoxId ?? null,
      bankAccountId: ref.bankAccountId ?? null,
      paymentDate: date,
      ...(status === PaymentStatus.CANCELLED ? { cancelledAt: new Date() } : {}),
    },
  });
  if (status === PaymentStatus.ACTIVE) {
    await bumpBalance(ref, direction === PaymentDirection.IN ? D(amount) : D(amount).negated());
  }
}

/** YAZAR 2 — CashTransaction satırı, GUARD'SIZ. */
async function cashRow(
  ref: CashAccountRef,
  kind: Extract<CashTxnKind, "EXPENSE" | "INCOME">,
  amount: number,
  date: Date,
): Promise<void> {
  const direction = kind === CashTxnKind.EXPENSE ? PaymentDirection.OUT : PaymentDirection.IN;
  await prisma.cashTransaction.create({
    data: {
      docNo: `${TAG}-K${++seq}`,
      kind,
      direction,
      cashBoxId: ref.cashBoxId ?? null,
      bankAccountId: ref.bankAccountId ?? null,
      currency: "TRY",
      exchangeRate: D(1),
      amount: D(amount),
      amountTry: D(amount),
      txnDate: date,
    },
  });
  await bumpBalance(ref, direction === PaymentDirection.IN ? D(amount) : D(amount).negated());
}

/** YAZAR 3 — Çek + COLLECT/PAY olay satırı, GUARD'SIZ. */
async function chequeRow(
  ref: CashAccountRef,
  cariId: string,
  type: "COLLECT" | "PAY",
  amount: number,
  date: Date,
): Promise<void> {
  const ch = await prisma.cheque.create({
    data: {
      docNo: `${TAG}-Q${++seq}`,
      kind: type === "COLLECT" ? "RECEIVED" : "ISSUED",
      status: type === "COLLECT" ? "COLLECTED" : "PAID",
      cariId,
      currency: "TRY",
      exchangeRate: D(1),
      amount: D(amount),
      amountTry: D(amount),
      issueDate: date,
      postingDate: date,
      dueDate: date,
    },
    select: { id: true },
  });
  chequeIds.push(ch.id);
  await prisma.chequeEvent.create({
    data: {
      chequeId: ch.id,
      type,
      fromStatus: type === "COLLECT" ? "PORTFOLIO" : "ISSUED",
      toStatus: type === "COLLECT" ? "COLLECTED" : "PAID",
      eventDate: date,
      cashBoxId: ref.cashBoxId ?? null,
      bankAccountId: ref.bankAccountId ?? null,
    },
  });
  await bumpBalance(ref, type === "COLLECT" ? D(amount) : D(amount).negated());
}

/** GUARD'LI yazım — dikilecek üç yazarın uyması gereken sözleşmenin birebir
 *  simülasyonu: guard AYNI tx'te, satır yazılmadan ÖNCE. */
async function guardedCashWrite(ref: CashAccountRef, amount: number, date: Date): Promise<string> {
  const docNo = `${TAG}-G${++seq}`;
  await prisma.$transaction(async (tx) => {
    await assertCashPeriodOpenTx(tx, { ...ref, txnDate: date });
    await tx.cashTransaction.create({
      data: {
        docNo,
        kind: CashTxnKind.INCOME,
        direction: PaymentDirection.IN,
        cashBoxId: ref.cashBoxId ?? null,
        bankAccountId: ref.bankAccountId ?? null,
        currency: "TRY",
        exchangeRate: D(1),
        amount: D(amount),
        amountTry: D(amount),
        txnDate: date,
      },
    });
    if (ref.cashBoxId) {
      await tx.cashBox.update({ where: { id: ref.cashBoxId }, data: { balance: { increment: D(amount) } } });
    } else if (ref.bankAccountId) {
      await tx.bankAccount.update({ where: { id: ref.bankAccountId }, data: { balance: { increment: D(amount) } } });
    }
  });
  return docNo;
}

/** Üç yazar tablosundaki toplam satır sayısı — "kapanış satır yazmadı" kanıtı. */
async function movementRowCount(): Promise<number> {
  const [p, k, e] = await Promise.all([
    prisma.payment.count({ where: { docNo: { startsWith: TAG } } }),
    prisma.cashTransaction.count({ where: { docNo: { startsWith: TAG } } }),
    prisma.chequeEvent.count({ where: { chequeId: { in: chequeIds.length > 0 ? chequeIds : ["00000000-0000-0000-0000-000000000000"] } } }),
  ]);
  return p + k + e;
}

// ── SABİT TARİHLER (test_period_close ile AYNI sözleşme) ────────────────────
// Türkiye kalıcı UTC+3 (yaz saati YOK) → yerel duvar saati = UTC + 3.
const PERIOD_END = new Date(Date.UTC(2026, 2, 31)); // 31.03.2026 (gün anahtarı)
const T_INSIDE = new Date("2026-03-15T10:00:00Z"); // dönem içi
const T_EDGE_IN = new Date("2026-03-31T20:30:00Z"); // yerel 31.03 23:30 → İÇERİDE
const T_EDGE_OUT = new Date("2026-03-31T21:30:00Z"); // yerel 01.04 00:30 → DIŞARIDA

async function main(): Promise<void> {
  console.log("=== Kasa/banka dönem kapanışı bekçisi ===\n");

  const cariId = await makeCari();
  const boxA = await makeBox("A");
  const boxB = await makeBox("B");
  const bank = await makeBank("BNK");
  const refA: CashAccountRef = { cashBoxId: boxA };
  const refB: CashAccountRef = { cashBoxId: boxB };
  const refBank: CashAccountRef = { bankAccountId: bank };

  // ── §0 FOTOĞRAF FIXTURE'I — ÜÇ YAZAR, ayırt edici tutarlarla ──────────────
  // Her kolun düşüşü rakamı FARKLI değiştirir: payments kolu düşerse −700,
  // cash kolu düşerse +200, çek kolu düşerse −350 → hangi kol öldü, sayıdan okunur.
  await payRow(refA, cariId, PaymentDirection.IN, 1000, T_INSIDE);
  await payRow(refA, cariId, PaymentDirection.OUT, 300, T_INSIDE);
  await payRow(refA, cariId, PaymentDirection.IN, 999, T_INSIDE, PaymentStatus.CANCELLED); // dışarıda kalmalı
  await cashRow(refA, CashTxnKind.EXPENSE, 200, T_EDGE_IN); // sınır İÇİ
  await chequeRow(refA, cariId, "COLLECT", 500, T_INSIDE);
  await chequeRow(refA, cariId, "PAY", 150, T_INSIDE); // elden ödeme — kasa meşru
  await cashRow(refA, CashTxnKind.INCOME, 700, T_EDGE_OUT); // sınır DIŞI
  await payRow(refBank, cariId, PaymentDirection.IN, 100, T_INSIDE); // başka HESAP

  // KÖRLÜK ZEMİNİ: üç yazar tablosunun üçü de kesim ANI İÇİNDE satır taşımalı —
  // taşımasaydı aşağıdaki fotoğraf kontrolleri o kolu hiç ölçmezdi.
  const cut = periodEndCutExclusive(PERIOD_END);
  const [zP, zK, zE] = await Promise.all([
    prisma.payment.count({ where: { cashBoxId: boxA, status: PaymentStatus.ACTIVE, paymentDate: { lt: cut } } }),
    prisma.cashTransaction.count({ where: { cashBoxId: boxA, txnDate: { lt: cut } } }),
    prisma.chequeEvent.count({ where: { cashBoxId: boxA, eventDate: { lt: cut } } }),
  ]);
  check(
    "§0 Körlük zemini: ÜÇ yazar da fixture'da temsil ediliyor",
    zP >= 1 && zK >= 1 && zE >= 1,
    `payments=${zP} cash=${zK} chequeEvents=${zE}`,
  );

  // ── §1 KAPANIŞ FOTOĞRAFI ──────────────────────────────────────────────────
  const prev = await cashPeriodCloseService.preview({ cashBoxId: boxA, periodEnd: PERIOD_END });
  check(
    "§1a ⭐ Önizleme ÜÇ YAZARI birlikte ölçtü (1000−300−200+500−150 = 850)",
    D(prev.data.closingBalance).equals(850),
    `bakiye=${prev.data.closingBalance}`,
  );
  check(
    "§1b ⭐ CANCELLED hareket fotoğrafa GİRMEDİ + gün sınırı FABRİKA takviminde (5 hareket)",
    prev.data.txnCount === 5,
    `txnCount=${prev.data.txnCount} (UTC kesimde 6, CANCELLED sayılsa 6 olurdu)`,
  );
  check(
    "§1c Kesim anı ertesi günün fabrika 00:00'ı",
    prev.data.cut.toISOString() === "2026-03-31T21:00:00.000Z",
    prev.data.cut.toISOString(),
  );
  check(
    "§1d Giren/çıkan ayrımı doğru (1500 / 650)",
    D(prev.data.totalIn).equals(1500) && D(prev.data.totalOut).equals(650),
    `giren=${prev.data.totalIn} çıkan=${prev.data.totalOut}`,
  );
  check("§1e Önizleme henüz kapanış YOK diyor", prev.data.alreadyClosed === false && prev.data.blockingClose === null);

  const rowsBefore = await movementRowCount();
  const closeA = await cashPeriodCloseService.close({ cashBoxId: boxA, periodEnd: PERIOD_END });
  check(
    "§1f Kapanış önizlemeyle BİREBİR aynı rakamı sakladı",
    D(closeA.data.closingBalance).equals(850) && closeA.data.txnCount === 5,
    `${closeA.data.closingBalance} / ${closeA.data.txnCount}`,
  );
  check("§1g ⭐ Kapanış HİÇBİR deftere satır YAZMADI (fotoğraf, hareket değil)", (await movementRowCount()) === rowsBefore);
  check(
    "§1h Kapanış günü `@db.Date` anahtarı olarak saklandı",
    closeA.data.periodEnd.toISOString() === "2026-03-31T00:00:00.000Z",
    closeA.data.periodEnd.toISOString(),
  );

  // SINIR ANI → GÜN ANAHTARI (rota ISO AN da kabul eder; servis `periodDayKey`
  // ile fabrika gününe çevirir). Yerel 23:30 aynı güne, yerel 00:30 ertesi
  // güne çözülmeli — gün UTC'de kesilseydi ikisi de 31.03'e düşer ve sınır
  // gecesi verilen kapanış yanlış dönemi mühürlerdi. NEGATİF SONDA HEDEFİ:
  // preview'daki `periodDayKey` UTC kesime çevrilirse §1j kırmızı.
  const prevSameDay = await cashPeriodCloseService.preview({ cashBoxId: boxA, periodEnd: T_EDGE_IN });
  const prevNextDay = await cashPeriodCloseService.preview({ cashBoxId: boxA, periodEnd: T_EDGE_OUT });
  check(
    "§1i ⭐ SINIR ANI: yerel 23:30 anı gün anahtarıyla AYNI döneme çözülür (fotoğraf birebir)",
    prevSameDay.data.periodEnd.toISOString() === "2026-03-31T00:00:00.000Z" &&
      D(prevSameDay.data.closingBalance).equals(850) &&
      prevSameDay.data.txnCount === 5,
    `periodEnd=${prevSameDay.data.periodEnd.toISOString()} bakiye=${prevSameDay.data.closingBalance}`,
  );
  check(
    "§1j ⭐ SINIR ANI: yerel 00:30 anı ERTESİ güne çözülür (sınır-dışı satır artık içeride: 1550 / 6)",
    prevNextDay.data.periodEnd.toISOString() === "2026-04-01T00:00:00.000Z" &&
      D(prevNextDay.data.closingBalance).equals(1550) &&
      prevNextDay.data.txnCount === 6,
    `periodEnd=${prevNextDay.data.periodEnd.toISOString()} bakiye=${prevNextDay.data.closingBalance}`,
  );
  const errCloseInstant = await expectError(() =>
    cashPeriodCloseService.close({ cashBoxId: boxA, periodEnd: T_EDGE_IN }),
  );
  check(
    "§1k KAPANIŞ yolu da anı gün anahtarına çevirir — sınır anıyla ikinci kapanış 'zaten kapalı'",
    /zaten kapalı/i.test(errCloseInstant),
    errCloseInstant.slice(0, 80),
  );

  // ── §2 KAPALI DÖNEME YAZMA KİLİTLİ (helper DOĞRUDAN — dikiş henüz yok) ────
  const errInside = await expectError(() => guardedCashWrite(refA, 50, T_INSIDE));
  check("§2a ⭐ Kapalı döneme kasa yazımı REDDEDİLDİ", /KAPALI dönemine/i.test(errInside), errInside.slice(0, 90));
  check(
    "§2b Mesaj iki tarihi de söylüyor ve YOL GÖSTERİYOR (çıkmaz 409 değil)",
    /15\.03\.2026/.test(errInside) &&
      /31\.03\.2026/.test(errInside) &&
      /bugüne tarihleyin/i.test(errInside) &&
      /yeniden açın/i.test(errInside),
  );

  const errEdge = await expectError(() => guardedCashWrite(refA, 50, T_EDGE_IN));
  check("§2c ⭐ SINIR: kapanış gününün yerel 23:30'u da KAPALI", /KAPALI dönemine/i.test(errEdge));

  const gOut = await guardedCashWrite(refA, 5, T_EDGE_OUT);
  check(
    "§2d ⭐ SINIR: ertesi günün yerel 00:30'u SERBEST (UTC kesim bloklardı)",
    (await prisma.cashTransaction.count({ where: { docNo: gOut } })) === 1,
  );

  await guardedCashWrite(refBank, 10, T_INSIDE);
  check(
    "§2e ⭐ Kapanış HESAP bazında — banka hesabı etkilenmedi",
    (await prisma.cashTransaction.count({ where: { bankAccountId: bank } })) === 1,
  );
  await guardedCashWrite(refB, 10, T_INSIDE);
  check(
    "§2f Kapanış HESAP bazında — ikinci kasa etkilenmedi",
    (await prisma.cashTransaction.count({ where: { cashBoxId: boxB } })) === 1,
  );

  const errBoth = await expectError(() =>
    prisma.$transaction((tx) => assertCashPeriodOpenTx(tx, { cashBoxId: boxA, bankAccountId: bank, txnDate: T_INSIDE })),
  );
  const errNone = await expectError(() => prisma.$transaction((tx) => assertCashPeriodOpenTx(tx, { txnDate: T_INSIDE })));
  check(
    "§2g XOR girdisi: ikisi birden / hiçbiri → anlamlı 400",
    /ikisi birden değil/i.test(errBoth) && /ikisi birden değil/i.test(errNone),
    errBoth.slice(0, 60),
  );

  // ÇOĞUL helper — virman gibi çok hesaplı yazarın kapısı (deterministik sıra).
  const errPlural = await expectError(() =>
    prisma.$transaction((tx) =>
      assertCashPeriodsOpenTx(tx, [
        { bankAccountId: bank, txnDate: T_INSIDE },
        { cashBoxId: boxA, txnDate: T_INSIDE }, // kapalı üye
      ]),
    ),
  );
  check("§2h ⭐ ÇOĞUL guard kapalı üyeyi yakalıyor", /KAPALI dönemine/i.test(errPlural), errPlural.slice(0, 80));
  const errPluralOpen = await expectError(() =>
    prisma.$transaction((tx) =>
      assertCashPeriodsOpenTx(tx, [
        { bankAccountId: bank, txnDate: T_INSIDE },
        { cashBoxId: boxB, txnDate: T_INSIDE },
      ]),
    ),
  );
  check("§2i ÇOĞUL guard açık hesaplarda sessiz geçiyor", errPluralOpen === "");

  // ── §3 GELECEK + SIRALILIK ────────────────────────────────────────────────
  const future = new Date(Date.now() + 5 * 86_400_000);
  const errFuture = await expectError(() => cashPeriodCloseService.close({ cashBoxId: boxA, periodEnd: future }));
  check("§3a Gelecek dönem kapatılamaz", /Gelecek bir dönem/i.test(errFuture), errFuture.slice(0, 70));

  const errSame = await expectError(() => cashPeriodCloseService.close({ cashBoxId: boxA, periodEnd: PERIOD_END }));
  check("§3b Aynı dönem ikinci kez kapatılamaz", /zaten kapalı/i.test(errSame), errSame.slice(0, 90));

  const errBack = await expectError(() =>
    cashPeriodCloseService.close({ cashBoxId: boxA, periodEnd: new Date(Date.UTC(2026, 1, 28)) }),
  );
  check("§3c Daha ileri kapanış varken geriye kapanış yapılamaz", /ileri bir kapanış/i.test(errBack), errBack.slice(0, 90));

  // ── §4 YENİDEN AÇMA (banka hesabında) ─────────────────────────────────────
  await payRow(refBank, cariId, PaymentDirection.IN, 200, new Date("2026-02-10T09:00:00Z"));
  await payRow(refBank, cariId, PaymentDirection.IN, 300, new Date("2026-04-10T09:00:00Z"));
  const feb = await cashPeriodCloseService.close({ bankAccountId: bank, periodEnd: new Date(Date.UTC(2026, 1, 28)) });
  const apr = await cashPeriodCloseService.close({ bankAccountId: bank, periodEnd: new Date(Date.UTC(2026, 3, 30)) });
  check(
    "§4a Sıralı iki kapanış kuruldu (şubat 200 · nisan 200+100+10+300 = 610)",
    D(feb.data.closingBalance).equals(200) && D(apr.data.closingBalance).equals(610),
    `feb=${feb.data.closingBalance} apr=${apr.data.closingBalance}`,
  );

  const errNoReason = await expectError(() => cashPeriodCloseService.reopen(apr.data.id, "  "));
  check("§4b Gerekçesiz yeniden açma REDDEDİLDİ", /gerekçesi zorunlu/i.test(errNoReason), errNoReason.slice(0, 70));

  const errLifo = await expectError(() => cashPeriodCloseService.reopen(feb.data.id, "bekçi denemesi"));
  check(
    "§4c ⭐ LIFO: daha yeni kapanış dururken eski dönem açılamaz",
    /Önce daha yeni kapanışı/i.test(errLifo) && /30\.04\.2026/.test(errLifo),
    errLifo.slice(0, 80),
  );

  await cashPeriodCloseService.reopen(apr.data.id, "bekçi: nisan düzeltmesi");
  const aprRow = await prisma.cashPeriodClose.findUnique({
    where: { id: apr.data.id },
    select: { reopenedAt: true, reopenReason: true, closingBalance: true },
  });
  check(
    "§4d ⭐ Reopen satırı SİLMEDİ, İŞARETLEDİ (fotoğraf ve gerekçe duruyor)",
    aprRow != null &&
      aprRow.reopenedAt != null &&
      aprRow.reopenReason === "bekçi: nisan düzeltmesi" &&
      D(aprRow.closingBalance).equals(610),
  );

  const errTwice = await expectError(() => cashPeriodCloseService.reopen(apr.data.id, "ikinci kez"));
  check("§4e Aynı kapanış ikinci kez açılamaz (atomik claim)", /zaten yeniden açılmış/i.test(errTwice), errTwice.slice(0, 70));

  const errStillFeb = await expectError(() => guardedCashWrite(refBank, 1, new Date("2026-02-20T09:00:00Z")));
  check("§4f Nisan açıldı ama ŞUBAT kapalı → şubata yazma hâlâ 409", /KAPALI dönemine/i.test(errStillFeb));
  await guardedCashWrite(refBank, 7, new Date("2026-04-20T09:00:00Z"));
  check(
    "§4g ⭐ REOPEN SONRASI o döneme yazma SERBEST",
    (await prisma.cashTransaction.count({ where: { bankAccountId: bank } })) === 2,
  );

  await cashPeriodCloseService.reopen(feb.data.id, "bekçi: şubat düzeltmesi");
  await guardedCashWrite(refBank, 3, new Date("2026-02-20T09:00:00Z"));
  const reFeb = await cashPeriodCloseService.close({ bankAccountId: bank, periodEnd: new Date(Date.UTC(2026, 1, 28)) });
  check(
    "§4h ⭐ Yeniden açılan dönem TEKRAR kapatılabildi (partial unique ispatı — düz unique olsaydı P2002)",
    D(reFeb.data.closingBalance).equals(203),
    `bakiye=${reFeb.data.closingBalance}`,
  );

  // ── §5 VERIFY: GUARD'I ATLAYAN YAZAR GÖRÜNÜR OLUR ─────────────────────────
  const okVerify = await cashPeriodCloseService.verify(closeA.data.id);
  check("§5a Sağlam kapanışta drift YOK", okVerify.data.drift === false, `Δ=${okVerify.data.balanceDelta}`);

  // `cashRow` guard'sız yazar — "bir gün biri guard'ı atlarsa" senaryosu.
  // (Aynı sınıfın ikinci üyesi İPTAL: kapalı dönemdeki Payment/CashTransaction
  // CANCELLED'a çekilirse toplamdan geriye dönük düşer — dikişte iptal yolları
  // bu yüzden ORİJİNAL tarihle guard'lanmalı; helper başlığında yazılı.)
  await cashRow(refA, CashTxnKind.INCOME, 999, T_INSIDE);
  const drifted = await cashPeriodCloseService.verify(closeA.data.id);
  check(
    "§5b ⭐ Guard'ı atlayan yazım DRIFT olarak görünür (sessiz kalmaz)",
    drifted.data.drift === true && D(drifted.data.balanceDelta).equals(999) && drifted.data.countDelta === 1,
    `Δbakiye=${drifted.data.balanceDelta} Δadet=${drifted.data.countDelta}`,
  );
  check(
    "§5c Verify SALT OKUMA — saklanan fotoğrafı düzeltmedi",
    D(
      (
        await prisma.cashPeriodClose.findUniqueOrThrow({
          where: { id: closeA.data.id },
          select: { closingBalance: true },
        })
      ).closingBalance,
    ).equals(850),
  );

  // ÜÇ YAZARIN HER BİRİNDEN sızıntı AYRI AYRI görünmeli: §5b yalnız yazar-2'yi
  // (cash_transactions) ölçüyordu; verify'ın yeniden türetimi tek kolu okusaydı
  // diğer iki yazarın drift'i sonsuza dek sessiz kalırdı. (§1a fotoğrafın üç
  // kolunu KAPANIŞ anında ölçer; burası aynı üç kolun VERIFY yolunda da canlı
  // olduğunun kanıtı.) NEGATİF SONDA HEDEFLERİ: measureTx'in payments kolu
  // körleşirse §5d, cheque_events kolu körleşirse §5e kırmızı verir.
  await payRow(refA, cariId, PaymentDirection.OUT, 100, T_INSIDE); // yazar-1 sızıntısı
  const driftedPay = await cashPeriodCloseService.verify(closeA.data.id);
  check(
    "§5d ⭐ YAZAR-1 (payments) sızıntısı da drift olarak görünür (999−100 = 899 / 2)",
    driftedPay.data.drift === true && D(driftedPay.data.balanceDelta).equals(899) && driftedPay.data.countDelta === 2,
    `Δbakiye=${driftedPay.data.balanceDelta} Δadet=${driftedPay.data.countDelta}`,
  );
  await chequeRow(refA, cariId, "COLLECT", 50, T_INSIDE); // yazar-3 sızıntısı
  const driftedChq = await cashPeriodCloseService.verify(closeA.data.id);
  check(
    "§5e ⭐ YAZAR-3 (cheque_events) sızıntısı da drift olarak görünür (899+50 = 949 / 3)",
    driftedChq.data.drift === true && D(driftedChq.data.balanceDelta).equals(949) && driftedChq.data.countDelta === 3,
    `Δbakiye=${driftedChq.data.balanceDelta} Δadet=${driftedChq.data.countDelta}`,
  );

  // ── §6 XOR — SERVİS 400 + DB CHECK SEDDİ ──────────────────────────────────
  const errSvcBoth = await expectError(() =>
    cashPeriodCloseService.close({ cashBoxId: boxB, bankAccountId: bank, periodEnd: new Date(Date.UTC(2026, 0, 31)) }),
  );
  const errSvcNone = await expectError(() => cashPeriodCloseService.close({ periodEnd: new Date(Date.UTC(2026, 0, 31)) }));
  check(
    "§6a Servis XOR'u anlamlı 400 ile reddediyor",
    /ikisi birden değil/i.test(errSvcBoth) && /ikisi birden değil/i.test(errSvcNone),
    errSvcBoth.slice(0, 60),
  );

  const xorDay = new Date(Date.UTC(2026, 0, 31));
  const errDbBoth = await expectError(() =>
    prisma.cashPeriodClose.create({
      data: { cashBoxId: boxB, bankAccountId: bank, periodEnd: xorDay, closingBalance: D(0), txnCount: 0 },
    }),
  );
  const errDbNone = await expectError(() =>
    prisma.cashPeriodClose.create({
      data: { periodEnd: xorDay, closingBalance: D(0), txnCount: 0 },
    }),
  );
  const xorRows = await prisma.cashPeriodClose.count({ where: { periodEnd: xorDay } });
  check(
    "§6b ⭐ DB SEDDİ: XOR CHECK servis atlanınca da direniyor (ikisi birden / hiçbiri → red, satır yok)",
    errDbBoth !== "" && errDbNone !== "" && xorRows === 0,
    `both="${errDbBoth.slice(0, 50)}" rows=${xorRows}`,
  );

  // ── §7 EŞZAMANLILIK: KAPANIŞ ↔ KASA YAZIMI SERİLEŞİR ─────────────────────
  // Yarışın kendisi: yazar guard'ı geçti ama HENÜZ COMMIT ETMEDİ; tam o anda
  // kapanış ölçüm yapıyor. Advisory kilit olmasaydı kapanış o satırı SAYMAZ ve
  // fotoğraf, kapalı dönemde duran bir hareketi dışarıda bırakırdı.
  // ⚠️ NEGATİF SONDA HEDEFİ: close()'daki `lockCashPeriodScopeTx` satırı
  // silinirse §7c kırmızı verir (100/1 ölçülür).
  const boxC = await makeBox("C");
  const refC: CashAccountRef = { cashBoxId: boxC };
  await cashRow(refC, CashTxnKind.INCOME, 100, new Date("2026-03-01T09:00:00Z"));

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const writer = prisma.$transaction(
    async (tx) => {
      await assertCashPeriodOpenTx(tx, { cashBoxId: boxC, txnDate: T_INSIDE });
      // ⚠️ Tx içinde bekleme NORMALDE YASAK (perf kuralı 10); yarış penceresini
      // DETERMİNİSTİK açmanın tek yolu bu ve yalnız bekçide.
      await sleep(500);
      await tx.cashTransaction.create({
        data: {
          docNo: `${TAG}-G${++seq}`,
          kind: CashTxnKind.INCOME,
          direction: PaymentDirection.IN,
          cashBoxId: boxC,
          currency: "TRY",
          exchangeRate: D(1),
          amount: D(50),
          amountTry: D(50),
          txnDate: T_INSIDE,
        },
      });
      await tx.cashBox.update({ where: { id: boxC }, data: { balance: { increment: D(50) } } });
      return "written";
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
  const closer = (async () => {
    await sleep(120); // yazar kilidi ALDIKTAN sonra kapanışı başlat
    return cashPeriodCloseService.close({ cashBoxId: boxC, periodEnd: PERIOD_END });
  })();
  const [wRes, cRes] = await Promise.allSettled([writer, closer]);

  check("§7a Yazar (kilidi önce alan) tamamlandı", wRes.status === "fulfilled", String(wRes.status === "rejected" ? wRes.reason : wRes.status));
  check("§7b Kapanış tamamlandı", cRes.status === "fulfilled", String(cRes.status === "rejected" ? cRes.reason : cRes.status));
  if (cRes.status === "fulfilled") {
    check(
      "§7c ⭐ Kapanış, yarıştaki satırı SAYDI (150 / 2) — kilit olmasaydı 100 / 1 olurdu",
      D(cRes.value.data.closingBalance).equals(150) && cRes.value.data.txnCount === 2,
      `bakiye=${cRes.value.data.closingBalance} adet=${cRes.value.data.txnCount}`,
    );
    const vC = await cashPeriodCloseService.verify(cRes.value.data.id);
    check("§7d Yarış sonrası fotoğraf ile defter MUTABIK", vC.data.drift === false, `Δ=${vC.data.balanceDelta}`);
  } else {
    check("§7c ⭐ Kapanış, yarıştaki satırı SAYDI", false, String(cRes.reason));
    check("§7d Yarış sonrası fotoğraf ile defter MUTABIK", false, "kapanış koşmadı");
  }

  // ── §8 SAF KATMAN SÖZLEŞMELERİ ────────────────────────────────────────────
  check(
    "§8a ⭐ Kilit uzayları AYRIK: kasa (8028) ≠ cari (8026) — aynı uzay iki alt sistemi sessizce serileştirirdi",
    CASH_PERIOD_CLOSE_LOCK_NS !== PERIOD_CLOSE_LOCK_NS && CASH_PERIOD_CLOSE_LOCK_NS === 8028,
    `kasa=${CASH_PERIOD_CLOSE_LOCK_NS} cari=${PERIOD_CLOSE_LOCK_NS}`,
  );
  const st = await cashPeriodCloseService.status({ cashBoxId: boxA });
  check(
    "§8b Status rozeti en son AKTİF kapanışı söylüyor",
    st.data.closedThrough?.toISOString() === "2026-03-31T00:00:00.000Z" && D(st.data.closingBalance ?? 0).equals(850),
    `closedThrough=${st.data.closedThrough?.toISOString()}`,
  );
  const lst = await cashPeriodCloseService.list({ cashBoxId: boxA });
  check(
    "§8c Liste hesap etiketini taşıyor (ekran JOIN kurmaz)",
    lst.data.length === 1 && lst.data[0]?.accountKind === "CASH_BOX" && lst.data[0]?.accountName.includes("kasa A"),
    `satır=${lst.data.length} ad=${lst.data[0]?.accountName}`,
  );
  const errListBoth = await expectError(() => cashPeriodCloseService.list({ cashBoxId: boxA, bankAccountId: bank }));
  check("§8d Liste süzgecinde kasa+banka birlikte → 400 (sessiz boş liste değil)", /birlikte verilemez/i.test(errListBoth));

  // ── §9 ⭐ KABLOLAMA TARAMASI — guard ÜÇ YAZARA gerçekten bağlı mı ─────────
  // Yukarıdaki her şey helper'ı DOĞRUDAN çağırıyor; bu bölüm, kasa/banka
  // bakiyesine YAZAN her servis dosyasının guard'ı ÇAĞIRDIĞINI AST ile doğrular
  // (test_period_close §5b'nin kasa ikizi). Bu bölüm olmadan biri yarın bir
  // yazardan guard satırını silse HER ŞEY yeşil kalırdı — helper testi kabloyu
  // ölçmez. ⚠️ Tarama DOSYA seviyesindedir (§5b ile aynı yazılı sınır): aynı
  // dosyada guard'lı bir yol, guard'sız İKİNCİ bir yazma yolunu gizleyebilir.
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const ts = await import("typescript");
    const servicesDir = path.resolve(__dirname, "..", "src", "services");
    const scanned: Array<{ file: string; guarded: boolean }> = [];
    const scanOne = (full: string): { writes: boolean; guards: boolean } => {
      const sf = ts.createSourceFile(full, fs.readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true);
      let writes = false;
      let guards = false;
      const visit = (n: import("typescript").Node): void => {
        if (ts.isCallExpression(n)) {
          const e = n.expression;
          if (
            ts.isIdentifier(e) &&
            (e.text === "assertCashPeriodOpenTx" || e.text === "assertCashPeriodsOpenTx")
          ) {
            guards = true;
          }
          // Bakiye yazımı: `cashBox.update` / `bankAccount.update` çağrısı.
          // (`moveAccountBalance*` sarmalayıcıları da içeride bunu yapar —
          // sarmalayıcı adı değişse bile bu desen yakalar.)
          if (ts.isPropertyAccessExpression(e) && e.name.text === "update") {
            const owner = e.expression;
            if (
              ts.isPropertyAccessExpression(owner) &&
              (owner.name.text === "cashBox" || owner.name.text === "bankAccount")
            ) {
              writes = true;
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return { writes, guards };
    };
    // REKÜRSİF yürüyüş — helpers/ ve reports/ da taranır. Bugün tüm bakiye
    // yazarları üst düzeyde (moveAccountBalanceTx cheque.service İÇİNDE tanımlı)
    // ama o fonksiyon yarın bir helper dosyasına taşınırsa düz readdir taraması
    // kapsamı SESSİZCE kaybederdi — "ihlal yok" ile "bakılmadı" aynı yeşil.
    const walkTs = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walkTs(full);
        return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
      });
    const allServiceFiles = walkTs(servicesDir);
    for (const full of allServiceFiles) {
      const r = scanOne(full);
      if (!r.writes) continue;
      scanned.push({ file: path.relative(servicesDir, full), guarded: r.guards });
    }
    // Körlük zemini: TEK yazar biliniyor (2026-09-18 tek yazar dilimi: helpers/cash-ledger.helper.ts) — başka dosya
    // bakiye yazıyorsa tek yazar sözleşmesi bozulmuştur (test_cash_single_writer §0 da ölçer).
    check(
      "§9a Körlük zemini: kasa/banka bakiyesi yazan servisler bulundu (TEK yazar: cash-ledger.helper)",
      scanned.length >= 1 && scanned.every((s) => s.file.endsWith("cash-ledger.helper.ts")),
      `bulunan=${scanned.length} → ${scanned.map((s) => s.file).join(", ")}`,
    );
    const unguarded = scanned.filter((s) => !s.guarded);
    check(
      "§9b ⭐ Bakiye yazan HER servis kasa dönem guard'ını çağırıyor",
      unguarded.length === 0,
      unguarded.length === 0
        ? "hepsi bağlı"
        : `BAĞLANMAMIŞ: ${unguarded.map((s) => s.file).join(", ")} — bakiye yazımından ÖNCE, AYNI tx'te ` +
          `assertCashPeriodOpenTx (tek hesap) ya da assertCashPeriodsOpenTx (çok hesap) çağır`,
    );

    // ── §10 KİLİT SIRASI — tek fonksiyon gövdesinde ≥2 ELLE tekil çağrı ──────
    // Sınıf 3: sırasız çift advisory kilit ayna çiftte PG deadlock (40P01)
    // üretir — `cheque.bounce`ın CARİ tarafında canlı ölçülmüştü. Çok hesaba
    // yazan tx ÇOĞUL helper'ı (assertCashPeriodsOpenTx) kullanmalı; anahtarları
    // o sıralar. Bu tarama, bir fonksiyon gövdesinde (İÇ İÇE fonksiyonlar
    // hariç — tx callback'i kendi gövdesidir) birden çok elle tekil çağrıyı
    // kırmızıya bağlar. Tasarımın (Sınıf 3, madde 4) istediği bekçi budur;
    // helper'daki yasak yalnız yorumdu ve yorum kimseyi durdurmaz.
    // ⚠️ Bilinen statik sınır (tasarımda yazılı): döngü içinden TEK çağrı
    // noktasıyla N kilit almayı AST göremez. ⚠️ Guard helper'ın kendisi MUAF:
    // çoğul helper tekil guard'ı SIRALANMIŞ anahtarlarla döngüde çağırır —
    // meşru olan tek yer.
    {
      type TsNode = import("typescript").Node;
      const isFnLike = (n: TsNode): boolean =>
        ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n);
      let singularSites = 0;
      const doubles: string[] = [];
      for (const full of allServiceFiles) {
        if (full.endsWith(`helpers${path.sep}cash-period-guard.helper.ts`)) continue; // muaf (üstte gerekçeli)
        const rel = path.relative(servicesDir, full);
        const sf = ts.createSourceFile(full, fs.readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true);
        const countOwnBody = (fn: TsNode): number => {
          let c = 0;
          const walkFn = (n: TsNode): void => {
            if (n !== fn && isFnLike(n)) return; // iç fonksiyon kendi gövdesinde sayılır
            if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "assertCashPeriodOpenTx") {
              c++;
            }
            ts.forEachChild(n, walkFn);
          };
          walkFn(fn);
          return c;
        };
        const visit = (n: TsNode): void => {
          if (isFnLike(n)) {
            const c = countOwnBody(n);
            singularSites += c;
            if (c >= 2) doubles.push(`${rel} (tek gövdede ${c} tekil çağrı)`);
          }
          ts.forEachChild(n, visit);
        };
        visit(sf);
      }
      // Körlük zemini: bugün 6 meşru tekil çağrı var (payment ×2 · cash ×1 ·
      // cheque ×3). Tarama boşa düşerse (dizin/regex değişimi) 0 bulur ve bu
      // kontrol "hiçbir şeye bakılmadı"yı yeşilden ayırır.
      check(
        "§10a Körlük zemini: elle tekil guard çağrıları bulundu",
        singularSites >= 5,
        `tekil çağrı=${singularSites}`,
      );
      check(
        "§10b ⭐ Hiçbir fonksiyon gövdesi ≥2 ELLE tekil cash-guard çağrısı taşımıyor (çok hesap = ÇOĞUL helper)",
        doubles.length === 0,
        doubles.length === 0 ? "temiz" : `İHLAL: ${doubles.join(" · ")} — assertCashPeriodsOpenTx kullan`,
      );
    }
  }

  // ── §11 ⭐ ÜRETİM YOLU: KASA DEFTERİ DEVRİ MÜHÜRDEN OKUNUR (K5 kasa yarısı) ─
  // `test_period_close` §11'in hesap-bazlı ikizi: kapanış kur → kapalı döneme
  // guard'ı ATLAYAN ham hareket enjekte et → kasa defteri raporunun deviri
  // MÜHÜRLÜ rakamda kalmalı (yeniden hesap DEĞİL) ve sızıntı `storedDiff`te
  // GÖRÜNMELİ. Pencere ÜÇ YAZARDAN da beslenir (cash + payment + cheque) ve
  // pencerede doğup rapor dönemi İÇİNDE iptal edilen belge ZAMAN-ÇIPALI sayılır
  // (aksi yürüyen bakiyeyi/storedDiff'i sahte alarma düşürürdü — servis başlığı).
  // ⚠️ NEGATİF SONDA HEDEFİ: cash-book.report'taki mühür override satırı
  // (`openingByAccount.set(a.id, resolved.opening)`) silinirse §11b kırmızı.
  const STATEMENT_FROM = new Date("2026-04-30T21:00:00Z"); // yerel 01.05.2026 00:00
  const boxD = await makeBox("D");
  const refD: CashAccountRef = { cashBoxId: boxD };
  await cashRow(refD, CashTxnKind.INCOME, 1000, T_INSIDE); // mühürlenecek
  await cashRow(refD, CashTxnKind.INCOME, 700, T_EDGE_OUT); // pencere: yazar-2
  const closeD = await cashPeriodCloseService.close({ cashBoxId: boxD, periodEnd: PERIOD_END });
  check("§11a Kapanış fixture'ı mühürledi (1000)", D(closeD.data.closingBalance).equals(1000));

  // Pencereye diğer iki yazar + rapor dönemi içinde iptal edilecek bir belge.
  await payRow(refD, cariId, PaymentDirection.IN, 60, T_EDGE_OUT); // pencere: yazar-1
  await chequeRow(refD, cariId, "COLLECT", 40, T_EDGE_OUT); // pencere: yazar-3
  // Pencerede doğdu, ŞİMDİ iptal (cancelledAt=now ≥ from): parası `from` anında
  // kasadaydı → devir +50 saymalı; ters satır rapor döneminde −50 görünür.
  await payRow(refD, cariId, PaymentDirection.IN, 50, T_EDGE_OUT, PaymentStatus.CANCELLED);
  // Guard'ı ATLAYAN sızıntı — kapalı döneme ham satır (§5'teki yol).
  await cashRow(refD, CashTxnKind.INCOME, 999, T_INSIDE);

  const bookD = await getCashBookReport({ range: { from: STATEMENT_FROM, to: new Date() }, accountId: boxD });
  const kasaD = bookD.accounts.find((a) => a.accountId === boxD);
  check("§11 Körlük zemini: mühürlü kasa raporda", Boolean(kasaD), kasaD?.opening ?? "YOK");
  if (!kasaD) throw new Error("boxD raporda yok");
  check(
    "§11b ⭐ Devir MÜHÜRLÜ rakamdan: 1000 + pencere (700+60+40+50) = 1850 — sızıntıyla YENİDEN HESAPLANMADI",
    kasaD.opening === "1850.00",
    `opening=${kasaD.opening} (düz CTE olsaydı 2849.00)`,
  );
  check(
    "§11c ⭐ Yanıt mührü söylüyor: sealedThrough=31.03.2026 + not MÜHÜRLÜ diyor",
    kasaD.sealedThrough === "2026-03-31T00:00:00.000Z" && bookD.notes.some((n) => n.includes("MÜHÜRLÜ")),
    `sealedThrough=${kasaD.sealedThrough}`,
  );
  const rowsD = bookD.rows ?? [];
  check(
    "§11d Dönem satırı yalnız iptal tersi (−50) → kapanış 1800, yürüyen bakiye tutarlı",
    kasaD.closing === "1800.00" &&
      rowsD.length === 1 &&
      rowsD[0]?.source === "PAYMENT_CANCEL" &&
      rowsD[rowsD.length - 1]?.running === kasaD.closing,
    `closing=${kasaD.closing} satır=${rowsD.length} kaynak=${rowsD[0]?.source}`,
  );
  check(
    "§11e ⭐ Sızıntı SESSİZ DEĞİL: storedDiff tam enjekte edilen tutarı gösteriyor (−999)",
    kasaD.storedDiff === "-999.00" && bookD.notes.some((n) => n.includes("UYUŞMUYOR")),
    `storedDiff=${kasaD.storedDiff} stored=${kasaD.storedBalance}`,
  );
  // Resolver'ın kendi sözleşmesi (üç adım) — rapor bağından bağımsız ölçüm.
  const resD = await cashPeriodCloseService.resolveCashBookOpening(refD, STATEMENT_FROM);
  check(
    "§11f Resolver üç adımı söylüyor: mühür 1000 + pencere 850 = 1850",
    resD.carriedFrom != null &&
      D(resD.carriedFrom.closingBalance).equals(1000) &&
      D(resD.sinceClose).equals(850) &&
      D(resD.opening).equals(1850),
    `opening=${resD.opening} sinceClose=${resD.sinceClose}`,
  );

  // ── §12 ⭐ MÜHÜRSÜZ PARİTE: kapanış yokken eski/yeni yol AYNI sayı ─────────
  // Aynı hareket deseni + kapanış YOK → rapor deviri bugünkü CTE yolundan gelir,
  // resolver'ın düz yolu da (tüm geçmişin zaman-çıpalı toplamı) AYNI sayıyı
  // vermeli. İkisi ayrışsaydı mühürlü/mühürsüz kurulum aynı kasa için iki farklı
  // devir basardı.
  const boxE = await makeBox("E");
  const refE: CashAccountRef = { cashBoxId: boxE };
  await cashRow(refE, CashTxnKind.INCOME, 1000, T_INSIDE);
  await cashRow(refE, CashTxnKind.INCOME, 700, T_EDGE_OUT);
  await payRow(refE, cariId, PaymentDirection.IN, 60, T_EDGE_OUT);
  await chequeRow(refE, cariId, "COLLECT", 40, T_INSIDE);
  await payRow(refE, cariId, PaymentDirection.IN, 50, T_EDGE_OUT, PaymentStatus.CANCELLED);
  await cashRow(refE, CashTxnKind.INCOME, 999, T_INSIDE);

  const bookE = await getCashBookReport({ range: { from: STATEMENT_FROM, to: new Date() }, accountId: boxE });
  const kasaE = bookE.accounts.find((a) => a.accountId === boxE);
  const resE = await cashPeriodCloseService.resolveCashBookOpening(refE, STATEMENT_FROM);
  check(
    "§12a ⭐ Kapanış yokken rapor deviri bugünkü yol: 1000+700+60+40+50+999 = 2849",
    kasaE?.opening === "2849.00",
    `opening=${kasaE?.opening}`,
  );
  check(
    "§12b ⭐ Resolver'ın düz yolu raporla AYNI sayı + carriedFrom null",
    resE.carriedFrom === null && D(resE.opening).equals(2849) && D(resE.sinceClose).isZero(),
    `resolver=${resE.opening}`,
  );
  check(
    "§12c Mühürsüz yanıtta mühür izi YOK (sealedThrough null, not basılmadı)",
    kasaE?.sealedThrough === null && !bookE.notes.some((n) => n.includes("MÜHÜRLÜ")),
    `sealedThrough=${kasaE?.sealedThrough}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // Sıra FK'lara göre: kapanışlar → olaylar → çekler → hareketler → hesaplar → cari.
    if (boxIds.length > 0 || bankIds.length > 0) {
      await prisma.cashPeriodClose.deleteMany({
        where: { OR: [{ cashBoxId: { in: boxIds } }, { bankAccountId: { in: bankIds } }] },
      });
      await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: chequeIds } } });
      await prisma.cheque.deleteMany({ where: { id: { in: chequeIds } } });
      await prisma.payment.deleteMany({
        where: { OR: [{ cashBoxId: { in: boxIds } }, { bankAccountId: { in: bankIds } }] },
      });
      await prisma.cashTransaction.deleteMany({
        where: { OR: [{ cashBoxId: { in: boxIds } }, { bankAccountId: { in: bankIds } }] },
      });
      await prisma.cashBox.deleteMany({ where: { id: { in: boxIds } } });
      await prisma.bankAccount.deleteMany({ where: { id: { in: bankIds } } });
    }
    if (cariIds.length > 0) await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
    if (customerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
