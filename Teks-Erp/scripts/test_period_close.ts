// =============================================================================
// BEKÇİ — DÖNEM KAPANIŞI (C3): fotoğraf · kilit · yeniden açma · ekstre devri
// =============================================================================
// Çalıştırma: npx tsx scripts/test_period_close.ts
//
// NEDEN VAR: Dönem kapanışı, "geçmiş rakam bir daha değişmez" sözüdür. O söz
// üç yerden birden kırılabilir ve üçü de SESSİZDİR:
//   1. Guard atlanır  → kapalı döneme kayıt girer, kimse görmez.
//   2. Gün sınırı UTC'de kesilir → yerel 00:00-03:00 arası kayıtlar yanlış
//      döneme düşer (Türkiye kalıcı UTC+3; gece vardiyasının tam ortası).
//   3. Kapanış ile defter yazımı yarışır → fotoğraf, commit edilmiş bir
//      hareketi saymaz; `txnCount` bir gün tutmaz ve sebebi bulunamaz.
//
// ÖLÇÜLENLER:
//   §1 ⭐ Kapanış FOTOĞRAFI doğru — ve gün sınırı FABRİKA takviminde kesiliyor
//   §2 ⭐ Kapalı döneme yazma 409; sınır günü içeride, ertesi gün serbest
//   §3 Gelecek dönem 400 · aynı dönem 409 · geriye kapanış 409
//   §4 ⭐ Reopen: gerekçe zorunlu · LIFO · satır SİLİNMEZ · sonrası SERBEST ·
//      atomik claim · yeniden kapatılabilir (partial unique ispatı)
//   §5 ⭐ BAĞLANTI TARAMASI — deftere yazan her servis guard'ı çağırıyor mu
//   §6 ⭐ Ekstre devri ÜÇ ADIM; kapanış yoksa bugünkü yol BAYT-BAYT
//   §7 Verify: guard'ı atlayan yazar drift üretirse GÖRÜNÜR olur
//   §8 ⭐ EŞZAMANLILIK: kapanış ile defter yazımı serileşir (advisory lock)
//   §10 ⭐ KİLİT SIRASI — tek fonksiyon gövdesinde ≥2 elle tekil guard → kırmızı
//       (Sınıf 3 madde 4; `test_cash_period_close` §10'un cari ikizi.
//       Negatif sonda 2026-08-14: cari.service'e çift-çağrılı sahte fonksiyon
//       eklendi → TAM 1 kırmızı, dosya adıyla; shasum ile birebir geri yüklendi)
//   §11 ⭐ ÜRETİM YOLU (K5): `cariService.statement` devri MÜHÜRDEN okur —
//       kapalı döneme guard-atlatan ham satır enjekte edilir, devir mühürlü
//       rakamda KALIR (yeniden hesap değil) + `carriedFrom` kaynağı söyler +
//       mühürsüz parite (kapanış yokken çıktı bugünkü yol ile birebir).
//       Negatif sonda 2026-08-14: statement'taki resolver bağı düz aggregate'e
//       çevrildi → §11e+§11g kırmızı (2 kontrol); cp yedeği shasum ile BİREBİR
//       geri yüklendi (dosya o sırada değiştirilmiş/izlenen — git checkout değil).
//
// KÖRLÜK ZEMİNİ: §5 taraması ve §1 fixture'ı, "hiçbir şeye bakılmadı" ile
// "ihlal bulunamadı"nın aynı yeşile çıkmasını engelleyen alt sınırlar taşır.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { Prisma, Currency, CariTxnSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { periodCloseService } from "../src/services/period-close.service";
import { cariService } from "../src/services/cari.service";
import {
  assertPeriodOpenTx,
  periodDayKey,
  periodEndCutExclusive,
  formatDayKeyTr,
} from "../src/services/helpers/period-guard.helper";
import { D, D0, applyCariBalanceTx } from "../src/services/helpers/finance.helper";

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

const TAG = `TEST-PC-${Date.now()}`;
const customerIds: string[] = [];
const cariIds: string[] = [];

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message || "(mesajsız hata)";
  }
}

/** Test fixture'ı: cari + müşteri kartı. */
async function makeCari(suffix: string): Promise<string> {
  const c = await prisma.customer.create({
    data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}` },
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

/**
 * Defter satırı — GUARD'SIZ.
 * Fixture kurulumu için (ve §7'de "guard'ı atlayan yazar" simülasyonu için).
 * Bakiye de yazılır: `test_consistency` §21/§22 mutabakatı fixture yaşarken
 * kırmızı olmasın.
 */
async function ledger(
  cariId: string,
  currency: Currency,
  txnDate: Date,
  debit: number,
  credit: number,
  description: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.cariTransaction.create({
      data: {
        cariId,
        currency,
        txnDate,
        debit: D(debit),
        credit: D(credit),
        amountTry: D(debit || credit),
        exchangeRate: D(1),
        sourceType: CariTxnSource.ADJUSTMENT,
        description,
      },
    });
    await applyCariBalanceTx(tx, cariId, currency, D(debit).minus(D(credit)));
  });
}

/** Defter satırı — GUARD'LI. Beş gerçek çağrı noktasının birebir simülasyonu. */
async function guardedLedger(
  cariId: string,
  currency: Currency,
  txnDate: Date,
  debit: number,
  description: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // ⚠️ Guard, satır YAZILMADAN ÖNCE ve AYNI tx'te — gerçek çağrı noktalarının
    // uyması gereken sözleşme budur.
    await assertPeriodOpenTx(tx, { cariId, currency, txnDate });
    await tx.cariTransaction.create({
      data: {
        cariId,
        currency,
        txnDate,
        debit: D(debit),
        credit: D0(),
        amountTry: D(debit),
        exchangeRate: D(1),
        sourceType: CariTxnSource.ADJUSTMENT,
        description,
      },
    });
    await applyCariBalanceTx(tx, cariId, currency, D(debit));
  });
}

/** Ekstre devrinin "bugünkü yolu" — kapanış hiç yokmuş gibi tam toplam. */
async function naiveOpening(cariId: string, currency: Currency, from: Date): Promise<Prisma.Decimal> {
  const agg = await prisma.cariTransaction.aggregate({
    where: { cariId, currency, txnDate: { lt: from } },
    _sum: { debit: true, credit: true },
  });
  return D(agg._sum.debit ?? 0).minus(D(agg._sum.credit ?? 0));
}

// ── SABİT TARİHLER ──────────────────────────────────────────────────────────
// Türkiye kalıcı UTC+3 (yaz saati YOK) → yerel duvar saati = UTC + 3.
const PERIOD_END = new Date(Date.UTC(2026, 2, 31)); // 31.03.2026 (gün anahtarı)
const T_INSIDE = new Date("2026-03-15T10:00:00Z"); // dönem içi
const T_EDGE_IN = new Date("2026-03-31T20:30:00Z"); // yerel 31.03 23:30 → İÇERİDE
const T_EDGE_OUT = new Date("2026-03-31T21:30:00Z"); // yerel 01.04 00:30 → DIŞARIDA
const T_AFTER = new Date("2026-05-10T09:00:00Z"); // dönem sonrası
const STATEMENT_FROM = new Date("2026-04-30T21:00:00Z"); // yerel 01.05.2026 00:00

async function main(): Promise<void> {
  console.log("=== Dönem kapanışı bekçisi ===\n");

  // ── §1 KAPANIŞ FOTOĞRAFI ──────────────────────────────────────────────────
  const cariA = await makeCari("A");
  await ledger(cariA, "TRY", T_INSIDE, 1000, 0, "içeride borç");
  await ledger(cariA, "TRY", T_EDGE_IN, 0, 400, "sınır içi alacak");
  await ledger(cariA, "TRY", T_EDGE_OUT, 700, 0, "sınır dışı borç");
  await ledger(cariA, "TRY", T_AFTER, 0, 100, "sonra");

  const naiveA = await naiveOpening(cariA, "TRY", STATEMENT_FROM);
  const openingNoClose = await periodCloseService.resolveStatementOpening({
    cariId: cariA,
    currency: "TRY",
    from: STATEMENT_FROM,
  });

  const prev = await periodCloseService.preview({ cariId: cariA, currency: "TRY", periodEnd: PERIOD_END });
  check(
    "§1a Önizleme kapanış bakiyesini doğru ölçtü (1000 − 400 = 600)",
    D(prev.data.closingBalance).equals(600),
    `bakiye=${prev.data.closingBalance}`,
  );
  check(
    "§1b ⭐ GÜN SINIRI FABRİKA takvimindE: yerel 23:30 içeride, ertesi 00:30 DIŞARIDA (2 hareket)",
    prev.data.txnCount === 2,
    `txnCount=${prev.data.txnCount} (UTC ile kesilseydi 3 olurdu)`,
  );
  check(
    "§1c Kesim anı ertesi günün fabrika 00:00'ı",
    periodEndCutExclusive(PERIOD_END).toISOString() === "2026-03-31T21:00:00.000Z",
    periodEndCutExclusive(PERIOD_END).toISOString(),
  );
  check("§1d Önizleme henüz kapanış YOK diyor", prev.data.alreadyClosed === false && prev.data.blockingClose === null);

  const txnCountBefore = await prisma.cariTransaction.count({ where: { cariId: cariA } });
  const closeA = await periodCloseService.close({ cariId: cariA, currency: "TRY", periodEnd: PERIOD_END });
  check(
    "§1e Kapanış önizlemeyle BİREBİR aynı rakamı sakladı",
    D(closeA.data.closingBalance).equals(600) && closeA.data.txnCount === 2,
    `${closeA.data.closingBalance} / ${closeA.data.txnCount}`,
  );
  check(
    "§1f ⭐ Kapanış DEFTERE SATIR YAZMADI (fotoğraf, hareket değil)",
    (await prisma.cariTransaction.count({ where: { cariId: cariA } })) === txnCountBefore,
  );
  check(
    "§1g Kapanış günü `@db.Date` anahtarı olarak saklandı",
    closeA.data.periodEnd.toISOString() === "2026-03-31T00:00:00.000Z",
    closeA.data.periodEnd.toISOString(),
  );

  // ── §2 KAPALI DÖNEME YAZMA KİLİTLİ ────────────────────────────────────────
  const errInside = await expectError(() => guardedLedger(cariA, "TRY", T_INSIDE, 50, "dönem içi deneme"));
  check("§2a ⭐ Kapalı döneme yazma REDDEDİLDİ", /KAPALI döneme/i.test(errInside), errInside.slice(0, 90));
  check("§2b Mesaj hem kaydın hem kapanışın tarihini söylüyor", /15\.03\.2026/.test(errInside) && /31\.03\.2026/.test(errInside));

  const errEdge = await expectError(() => guardedLedger(cariA, "TRY", T_EDGE_IN, 50, "sınır içi deneme"));
  check("§2c ⭐ SINIR: kapanış gününün yerel 23:30'u da KAPALI", /KAPALI döneme/i.test(errEdge));

  await guardedLedger(cariA, "TRY", T_EDGE_OUT, 5, "sınır dışı serbest");
  check(
    "§2d ⭐ SINIR: ertesi günün yerel 00:30'u SERBEST (UTC ile kesilseydi bloklanırdı)",
    (await prisma.cariTransaction.count({ where: { cariId: cariA, description: "sınır dışı serbest" } })) === 1,
  );

  await guardedLedger(cariA, "USD", T_INSIDE, 10, "başka para birimi");
  check(
    "§2e Kapanış PARA BİRİMİ bazında — USD etkilenmedi",
    (await prisma.cariTransaction.count({ where: { cariId: cariA, currency: "USD" } })) === 1,
  );

  const cariOther = await makeCari("OTHER");
  await guardedLedger(cariOther, "TRY", T_INSIDE, 10, "başka cari");
  check(
    "§2f Kapanış CARİ bazında — başka cari etkilenmedi",
    (await prisma.cariTransaction.count({ where: { cariId: cariOther } })) === 1,
  );

  // ── §3 GELECEK + SIRALILIK ────────────────────────────────────────────────
  const future = new Date(Date.now() + 5 * 86_400_000);
  const errFuture = await expectError(() =>
    periodCloseService.close({ cariId: cariA, currency: "TRY", periodEnd: future }),
  );
  check("§3a Gelecek dönem kapatılamaz", /Gelecek bir dönem/i.test(errFuture), errFuture.slice(0, 70));

  const errSame = await expectError(() =>
    periodCloseService.close({ cariId: cariA, currency: "TRY", periodEnd: PERIOD_END }),
  );
  check("§3b Aynı dönem ikinci kez kapatılamaz", /zaten kapalı/i.test(errSame), errSame.slice(0, 70));

  const errBack = await expectError(() =>
    periodCloseService.close({ cariId: cariA, currency: "TRY", periodEnd: new Date(Date.UTC(2026, 1, 28)) }),
  );
  check("§3c Daha ileri kapanış varken geriye kapanış yapılamaz", /ileri bir kapanış/i.test(errBack), errBack.slice(0, 70));

  // ── §4 YENİDEN AÇMA ───────────────────────────────────────────────────────
  const cariB = await makeCari("B");
  await ledger(cariB, "TRY", new Date("2026-02-10T09:00:00Z"), 200, 0, "şubat");
  await ledger(cariB, "TRY", new Date("2026-04-10T09:00:00Z"), 300, 0, "nisan");
  const feb = await periodCloseService.close({ cariId: cariB, currency: "TRY", periodEnd: new Date(Date.UTC(2026, 1, 28)) });
  const apr = await periodCloseService.close({ cariId: cariB, currency: "TRY", periodEnd: new Date(Date.UTC(2026, 3, 30)) });
  check("§4a Sıralı iki kapanış kuruldu", D(feb.data.closingBalance).equals(200) && D(apr.data.closingBalance).equals(500));

  const errNoReason = await expectError(() => periodCloseService.reopen(apr.data.id, "  "));
  check("§4b Gerekçesiz yeniden açma REDDEDİLDİ", /gerekçesi zorunlu/i.test(errNoReason), errNoReason.slice(0, 70));

  const errLifo = await expectError(() => periodCloseService.reopen(feb.data.id, "bekçi denemesi"));
  check(
    "§4c ⭐ LIFO: daha yeni kapanış dururken eski dönem açılamaz",
    /Önce daha yeni kapanışı/i.test(errLifo) && /30\.04\.2026/.test(errLifo),
    errLifo.slice(0, 80),
  );

  await periodCloseService.reopen(apr.data.id, "bekçi: nisan düzeltmesi");
  const aprRow = await prisma.cariPeriodClose.findUnique({
    where: { id: apr.data.id },
    select: { reopenedAt: true, reopenReason: true, closingBalance: true },
  });
  check(
    "§4d ⭐ Reopen satırı SİLMEDİ, İŞARETLEDİ (fotoğraf ve gerekçe duruyor)",
    aprRow != null && aprRow.reopenedAt != null && aprRow.reopenReason === "bekçi: nisan düzeltmesi" && D(aprRow.closingBalance).equals(500),
  );

  const errTwice = await expectError(() => periodCloseService.reopen(apr.data.id, "ikinci kez"));
  check("§4e Aynı kapanış ikinci kez açılamaz (atomik claim)", /zaten yeniden açılmış/i.test(errTwice), errTwice.slice(0, 70));

  // Nisan açık, Şubat hâlâ kapalı → Mart'a yazma HÂLÂ yasak, Nisan'a serbest.
  const errStillFeb = await expectError(() =>
    guardedLedger(cariB, "TRY", new Date("2026-02-20T09:00:00Z"), 1, "şubat denemesi"),
  );
  check("§4f Nisan açıldı ama ŞUBAT kapalı → şubata yazma hâlâ 409", /KAPALI döneme/i.test(errStillFeb));
  await guardedLedger(cariB, "TRY", new Date("2026-04-20T09:00:00Z"), 7, "nisan serbest");
  check(
    "§4g ⭐ REOPEN SONRASI o döneme yazma SERBEST",
    (await prisma.cariTransaction.count({ where: { cariId: cariB, description: "nisan serbest" } })) === 1,
  );

  await periodCloseService.reopen(feb.data.id, "bekçi: şubat düzeltmesi");
  await guardedLedger(cariB, "TRY", new Date("2026-02-20T09:00:00Z"), 3, "şubat serbest");
  check(
    "§4h İki kapanış da açılınca geçmişin tamamı serbest",
    (await prisma.cariTransaction.count({ where: { cariId: cariB, description: "şubat serbest" } })) === 1,
  );

  const reFeb = await periodCloseService.close({ cariId: cariB, currency: "TRY", periodEnd: new Date(Date.UTC(2026, 1, 28)) });
  check(
    "§4i ⭐ Yeniden açılan dönem TEKRAR kapatılabildi (partial unique ispatı — düz unique olsaydı P2002)",
    D(reFeb.data.closingBalance).equals(203),
    `bakiye=${reFeb.data.closingBalance}`,
  );

  // ── §5 BAĞLANTI TARAMASI ──────────────────────────────────────────────────
  // Guard yazılmış olması yetmez; deftere yazan HER servis onu ÇAĞIRMALI.
  // Guard'ı atlayan tek bir yazar, kilidin tamamını sessizce delik yapar.
  //
  // ⚠️ TARAMA TS AST İLE, REGEX DEĞİL (`test_permission_catalog` deseni).
  // Bu ilk yazımda ISIRDI: `cheque.service.ts` guard'dan yalnız BİR YORUM
  // SATIRINDA söz ediyordu ve düz metin araması onu "bağlı" saydı — yani
  // kontrol, tehlikeli yönde (yanlış YEŞİL) hata verdi. AST yalnız gerçek
  // çağrıyı görür; yorum ve string'ler doğal olarak kapsam dışıdır.
  const servicesDir = path.resolve(__dirname, "..", "src", "services");
  const scanned: Array<{ file: string; guarded: boolean }> = [];
  const scanOne = (full: string): { writes: boolean; guards: boolean } => {
    const sf = ts.createSourceFile(full, fs.readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true);
    let writes = false;
    let guards = false;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        if (ts.isIdentifier(e) && (e.text === "assertPeriodOpenTx" || e.text === "assertPeriodsOpenTx")) guards = true;
        if (ts.isPropertyAccessExpression(e) && (e.name.text === "create" || e.name.text === "createMany")) {
          const owner = e.expression;
          if (ts.isPropertyAccessExpression(owner) && owner.name.text === "cariTransaction") writes = true;
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return { writes, guards };
  };
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const r = scanOne(full);
      if (!r.writes) continue;
      scanned.push({ file: path.relative(servicesDir, full), guarded: r.guards });
    }
  };
  walk(servicesDir);

  // KÖRLÜK ZEMİNİ: tarayıcı boşa düşerse ("hiçbir dosya bulunamadı") sonuç
  // "ihlal yok" ile aynı yeşile çıkardı. Bugün bilinen yazarlar: fatura ×2,
  // tahsilat ×2, cari devri (+ C1 çek olayları). En az 3 dosya görülmeli.
  check(
    "§5a Körlük zemini: defter yazan servis dosyaları bulundu",
    scanned.length >= 3,
    `bulunan=${scanned.length} → ${scanned.map((s) => s.file).join(", ")}`,
  );
  const unguarded = scanned.filter((s) => !s.guarded);
  check(
    "§5b ⭐ Deftere yazan HER servis dönem guard'ını çağırıyor",
    unguarded.length === 0,
    unguarded.length === 0
      ? "hepsi bağlı"
      : `BAĞLANMAMIŞ: ${unguarded.map((s) => s.file).join(", ")} — her birinde ` +
        `cariTransaction.create'ten ÖNCE, AYNI tx'te: ` +
        `await assertPeriodOpenTx(tx, { cariId, currency, txnDate })`,
  );

  // ── §6 EKSTRE DEVRİ — ÜÇ ADIM ─────────────────────────────────────────────
  const cariC = await makeCari("C");
  await ledger(cariC, "TRY", T_INSIDE, 1000, 0, "C içeride");
  await ledger(cariC, "TRY", T_EDGE_OUT, 700, 0, "C sonra");
  const openC = await periodCloseService.resolveStatementOpening({
    cariId: cariC,
    currency: "TRY",
    from: STATEMENT_FROM,
  });
  const naiveC = await naiveOpening(cariC, "TRY", STATEMENT_FROM);
  check(
    "§6a ⭐ Kapanış YOKSA bugünkü yol BAYT-BAYT (tek aggregate, devir yok)",
    openC.carriedFrom === null && D(openC.opening).equals(naiveC) && D(openC.sinceClose).isZero(),
    `opening=${openC.opening} naive=${naiveC}`,
  );
  check(
    "§6b Kapanıştan ÖNCE ölçülen devir de aynıydı (cariA)",
    openingNoClose.carriedFrom === null && D(openingNoClose.opening).equals(naiveA),
    `opening=${openingNoClose.opening} naive=${naiveA}`,
  );

  const openA = await periodCloseService.resolveStatementOpening({
    cariId: cariA,
    currency: "TRY",
    from: STATEMENT_FROM,
  });
  check("§6c ⭐ ADIM 1: aktif kapanış bulundu", openA.carriedFrom != null && D(openA.carriedFrom.closingBalance).equals(600));
  check(
    "§6d ⭐ ADIM 2: kapanıştan pencereye kadarki Σ (700 + §2d'de yazılan 5)",
    D(openA.sinceClose).equals(705),
    `sinceClose=${openA.sinceClose}`,
  );
  check(
    "§6e ⭐ ADIM 3: devir = kapanış + Σ, ve NAİF TOPLAMLA BİREBİR aynı",
    D(openA.opening).equals(D(openA.carriedFrom?.closingBalance ?? 0).plus(openA.sinceClose)) &&
      D(openA.opening).equals(await naiveOpening(cariA, "TRY", STATEMENT_FROM)),
    `opening=${openA.opening}`,
  );

  // ── §7 VERIFY: GUARD'I ATLAYAN YAZAR GÖRÜNÜR OLUR ─────────────────────────
  const okVerify = await periodCloseService.verify(closeA.data.id);
  check("§7a Sağlam kapanışta drift YOK", okVerify.data.drift === false, `Δ=${okVerify.data.balanceDelta}`);

  // `ledger` guard'sız yazar — yani "bir gün biri guard'ı atlarsa" senaryosu.
  await ledger(cariA, "TRY", T_INSIDE, 999, 0, "guard'sız sızıntı");
  const drifted = await periodCloseService.verify(closeA.data.id);
  check(
    "§7b ⭐ Guard'ı atlayan yazım kapanışta DRIFT olarak görünür (sessiz kalmaz)",
    drifted.data.drift === true && D(drifted.data.balanceDelta).equals(999) && drifted.data.countDelta === 1,
    `Δbakiye=${drifted.data.balanceDelta} Δadet=${drifted.data.countDelta}`,
  );
  check(
    "§7c Verify SALT OKUMA — saklanan fotoğrafı düzeltmedi",
    D(
      (await prisma.cariPeriodClose.findUniqueOrThrow({
        where: { id: closeA.data.id },
        select: { closingBalance: true },
      })).closingBalance,
    ).equals(600),
  );

  // ── §8 EŞZAMANLILIK: KAPANIŞ ↔ DEFTER YAZIMI SERİLEŞİR ────────────────────
  // Yarışın kendisi: yazar guard'ı geçti ama HENÜZ COMMIT ETMEDİ; tam o anda
  // kapanış ölçüm yapıyor. Advisory kilit olmasaydı kapanış o satırı SAYMAZ ve
  // fotoğraf, kapalı dönemde duran bir hareketi dışarıda bırakırdı.
  const cariD = await makeCari("D");
  await ledger(cariD, "TRY", new Date("2026-03-01T09:00:00Z"), 100, 0, "D başlangıç");

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const writer = prisma.$transaction(
    async (tx) => {
      await assertPeriodOpenTx(tx, { cariId: cariD, currency: "TRY", txnDate: T_INSIDE });
      // ⚠️ Tx içinde bekleme NORMALDE YASAK (perf kuralı 10); burada yarış
      // penceresini DETERMİNİSTİK açmanın tek yolu bu ve yalnız bekçide.
      await sleep(500);
      await tx.cariTransaction.create({
        data: {
          cariId: cariD,
          currency: "TRY",
          txnDate: T_INSIDE,
          debit: D(50),
          credit: D0(),
          amountTry: D(50),
          exchangeRate: D(1),
          sourceType: CariTxnSource.ADJUSTMENT,
          description: "yarış yazımı",
        },
      });
      await applyCariBalanceTx(tx, cariD, "TRY", D(50));
      return "written";
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
  const closer = (async () => {
    await sleep(120); // yazar kilidi ALDIKTAN sonra kapanışı başlat
    return periodCloseService.close({ cariId: cariD, currency: "TRY", periodEnd: PERIOD_END });
  })();
  const [wRes, cRes] = await Promise.allSettled([writer, closer]);

  check("§8a Yazar (kilidi önce alan) tamamlandı", wRes.status === "fulfilled", wRes.status);
  check("§8b Kapanış tamamlandı", cRes.status === "fulfilled", cRes.status);
  if (cRes.status === "fulfilled") {
    check(
      "§8c ⭐ Kapanış, yarıştaki satırı SAYDI (150 / 2) — kilit olmasaydı 100 / 1 olurdu",
      D(cRes.value.data.closingBalance).equals(150) && cRes.value.data.txnCount === 2,
      `bakiye=${cRes.value.data.closingBalance} adet=${cRes.value.data.txnCount}`,
    );
    const vD = await periodCloseService.verify(cRes.value.data.id);
    check("§8d Yarış sonrası fotoğraf ile defter MUTABIK", vD.data.drift === false, `Δ=${vD.data.balanceDelta}`);
  } else {
    check("§8c ⭐ Kapanış, yarıştaki satırı SAYDI", false, String(cRes.reason));
    check("§8d Yarış sonrası fotoğraf ile defter MUTABIK", false, "kapanış koşmadı");
  }

  // ── Sözleşme sağlamaları (saf katman) ─────────────────────────────────────
  check(
    "§9a `periodDayKey` yerel gece yarısından sonrayı ERTESİ güne yazar",
    periodDayKey(T_EDGE_OUT).toISOString() === "2026-04-01T00:00:00.000Z",
    periodDayKey(T_EDGE_OUT).toISOString(),
  );
  check(
    "§9b `formatDayKeyTr` UTC parçalarından basar (süreç saat diliminden bağımsız)",
    formatDayKeyTr(PERIOD_END) === "31.03.2026",
    formatDayKeyTr(PERIOD_END),
  );

  // ── §10 KİLİT SIRASI — tek fonksiyon gövdesinde ≥2 ELLE tekil çağrı ───────
  // Sınıf 3 (2026-08-14 sağlamlık tasarımı, madde 4): sırasız çift advisory
  // kilit ayna çiftte PG deadlock (40P01) üretir — `cheque.bounce` tam bu
  // desenden kilitlenmişti (iki cariye iki AYRI tekil guard çağrısı). Çok
  // kapsama yazan tx ÇOĞUL helper'ı (assertPeriodsOpenTx) kullanmalı;
  // anahtarları o sıralar. Bu tarama `test_cash_period_close` §10'un CARİ
  // ikizidir — kasa tarafı orada kilitli, cari tarafı burada.
  // ⚠️ Bilinen statik sınır (tasarımda yazılı): döngü içinden TEK çağrı
  // noktasıyla N kilit almayı AST göremez. ⚠️ `period-guard.helper.ts` MUAF:
  // çoğul helper tekil guard'ı SIRALANMIŞ anahtarlarla döngüde çağırır —
  // meşru olan tek yer.
  {
    const isFnLike = (n: ts.Node): boolean =>
      ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n);
    const walkTs = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walkTs(full);
        return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
      });
    let singularSites = 0;
    const doubles: string[] = [];
    for (const full of walkTs(servicesDir)) {
      if (full.endsWith(`helpers${path.sep}period-guard.helper.ts`)) continue; // muaf (üstte gerekçeli)
      const rel = path.relative(servicesDir, full);
      const sf = ts.createSourceFile(full, fs.readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true);
      const countOwnBody = (fn: ts.Node): number => {
        let c = 0;
        const walkFn = (n: ts.Node): void => {
          if (n !== fn && isFnLike(n)) return; // iç fonksiyon (tx callback'i) KENDİ gövdesidir
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "assertPeriodOpenTx") {
            c++;
          }
          ts.forEachChild(n, walkFn);
        };
        walkFn(fn);
        return c;
      };
      const visit = (n: ts.Node): void => {
        if (isFnLike(n)) {
          const c = countOwnBody(n);
          singularSites += c;
          if (c >= 2) doubles.push(`${rel} (tek gövdede ${c} tekil çağrı)`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    // Körlük zemini: bugün 7 meşru tekil çağrı var (cari ×2 · fatura ×2 ·
    // çek ×1 · tahsilat ×2). Tarama boşa düşerse 0 bulur — "ihlal yok" ile
    // "hiçbir şeye bakılmadı" aynı yeşile çıkmasın.
    check(
      "§10a Körlük zemini: elle tekil cari-guard çağrıları bulundu",
      singularSites >= 5,
      `tekil çağrı=${singularSites}`,
    );
    check(
      "§10b ⭐ Hiçbir fonksiyon gövdesi ≥2 ELLE tekil cari-guard çağrısı taşımıyor (çok kapsam = ÇOĞUL helper)",
      doubles.length === 0,
      doubles.length === 0 ? "temiz" : `İHLAL: ${doubles.join(" · ")} — assertPeriodsOpenTx kullan`,
    );
  }

  // ── §11 ⭐ ÜRETİM YOLU: `cariService.statement` DEVRİ MÜHÜRDEN OKUR ────────
  // §6 resolver'ın KENDİSİNİ ölçer; bu bölüm resolver'ın ekstre servisine
  // gerçekten BAĞLI olduğunu ölçer (K5'in özü: resolver doğruyken statement
  // düz aggregate okumaya devam edebilirdi ve hiçbir test kırmızı vermezdi).
  // KURGU test_period_close §7'nin ekstre karşılığı: kapanış kur → kapalı
  // döneme guard'ı ATLAYAN ham satır enjekte et → statement devri MÜHÜRLÜ
  // rakamı vermeli, yeniden hesap (naif toplam) DEĞİL.
  // ⚠️ NEGATİF SONDA HEDEFİ: statement'taki `resolveStatementOpening` bağı
  // koparılıp düz aggregate'e döndürülürse §11d/§11e kırmızı verir.
  const cariE = await makeCari("E");
  const STATEMENT_TO = new Date("2026-06-30T12:00:00Z");
  await ledger(cariE, "TRY", T_INSIDE, 1000, 0, "E kapanış içi");
  await ledger(cariE, "TRY", T_EDGE_OUT, 700, 0, "E pencere (kapanış→dönem başı)");
  await ledger(cariE, "TRY", T_AFTER, 0, 100, "E dönem içi");

  // MÜHÜRSÜZ PARİTE: kapanış yokken çıktı bugünkü yol ile BAYT-BAYT.
  const stNoClose = await cariService.statement({
    cariId: cariE,
    currency: "TRY",
    from: STATEMENT_FROM,
    to: STATEMENT_TO,
  });
  const naiveE = await naiveOpening(cariE, "TRY", STATEMENT_FROM);
  check(
    "§11a ⭐ MÜHÜRSÜZ PARİTE: devir naif toplamla birebir + carriedFrom null",
    stNoClose.data.carriedFrom === null && D(stNoClose.data.opening).equals(naiveE) && D(naiveE).equals(1700),
    `opening=${stNoClose.data.opening} naive=${naiveE}`,
  );
  check(
    "§11b Mühürsüz kapanış bakiyesi de doğru (1700 − 100 = 1600)",
    D(stNoClose.data.closing).equals(1600) && stNoClose.data.rows.length === 1,
    `closing=${stNoClose.data.closing} satır=${stNoClose.data.rows.length}`,
  );

  const closeE = await periodCloseService.close({ cariId: cariE, currency: "TRY", periodEnd: PERIOD_END });
  check("§11c Kapanış fixture'ı mühürledi (1000)", D(closeE.data.closingBalance).equals(1000));

  // Guard'ı ATLAYAN sızıntı — kapalı döneme ham satır (§7'deki `ledger` yolu).
  await ledger(cariE, "TRY", T_INSIDE, 999, 0, "E guard'sız sızıntı");
  const naiveELeak = await naiveOpening(cariE, "TRY", STATEMENT_FROM);
  check("§11d Sonda anlamlı: naif toplam sızıntıyı GÖRÜYOR (2699)", D(naiveELeak).equals(2699), `naive=${naiveELeak}`);

  const stSealed = await cariService.statement({
    cariId: cariE,
    currency: "TRY",
    from: STATEMENT_FROM,
    to: STATEMENT_TO,
  });
  check(
    "§11e ⭐ Devir MÜHÜRLÜ rakamdan: 1000 (mühür) + 700 (pencere) = 1700 — sızıntıyla YENİDEN HESAPLANMADI",
    D(stSealed.data.opening).equals(1700),
    `opening=${stSealed.data.opening} (düz aggregate olsaydı ${naiveELeak})`,
  );
  check(
    "§11f ⭐ Yanıt devrin kaynağını söylüyor (carriedFrom: 31.03.2026 · 1000)",
    stSealed.data.carriedFrom != null &&
      stSealed.data.carriedFrom.periodEnd.toISOString() === "2026-03-31T00:00:00.000Z" &&
      D(stSealed.data.carriedFrom.closingBalance).equals(1000),
    `carriedFrom=${stSealed.data.carriedFrom?.periodEnd.toISOString()} / ${stSealed.data.carriedFrom?.closingBalance}`,
  );
  check(
    "§11g Dönem satırları/toplamları mühürden ETKİLENMEDİ (yalnız devir mühre bağlandı)",
    D(stSealed.data.closing).equals(1600) &&
      stSealed.data.rows.length === 1 &&
      D(stSealed.data.totalDebit).isZero() &&
      D(stSealed.data.totalCredit).equals(100),
    `closing=${stSealed.data.closing}`,
  );
  // Sızıntının kendisi kayıp değil: verify onu drift olarak GÖRÜR (§7 sözleşmesi).
  const verE = await periodCloseService.verify(closeE.data.id);
  check(
    "§11h Sızıntı sessiz kalmadı — verify drift'i gösteriyor (Δ=999)",
    verE.data.drift === true && D(verE.data.balanceDelta).equals(999),
    `Δ=${verE.data.balanceDelta}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    if (cariIds.length > 0) {
      await prisma.cariPeriodClose.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
    }
    if (customerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
