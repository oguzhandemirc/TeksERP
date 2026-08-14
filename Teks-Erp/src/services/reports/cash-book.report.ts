// =============================================================================
// KASA / BANKA DEFTERİ — devir + dönem hareketleri + yürüyen bakiye
// =============================================================================
// YENİ TABLO YOK: salt okuma. Kaynaklar `payments`, `cash_transactions` ve
// `cheque_events`.
//
// ── ÜÇ YAZAR, TEK DEFTER ─────────────────────────────────────────────────────
// Kasa/banka bakiyesinin ÜÇ yazarı vardır ve şema bunu açıkça söyler:
//   1) `Payment`         — carili tahsilat/ödeme
//   2) `CashTransaction` — carisiz masraf/gelir/virman/açılış
//   3) `ChequeEvent`     — COLLECT (tahsil, +) ve PAY (kendi çekimiz, −)
// Üçüncüyü atlayan bir defter, ilk çek tahsilatında bakiyeyle ayrışır ve
// operatöre "para nereden geldi" sorusunu cevaplayamaz. (`test_consistency`
// §23/§24 mutabakat formülü de aynı üçlüyü toplar — bu rapor onun EKRAN
// karşılığıdır ve aynı kümeyi okumak ZORUNDADIR.)
//
// ⚠️ DEPOSIT (tahsile verme) PARA HAREKETİ DEĞİLDİR ve deftere GİRMEZ: çek
// bankaya teslim edilmiştir ama para henüz gelmemiştir. Deftere yazılsaydı
// bakiye, hesapta olmayan parayı gösterirdi.
//
// ── İPTAL BİR HAREKETTİR, KAYDIN SİLİNMESİ DEĞİL ─────────────────────────────
// `Payment.cancel` / `CashTransaction.cancel` bakiyeyi TERS YÖNDE düzeltir
// (satırı silmez). Dolayısıyla defterde İKİ satır vardır: belge tarihinde asıl
// hareket, iptal anında ters hareket. İptal edilen belgeyi tamamen gizlemek
// kolay olurdu ama o zaman "kasa bugün neden 5.000 azaldı" sorusunun cevabı
// hiçbir satırda görünmezdi. İptal satırları `cancelled: true` ile işaretlenir.
//
// ⚠️ İptal satırının tarihi `cancelledAt`'tir, belge tarihi DEĞİL — para o an
// geri döndü. Belge tarihine yazılsaydı geçmiş bir dönemin kapanış bakiyesi
// bugün değişirdi (donmuş rakamı geriye dönük değiştirmek yasak).
//
// ── DEVİR: SAKLANAN BİR SAYIDAN DEĞİL, HAREKETLERDEN ─────────────────────────
// Açılış bakiyesi `CashBox.balance`'tan geriye doğru hesaplanmaz; dönemden
// ÖNCEKİ hareketlerin toplamıdır. Böylece defter, denormalize bakiye kolonunun
// İKİNCİ bir yolu olur: `storedDiff` sıfır değilse ya bir yazar unutulmuş ya
// bakiyeye elle dokunulmuştur — ikisi de sessiz kalmamalı.
//
// ⚠️ `storedDiff` YALNIZ dönem sonu BUGÜNÜ KAPSIYORSA anlamlıdır: saklanan
// bakiye her zaman "şu an"dır, geçmiş bir kesitle karşılaştırmak tanım gereği
// fark üretir. Kapsamıyorsa `null` döner (0 değil — "ölçülemedi" ile "sapma
// yok" ayrı şeylerdir).
//
// ⚠️ Tutarlar JSON'a STRING olarak çıkar (2 hane) — `finance-aging.report.ts`
// ile aynı gerekçe (float toplamı kuruş kaydırır).
// =============================================================================

import { Prisma, Currency } from "@prisma/client";
import prisma from "../../lib/prisma";
import { D, D0 } from "../helpers/finance.helper";
import type { DateRange } from "./_shared";

/** Tek sayfada basılabilir satır tavanı — aşılırsa kırpılır ve SÖYLENİR. */
const MAX_ROWS = 5000;

export type CashAccountKind = "CASH" | "BANK";

export interface CashBookParams {
  range: DateRange;
  /** Tek hesap seçiliyse satır dökümü de döner; yoksa yalnız hesap özetleri. */
  accountId?: string;
  accountKind?: CashAccountKind;
  /** Pasif hesapları da göster (varsayılan: yalnız aktifler + hareketi olanlar). */
  includeInactive?: boolean;
}

export interface CashBookRow {
  id: string;
  source: "PAYMENT" | "PAYMENT_CANCEL" | "CASH_TXN" | "CASH_TXN_CANCEL" | "CHEQUE";
  docNo: string;
  date: string;
  direction: "IN" | "OUT";
  /** Her zaman POZİTİF — yön `direction` kolonundadır. */
  amount: string;
  /** İşaretli tutar (giriş +, çıkış −). */
  signed: string;
  /** O satırdan SONRAKİ bakiye. */
  running: string;
  kind: string | null;
  counterparty: string | null;
  description: string | null;
  reference: string | null;
  cancelled: boolean;
}

export interface CashBookAccountSummary {
  accountId: string;
  accountKind: CashAccountKind;
  code: string;
  name: string;
  currency: Currency;
  isActive: boolean;
  /** Dönem başı devir — dönemden ÖNCEKİ hareketlerin toplamı. */
  opening: string;
  totalIn: string;
  totalOut: string;
  closing: string;
  /** `cash_boxes.balance` / `bank_accounts.balance` denormalize kolonu. */
  storedBalance: string;
  /** closing − storedBalance; yalnız dönem sonu bugünü kapsıyorsa dolu. */
  storedDiff: string | null;
  movementCount: number;
}

export interface CashBookReport {
  accounts: CashBookAccountSummary[];
  /** Yalnız tek hesap seçiliyse dolu — çok hesapta yürüyen bakiye anlamsızdır. */
  rows: CashBookRow[] | null;
  rowsTruncated: boolean;
  /** Dönem sonu "şu an"ı kapsıyor mu — `storedDiff`in ölçülebilirlik koşulu. */
  storedComparable: boolean;
  totals: { opening: string; totalIn: string; totalOut: string; closing: string } | null;
  notes: string[];
}

interface AccountRow {
  id: string;
  accountKind: string;
  code: string;
  name: string;
  currency: string;
  balance: string;
  isActive: boolean;
}

interface MovementRow {
  id: string;
  source: string;
  docNo: string;
  dt: Date;
  accountId: string;
  direction: string;
  amount: string;
  kind: string | null;
  counterparty: string | null;
  description: string | null;
  reference: string | null;
  cancelled: boolean;
}

interface OpeningRow {
  accountId: string;
  opening: string;
}

/**
 * Kasa/banka hareketlerinin BİRLEŞİK kaynağı.
 *
 * ⚠️ TEK TANIM: devir sorgusu ile satır sorgusu AYNI fragment'ı kullanır. İkisi
 * ayrı yazılsaydı biri iptal ters kayıtlarını ya da çek olaylarını unutur ve
 * "devir + hareketler ≠ kapanış" hatası, tam da bu raporun ölçmek için var
 * olduğu şey olurdu.
 */
function movementsCte(): Prisma.Sql {
  return Prisma.sql`
    mv AS (
      -- 1) TAHSİLAT / ÖDEME (carili)
      SELECT p.id::text                                        AS id,
             'PAYMENT'                                         AS source,
             p."docNo"                                         AS "docNo",
             p."paymentDate"                                   AS dt,
             COALESCE(p."cashBoxId", p."bankAccountId")::text   AS "accountId",
             p.direction::text                                 AS direction,
             p.amount                                          AS amount,
             p.method::text                                    AS kind,
             COALESCE(cu.name, sc.name)                        AS counterparty,
             p.notes                                           AS description,
             p.reference                                       AS reference,
             (p.status = 'CANCELLED')                          AS cancelled
        FROM payments p
        JOIN cari_accounts ca ON ca.id = p."cariId"
        LEFT JOIN customers cu ON cu.id = ca."customerId"
        LEFT JOIN subcontractors sc ON sc.id = ca."subcontractorId"
       WHERE COALESCE(p."cashBoxId", p."bankAccountId") IS NOT NULL

      UNION ALL
      -- 1b) TAHSİLAT İPTALİ — ters hareket, İPTAL ANINDA
      SELECT p.id::text || ':C', 'PAYMENT_CANCEL', p."docNo", p."cancelledAt",
             COALESCE(p."cashBoxId", p."bankAccountId")::text,
             CASE WHEN p.direction = 'IN' THEN 'OUT' ELSE 'IN' END,
             p.amount, p.method::text, COALESCE(cu.name, sc.name),
             COALESCE(p."cancelReason", 'İptal'), p.reference, TRUE
        FROM payments p
        JOIN cari_accounts ca ON ca.id = p."cariId"
        LEFT JOIN customers cu ON cu.id = ca."customerId"
        LEFT JOIN subcontractors sc ON sc.id = ca."subcontractorId"
       WHERE p.status = 'CANCELLED' AND p."cancelledAt" IS NOT NULL
         AND COALESCE(p."cashBoxId", p."bankAccountId") IS NOT NULL

      UNION ALL
      -- 2) KASA HAREKETİ (carisiz: masraf · gelir · virman · açılış)
      SELECT ct.id::text, 'CASH_TXN', ct."docNo", ct."txnDate",
             COALESCE(ct."cashBoxId", ct."bankAccountId")::text,
             ct.direction::text, ct.amount, ct.kind::text, NULL,
             COALESCE(ct.description, ct.category), ct.reference,
             (ct.status = 'CANCELLED')
        FROM cash_transactions ct
       WHERE COALESCE(ct."cashBoxId", ct."bankAccountId") IS NOT NULL

      UNION ALL
      -- 2b) KASA HAREKETİ İPTALİ
      SELECT ct.id::text || ':C', 'CASH_TXN_CANCEL', ct."docNo", ct."cancelledAt",
             COALESCE(ct."cashBoxId", ct."bankAccountId")::text,
             CASE WHEN ct.direction = 'IN' THEN 'OUT' ELSE 'IN' END,
             ct.amount, ct.kind::text, NULL,
             COALESCE(ct."cancelReason", 'İptal'), ct.reference, TRUE
        FROM cash_transactions ct
       WHERE ct.status = 'CANCELLED' AND ct."cancelledAt" IS NOT NULL
         AND COALESCE(ct."cashBoxId", ct."bankAccountId") IS NOT NULL

      UNION ALL
      -- 3) ÇEK OLAYI — yalnız PARA HAREKETİ olanlar (COLLECT / PAY)
      SELECT e.id::text, 'CHEQUE', ch."docNo", e."eventDate",
             COALESCE(e."cashBoxId", e."bankAccountId")::text,
             CASE WHEN e.type = 'COLLECT' THEN 'IN' ELSE 'OUT' END,
             ch.amount, e.type::text, COALESCE(cu2.name, sc2.name),
             e.notes, ch."serialNo", FALSE
        FROM cheque_events e
        JOIN cheques ch ON ch.id = e."chequeId"
        JOIN cari_accounts ca2 ON ca2.id = ch."cariId"
        LEFT JOIN customers cu2 ON cu2.id = ca2."customerId"
        LEFT JOIN subcontractors sc2 ON sc2.id = ca2."subcontractorId"
       WHERE e.type IN ('COLLECT', 'PAY')
         AND COALESCE(e."cashBoxId", e."bankAccountId") IS NOT NULL
    )`;
}

export async function getCashBookReport(params: CashBookParams): Promise<CashBookReport> {
  const { from, to } = params.range;

  const fAccount = params.accountId ? Prisma.sql`AND a.id::text = ${params.accountId}` : Prisma.empty;
  const fKind = params.accountKind ? Prisma.sql`AND a."accountKind" = ${params.accountKind}` : Prisma.empty;

  // Hesap kataloğu: iki tablonun birleşimi. Kasa ve banka ayrı tablodur ama
  // defterin sorusu ikisi için de aynıdır — tek listede toplanmazsa ekran
  // "hangi sekmedeydi" sorusunu operatöre sordurur.
  const accountsCte = Prisma.sql`
    acc AS (
      SELECT id::text AS id, 'CASH' AS "accountKind", code, name, currency::text AS currency,
             balance::text AS balance, "isActive"
        FROM cash_boxes
      UNION ALL
      SELECT id::text, 'BANK', code, name, currency::text, balance::text, "isActive"
        FROM bank_accounts
    )`;

  const [accountRows, openingRows, movementRows] = await Promise.all([
    prisma.$queryRaw<AccountRow[]>(Prisma.sql`
      WITH ${accountsCte}
      SELECT a.* FROM acc a WHERE TRUE ${fAccount} ${fKind}
    `),

    prisma.$queryRaw<OpeningRow[]>(Prisma.sql`
      WITH ${accountsCte}, ${movementsCte()}
      SELECT mv."accountId" AS "accountId",
             SUM(CASE WHEN mv.direction = 'IN' THEN mv.amount ELSE -mv.amount END)::text AS opening
        FROM mv JOIN acc a ON a.id = mv."accountId"
       WHERE mv.dt < ${from} ${fAccount} ${fKind}
       GROUP BY 1
    `),

    prisma.$queryRaw<MovementRow[]>(Prisma.sql`
      WITH ${accountsCte}, ${movementsCte()}
      SELECT mv.id, mv.source, mv."docNo" AS "docNo", mv.dt, mv."accountId" AS "accountId",
             mv.direction, mv.amount::text AS amount, mv.kind, mv.counterparty,
             mv.description, mv.reference, mv.cancelled
        FROM mv JOIN acc a ON a.id = mv."accountId"
       WHERE mv.dt >= ${from} AND mv.dt <= ${to} ${fAccount} ${fKind}
       -- İkincil anahtar id: aynı ana düşen iki hareketin sırası yoksa yürüyen
       -- bakiye her sorguda farklı çıkar ve defter "oynak" görünür.
       ORDER BY mv.dt ASC, mv.id ASC
       LIMIT ${MAX_ROWS + 1}
    `),
  ]);

  const rowsTruncated = movementRows.length > MAX_ROWS;
  const movements = rowsTruncated ? movementRows.slice(0, MAX_ROWS) : movementRows;

  const openingByAccount = new Map(openingRows.map((r) => [r.accountId, D(r.opening ?? 0)]));
  const movementsByAccount = new Map<string, MovementRow[]>();
  for (const m of movements) {
    const list = movementsByAccount.get(m.accountId) ?? [];
    list.push(m);
    movementsByAccount.set(m.accountId, list);
  }

  // Saklanan bakiye "şu an"dır; geçmiş bir kesitle karşılaştırmak tanım gereği
  // fark üretir. 60 sn tolerans: istemci "bugün 23:59:59.999" gönderdiğinde de
  // karşılaştırma yapılabilsin diye DEĞİL — `to` gerçekten şimdiyi ya da
  // geleceği gösteriyorsa anlamlıdır; saat kayması payı olarak bırakıldı.
  const storedComparable = to.getTime() >= Date.now() - 60_000;

  const accounts: CashBookAccountSummary[] = [];
  for (const a of accountRows) {
    const opening = openingByAccount.get(a.id) ?? D0();
    const list = movementsByAccount.get(a.id) ?? [];
    let totalIn = D0();
    let totalOut = D0();
    for (const m of list) {
      if (m.direction === "IN") totalIn = totalIn.plus(D(m.amount));
      else totalOut = totalOut.plus(D(m.amount));
    }
    const closing = opening.plus(totalIn).minus(totalOut);
    const stored = D(a.balance);

    // Hareketi de bakiyesi de olmayan pasif hesap listeyi şişirmesin.
    if (!params.includeInactive && !a.isActive && list.length === 0 && stored.isZero() && opening.isZero()) {
      continue;
    }

    accounts.push({
      accountId: a.id,
      accountKind: a.accountKind as CashAccountKind,
      code: a.code,
      name: a.name,
      currency: a.currency as Currency,
      isActive: a.isActive,
      opening: opening.toFixed(2),
      totalIn: totalIn.toFixed(2),
      totalOut: totalOut.toFixed(2),
      closing: closing.toFixed(2),
      storedBalance: stored.toFixed(2),
      storedDiff: storedComparable ? closing.minus(stored).toFixed(2) : null,
      movementCount: list.length,
    });
  }
  accounts.sort((x, y) => x.accountKind.localeCompare(y.accountKind) || x.code.localeCompare(y.code, "tr"));

  // YÜRÜYEN BAKİYE yalnız TEK hesapta anlamlıdır: iki hesabın hareketleri tek
  // sütunda toplanırsa çıkan sayı hiçbir hesabın bakiyesi olmaz (üstelik para
  // birimleri farklı olabilir).
  let rows: CashBookRow[] | null = null;
  if (params.accountId) {
    const opening = openingByAccount.get(params.accountId) ?? D0();
    let running = opening;
    rows = (movementsByAccount.get(params.accountId) ?? []).map((m) => {
      const amt = D(m.amount);
      const signed = m.direction === "IN" ? amt : amt.negated();
      running = running.plus(signed);
      return {
        id: m.id,
        source: m.source as CashBookRow["source"],
        docNo: m.docNo,
        date: m.dt.toISOString(),
        direction: m.direction as "IN" | "OUT",
        amount: amt.toFixed(2),
        signed: signed.toFixed(2),
        running: running.toFixed(2),
        kind: m.kind,
        counterparty: m.counterparty,
        description: m.description,
        reference: m.reference,
        cancelled: m.cancelled,
      };
    });
  }

  // TOPLAM SATIRI yalnız TEK PARA BİRİMİ varsa basılır — farklı para birimli
  // kasaların toplamı anlamsızdır ve "kasada 1.2 milyon var" gibi bir yalan
  // üretir (`CariBalance`'ın para birimi bazında tutulmasıyla aynı gerekçe).
  const currencies = new Set(accounts.map((a) => a.currency));
  const totals =
    currencies.size === 1
      ? {
          opening: accounts.reduce((s, a) => s.plus(D(a.opening)), D0()).toFixed(2),
          totalIn: accounts.reduce((s, a) => s.plus(D(a.totalIn)), D0()).toFixed(2),
          totalOut: accounts.reduce((s, a) => s.plus(D(a.totalOut)), D0()).toFixed(2),
          closing: accounts.reduce((s, a) => s.plus(D(a.closing)), D0()).toFixed(2),
        }
      : null;

  const notes: string[] = [
    "Devir, dönemden ÖNCEKİ hareketlerin toplamıdır (saklanan bakiyeden geriye hesaplanmaz) — böylece defter, bakiye kolonunun ikinci bir doğrulama yoludur.",
    "Çekin tahsile verilmesi (DEPOSIT) para hareketi değildir ve deftere girmez; yalnız TAHSİL (COLLECT) ve kendi çekimizin ÖDENMESİ (PAY) yazılır.",
    "İptal edilen belgeler defterde iki satırla görünür: belge tarihinde asıl hareket, iptal anında ters hareket.",
  ];
  if (!storedComparable) {
    notes.push(
      "Dönem sonu geçmiş bir tarih olduğu için kapanış ile kayıtlı bakiye KARŞILAŞTIRILMADI (kayıtlı bakiye her zaman “şu an”ı gösterir).",
    );
  }
  if (currencies.size > 1) {
    notes.push("Farklı para birimli hesaplar listelendiği için genel toplam basılmadı — her hesap kendi biriminde okunur.");
  }
  if (rowsTruncated) {
    notes.push(`Satır sayısı ${MAX_ROWS} ile sınırlandı — daha dar bir tarih aralığı seçin.`);
  }
  const drifted = accounts.filter((a) => a.storedDiff !== null && !D(a.storedDiff).isZero());
  if (drifted.length > 0) {
    notes.push(
      `⚠️ ${drifted.length} hesapta defter toplamı ile kayıtlı bakiye UYUŞMUYOR (${drifted
        .map((a) => `${a.code}: ${a.storedDiff}`)
        .join(", ")}). Bir hareket kaynağı eksik ya da bakiyeye elle dokunulmuş olabilir.`,
    );
  }

  return { accounts, rows, rowsTruncated, storedComparable, totals, notes };
}
