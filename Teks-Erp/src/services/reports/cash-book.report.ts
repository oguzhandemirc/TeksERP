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
//   3) `ChequeEvent`     — COLLECT (+) · PAY (−) · stornoları COLLECT_CANCEL (−) ·
//                          PAY_CANCEL (+); küme `cheque-cash-events.helper`
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
// ── DEVİR: SAKLANAN BİR SAYIDAN DEĞİL, HAREKETLERDEN — VE MÜHÜR VARSA MÜHÜRDEN ─
// Açılış bakiyesi `CashBox.balance`'tan geriye doğru hesaplanmaz; dönemden
// ÖNCEKİ hareketlerin toplamıdır. Böylece defter, denormalize bakiye kolonunun
// İKİNCİ bir yolu olur: `storedDiff` sıfır değilse ya bir yazar unutulmuş ya
// bakiyeye elle dokunulmuştur — ikisi de sessiz kalmamalı.
//
// K-1 OKUMA YOLU (2026-08-14, K5'in kasa yarısı): hesabın `from`'dan önce biten
// AKTİF bir dönem kapanışı (`CashPeriodClose`) varsa devir artık tüm geçmişin
// yeniden toplanmasıyla DEĞİL, `resolveCashBookOpening` üç adımıyla kurulur —
// kapanışın MÜHÜRLÜ rakamı + kapanıştan dönem başına kadarki hareketler. Bu bir
// performans oyunu değil DOĞRULUK beyanıdır: kapanmış dönemin resmi rakamı ile
// defter deviri tek kaynaktan gelir; kapanıştan sonra geçmişe sızmış bir satır
// (guard atlaması) devri sessizce değiştiremez — fark `storedDiff`te ve
// kapanışın `verify`inde GÖRÜNÜR. Kapanışı olmayan hesapta bugünkü CTE yolu
// bayt-bayt korunur (bekçi: `test_cash_period_close` §11).
// ⚠️ `verify` BİLEREK yeniden hesaplar (drift alarmı bağımsız türetim ister) —
// onu mühre bağlama; mühürden okuyan yol yalnız bu SUNUM yüzeyidir.
//
// ⚠️ `storedDiff` YALNIZ dönem sonu BUGÜNÜ KAPSIYORSA anlamlıdır: saklanan
// bakiye her zaman "şu an"dır, geçmiş bir kesitle karşılaştırmak tanım gereği
// fark üretir. Kapsamıyorsa `null` döner (0 değil — "ölçülemedi" ile "sapma
// yok" ayrı şeylerdir).
//
// ⚠️ Tutarlar JSON'a STRING olarak çıkar (2 hane) — `finance-aging.report.ts`
// ile aynı gerekçe (float toplamı kuruş kaydırır).
//
// ── KATEGORİ KIRILIMI: "bu para NEREDEN geldi / NEREYE gitti" (H7) ───────────
// Defter satır satır DOĞRUdur ama "geçen ay 40 bin nereye gitti" sorusunu
// cevaplayamaz; kırılım o soruyu tek blokta yanıtlar. Dört kova tipi vardır ve
// AYRIMIN TEK ÖLÇÜTÜ ŞUDUR: *kaydın kendi kategori alanı var mı*.
//   • `CashTransaction` (masraf/gelir/açılış) — KENDİ serbest `category`
//     metniyle gruplanır; boş bırakılmışsa "Kategorisiz" (operatör doldurabilir,
//     yani bu bir EKSİKLİK bildirimidir).
//   • `Payment` ve `ChequeEvent` — tek kova. Bu iki tabloda kategori alanı
//     YOKTUR; onları "Kategorisiz"e atmak, hiç sorulmamış bir sorunun
//     cevapsızlığını operatörün hatası gibi göstermek olurdu (uydurma).
//   • ⚠️ VİRMAN (TRANSFER_OUT/TRANSFER_IN) da AYRI KOVA — `CashTransaction`
//     satırı olmasına rağmen. Sebep aynı ölçüt: `transfer()` ucu `category`
//     KABUL ETMEZ (`TransferInput`'ta alan yok), yani virman satırı hiçbir
//     zaman kategori taşıyamaz ve "Kategorisiz" orada DÜZELTİLEMEZ bir suçlama
//     olurdu. Üstelik virman bir kaynak/kullanım değil, kendi hesaplarımız
//     arasında aktarımdır: "5.000 harcandı, kategorisi girilmemiş" diye okunması
//     rakamın kendisini yanlışlar.
//
// ⚠️ İPTAL KIRILIMDA NETLEŞİR ve bu, satır listesindeki "iki satır" kuralının
// doğal sonucudur: `CASH_TXN_CANCEL` ters satırı ASLININ kategorisini taşır
// (CTE'de `ct.category`, `cancelReason` DEĞİL), böylece 700 TL "Nakliye" gideri
// iptal edilince kova `çıkan 700 / giren 700 / net 0` gösterir. Ters satıra
// kategori taşınmasaydı iptal "Kategorisiz"e düşer, gider kovası şişmiş kalır
// ve kırılım ile defter toplamı aynı kalsa bile kırılım YANLIŞ olurdu.
//
// ⚠️ KIRILIM AYRI SORGUDAN DEĞİL, ÖZETİ ÜRETEN AYNI SATIR KÜMESİNDEN türetilir
// (Sınıf 5 — tek kaynak satır kuralı). Ayrı bir `GROUP BY` sorgusu daha "doğru"
// görünürdü ama `MAX_ROWS` kırpması yalnız satır sorgusuna uygulandığı için
// kırpılmış bir dönemde kırılım ile hesap özeti AYRIŞIRDI: aynı ekranda iki
// farklı "dönem girişi" rakamı. Mutabakat (`Σ kova = Σ hesap`) bu yüzden
// yapısaldır, tesadüf değil — bekçi onu kilitler.
//
// ⚠️ KIRILIM PARA BİRİMİ BAZINDADIR, bu yüzden hesap seçilmeden de anlamlıdır
// (yürüyen bakiyenin aksine). Farklı para birimli kasaların TL'siz toplanması
// `totals`'ta nasıl yasaksa burada da öyle: TRY "Kira" ile USD "Kira" AYRI
// satırdır.
//
// ⚠️ SERBEST METİN AYNEN GRUPLANIR — büyük/küçük harf katlanmaz. "Kira" ile
// "kira"nın iki satır çıkması bir kusur değil, kataloğun zamanı geldiğini
// söyleyen SİNYALDİR (yol haritası: "katalog kararı veri birikince"); katlamak
// tam da beklenen o sinyali gizlerdi. Ayrıca Türkçe yerelde büyük harfe çevirme
// kimlik bozar (`showIf` dersi: "1.kalite" → "1.KALİTE"). Yalnız `trim`
// uygulanır (yazma yolu zaten trim'liyor; bu, ham SQL/seed ile girmiş satırlara
// karşı ikinci hat).
// =============================================================================

import { Prisma, Currency } from "@prisma/client";
import prisma from "../../lib/prisma";
import { D, D0 } from "../helpers/finance.helper";
import { cashPeriodCloseService } from "../cash-period-close.service";
import { formatDayKeyTr, periodDayKey } from "../helpers/period-guard.helper";
import {
  chequeCashEventTypesSql,
  chequeCashInflowSql,
  chequeCashReversalSql,
} from "../helpers/cheque-cash-events.helper";
import type { DateRange } from "./_shared";
import type { SuzgecEcho } from "./_filters";

/** Tek sayfada basılabilir satır tavanı — aşılırsa kırpılır ve SÖYLENİR. */
const MAX_ROWS = 5000;

export type CashAccountKind = "CASH" | "BANK";

export interface CashBookParams {
  range: DateRange;
  /**
   * Kova süzgeci — YALNIZ `rows` dökümünü daraltır (özet ve kategoriler dönem
   * gerçeğidir). Gerekçe aşağıda `suzgec` alanında.
   */
  kategori?: CashCategoryGroup;
  /** Yön süzgeci — aynı sözleşme: yalnız `rows`. */
  yon?: "IN" | "OUT";
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
  /**
   * Devrin dayandığı aktif dönem kapanışının son günü (ISO, `@db.Date` anahtarı)
   * — hesap o güne kadar MÜHÜRLÜDÜR ve devir o kapanışın rakamından kurulmuştur.
   * Kapanış yoksa `null` (devir tüm geçmişin toplamı — bugünkü yol).
   */
  sealedThrough: string | null;
}

/** Kırılım kovasının TİPİ — etiketi değil, hangi kuraldan doğduğunu söyler. */
export type CashCategoryGroup = "CASH_TXN" | "TRANSFER" | "PAYMENT" | "CHEQUE";

export interface CashBookCategoryRow {
  /**
   * Gruplama anahtarı — kasa hareketinde `CAT:<metin>`, diğerlerinde kova tipi.
   * İstemci satırı bununla eşler; `label` gösterim metnidir ve kategori yeniden
   * adlandırılırsa değişir.
   */
  key: string;
  label: string;
  group: CashCategoryGroup;
  currency: Currency;
  totalIn: string;
  totalOut: string;
  /** totalIn − totalOut. İptal çifti aynı kovaya ters yönde düştüğü için 0'lar. */
  net: string;
  movementCount: number;
}

export interface CashBookReport {
  accounts: CashBookAccountSummary[];
  /**
   * Dönem hareketlerinin KAYNAK kırılımı (para birimi bazında). Hesap
   * seçilmeden de doludur — `rows`'un aksine çok hesapta da anlamlıdır.
   * Σ(`totalIn`) = Σ(hesap `totalIn`), aynısı `totalOut` için (dosya başlığı).
   */
  categories: CashBookCategoryRow[];
  /** Yalnız tek hesap seçiliyse dolu — çok hesapta yürüyen bakiye anlamsızdır. */
  rows: CashBookRow[] | null;
  rowsTruncated: boolean;
  /** Dönem sonu "şu an"ı kapsıyor mu — `storedDiff`in ölçülebilirlik koşulu. */
  storedComparable: boolean;
  totals: { opening: string; totalIn: string; totalOut: string; closing: string } | null;
  notes: string[];
  /**
   * YALNIZ süzgeçliyken dolar; süzgeçsiz gövde bayt bayt eski.
   *
   * ⚠️ SÜZGEÇ YALNIZ `rows`a UYGULANIR ve bu bir eksiklik değil, defterin
   * tanımıdır: `running` "o satırdan SONRAKİ bakiye"dir ve BÜTÜN hareketlerden
   * doğar. Süzgeç SQL'e inseydi kolon "doğru görünen ama yanlış" bir bakiye
   * basardı — süzülen hareketler bakiyeyi yine değiştirmiş olurdu. Aynı sebeple
   * @suzgec-ozet-degismez — özet/bakiye süzgeçten ETKİLENMEZ.
   * `accounts`/`categories`/`totals` DÖNEM GERÇEĞİ olarak süzgeçsiz kalır:
   * kasadaki para, kullanıcının ekranda neyi seçtiğine göre değişmez.
   */
  suzgec?: SuzgecEcho;
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
  /** Yalnız `CashTransaction` kaynaklı satırlarda dolu (ters satırda ASLININ). */
  category: string | null;
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
             (p.status = 'CANCELLED')                          AS cancelled,
             -- ⚠️ Kategori alanı payments tablosunda YOK. Buradaki NULL
             -- "operatör boş bıraktı" DEĞİL "böyle bir soru sorulmadı"
             -- demektir; kırılım bu satırları Kategorisiz'e değil kendi
             -- kovasına koyar. (SQL şablonunda BACKTICK kullanma — template
             -- literal'ı ortadan böler, dosya derlenmez.)
             NULL::text                                        AS category
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
             COALESCE(p."cancelReason", 'İptal'), p.reference, TRUE, NULL::text
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
             (ct.status = 'CANCELLED'), ct.category
        FROM cash_transactions ct
       WHERE COALESCE(ct."cashBoxId", ct."bankAccountId") IS NOT NULL

      UNION ALL
      -- 2b) KASA HAREKETİ İPTALİ
      SELECT ct.id::text || ':C', 'CASH_TXN_CANCEL', ct."docNo", ct."cancelledAt",
             COALESCE(ct."cashBoxId", ct."bankAccountId")::text,
             CASE WHEN ct.direction = 'IN' THEN 'OUT' ELSE 'IN' END,
             ct.amount, ct.kind::text, NULL,
             COALESCE(ct."cancelReason", 'İptal'), ct.reference, TRUE,
             -- ⚠️ ASLININ kategorisi (cancelReason DEĞİL) — iptal çiftinin
             -- kırılımda netleşmesi tam olarak buna dayanır (dosya başlığı).
             ct.category
        FROM cash_transactions ct
       WHERE ct.status = 'CANCELLED' AND ct."cancelledAt" IS NOT NULL
         AND COALESCE(ct."cashBoxId", ct."bankAccountId") IS NOT NULL

      UNION ALL
      -- 3) ÇEK OLAYI — yalnız PARA HAREKETİ olanlar; küme, yön ve storno işareti
      -- CHEQUE_EVENT_CASH_EFFECT'ten (measureTx/§23-§24 ile AYNI evren). Storno
      -- satırı cancelled işareti taşır — Payment/CashTransaction iptaliyle aynı.
      SELECT e.id::text, 'CHEQUE', ch."docNo", e."eventDate",
             COALESCE(e."cashBoxId", e."bankAccountId")::text,
             CASE WHEN ${Prisma.raw(chequeCashInflowSql("e"))} THEN 'IN' ELSE 'OUT' END,
             ch.amount, e.type::text, COALESCE(cu2.name, sc2.name),
             e.notes, ch."serialNo", (${Prisma.raw(chequeCashReversalSql("e"))}), NULL::text
        FROM cheque_events e
        JOIN cheques ch ON ch.id = e."chequeId"
        JOIN cari_accounts ca2 ON ca2.id = ch."cariId"
        LEFT JOIN customers cu2 ON cu2.id = ca2."customerId"
        LEFT JOIN subcontractors sc2 ON sc2.id = ca2."subcontractorId"
       WHERE e.type IN (${Prisma.raw(chequeCashEventTypesSql())})
         AND COALESCE(e."cashBoxId", e."bankAccountId") IS NOT NULL
    )`;
}

const UNCATEGORIZED_LABEL = "Kategorisiz";

/** Kategori alanı OLMAYAN kaynakların sabit kovaları (dosya başlığı: ayrım ölçütü). */
const FIXED_BUCKET_LABEL: Record<Exclude<CashCategoryGroup, "CASH_TXN">, string> = {
  PAYMENT: "Tahsilat / Ödeme (carili)",
  CHEQUE: "Çek tahsil / ödeme",
  TRANSFER: "Virman (hesaplar arası)",
};

/**
 * Virmanın İKİ bacağı da kendi kovasına düşer. Ters (iptal) satırda `kind`
 * ASLININ türüdür — yalnız `direction` çevrilir — yani iptal edilmiş bir virman
 * da aynı kovada netleşir.
 */
const TRANSFER_KINDS = new Set(["TRANSFER_OUT", "TRANSFER_IN"]);

/** Hareketi TEK kovaya eşler. Sıra load-bearing: kaynak → tür → kategori metni. */
function bucketOf(m: MovementRow): { key: string; label: string; group: CashCategoryGroup } {
  if (m.source === "PAYMENT" || m.source === "PAYMENT_CANCEL") {
    return { key: "PAYMENT", label: FIXED_BUCKET_LABEL.PAYMENT, group: "PAYMENT" };
  }
  if (m.source === "CHEQUE") {
    return { key: "CHEQUE", label: FIXED_BUCKET_LABEL.CHEQUE, group: "CHEQUE" };
  }
  if (m.kind !== null && TRANSFER_KINDS.has(m.kind)) {
    return { key: "TRANSFER", label: FIXED_BUCKET_LABEL.TRANSFER, group: "TRANSFER" };
  }
  // Serbest metin AYNEN (yalnız trim) — harf katlama yok, gerekçe dosya başlığında.
  const text = (m.category ?? "").trim();
  return { key: text ? `CAT:${text}` : "CAT:", label: text || UNCATEGORIZED_LABEL, group: "CASH_TXN" };
}

export async function getCashBookReport(params: CashBookParams): Promise<CashBookReport> {
  const { from, to } = params.range;
  const suzgecVar = params.kategori !== undefined || params.yon !== undefined;

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
             mv.description, mv.reference, mv.cancelled, mv.category
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

  // ── DEVİR MÜHRE BAĞLANIR (dosya başlığı: "K-1 OKUMA YOLU") ─────────────────
  // `from`'un gününden önce biten aktif kapanışı olan HER hesabın deviri
  // `resolveCashBookOpening` ile (mühürlü rakam + pencere) yeniden kurulur ve
  // CTE toplamının ÜZERİNE yazılır. Kapanışı olmayan hesapta harita satırına
  // DOKUNULMAZ — mühürsüz kurulumda tek ek sorgu boş dönen `findMany`dir ve
  // çıktı bugünküyle bayt-bayt aynıdır. Sıralı `await` bilinçli: hesap sayısı
  // master-data ölçeğindedir (birkaç kasa/banka) ve tx yok.
  const fromKey = periodDayKey(from);
  const sealedThroughByAccount = new Map<string, Date>();
  const sealedBoxIds = accountRows.filter((a) => a.accountKind === "CASH").map((a) => a.id);
  const sealedBankIds = accountRows.filter((a) => a.accountKind === "BANK").map((a) => a.id);
  if (sealedBoxIds.length > 0 || sealedBankIds.length > 0) {
    const activeCloses = await prisma.cashPeriodClose.findMany({
      where: {
        reopenedAt: null,
        periodEnd: { lt: fromKey },
        OR: [{ cashBoxId: { in: sealedBoxIds } }, { bankAccountId: { in: sealedBankIds } }],
      },
      select: { cashBoxId: true, bankAccountId: true },
    });
    const sealedIds = new Set(activeCloses.map((c) => (c.cashBoxId ?? c.bankAccountId) as string));
    for (const a of accountRows) {
      if (!sealedIds.has(a.id)) continue;
      const ref = a.accountKind === "CASH" ? { cashBoxId: a.id } : { bankAccountId: a.id };
      const resolved = await cashPeriodCloseService.resolveCashBookOpening(ref, from);
      // `carriedFrom` teorik olarak daima dolu (hesap az önce mühürlü bulundu);
      // yarışta kapanış tam bu arada yeniden açıldıysa CTE deviri zaten doğrudur.
      if (resolved.carriedFrom) {
        openingByAccount.set(a.id, resolved.opening);
        sealedThroughByAccount.set(a.id, resolved.carriedFrom.periodEnd);
      }
    }
  }
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
      sealedThrough: sealedThroughByAccount.get(a.id)?.toISOString() ?? null,
    });
  }
  accounts.sort((x, y) => x.accountKind.localeCompare(y.accountKind) || x.code.localeCompare(y.code, "tr"));

  // ── KATEGORİ KIRILIMI ─────────────────────────────────────────────────────
  // Kaynak, hesap özetini üreten `movements` dizisinin TA KENDİSİ (Sınıf 5).
  // Kapsam da özetle birebir: yalnız `accounts`'a giren hesapların hareketleri
  // sayılır — böylece "Σ kova = Σ hesap" eşitliği, listeleme süzgeci ileride
  // değişse bile YAPISAL kalır (bugün elenen hesapların zaten hareketi yok).
  const currencyOfIncluded = new Map(accounts.map((a) => [a.accountId, a.currency]));
  const buckets = new Map<
    string,
    { key: string; label: string; group: CashCategoryGroup; currency: Currency; in: Prisma.Decimal; out: Prisma.Decimal; count: number }
  >();
  for (const m of movements) {
    const currency = currencyOfIncluded.get(m.accountId);
    if (currency === undefined) continue;
    const b = bucketOf(m);
    // Para birimi anahtarın PARÇASI: TRY "Kira" ile USD "Kira" toplanmaz.
    const mapKey = `${currency}|${b.key}`;
    const entry = buckets.get(mapKey) ?? { ...b, currency, in: D0(), out: D0(), count: 0 };
    const amt = D(m.amount);
    if (m.direction === "IN") entry.in = entry.in.plus(amt);
    else entry.out = entry.out.plus(amt);
    entry.count += 1;
    buckets.set(mapKey, entry);
  }
  const categories: CashBookCategoryRow[] = [...buckets.values()]
    // Sıra: para birimi → HACİM (giren+çıkan) azalan → ad. Hacim, "bu dönemde
    // en çok neye dokunuldu" sorusunun cevabıdır; nete göre sıralamak iptalle
    // netleşmiş büyük bir kovayı listenin dibine atardı. Ad, eşitlikte
    // determinizm içindir (aynı sorgu her koşumda aynı sırayı basmalı).
    .sort(
      (x, y) =>
        x.currency.localeCompare(y.currency) ||
        y.in.plus(y.out).comparedTo(x.in.plus(x.out)) ||
        x.label.localeCompare(y.label, "tr"),
    )
    .map((b) => ({
      key: b.key,
      label: b.label,
      group: b.group,
      currency: b.currency,
      totalIn: b.in.toFixed(2),
      totalOut: b.out.toFixed(2),
      net: b.in.minus(b.out).toFixed(2),
      movementCount: b.count,
    }));

  // YÜRÜYEN BAKİYE yalnız TEK hesapta anlamlıdır: iki hesabın hareketleri tek
  // sütunda toplanırsa çıkan sayı hiçbir hesabın bakiyesi olmaz (üstelik para
  // birimleri farklı olabilir).
  let rows: CashBookRow[] | null = null;
  let droppedRows = 0;
  if (params.accountId) {
    const opening = openingByAccount.get(params.accountId) ?? D0();
    let running = opening;
    // ⚠️ SIRA LOAD-BEARING: `running` ÖNCE bütün hareketlerden yürütülür, süzgeç
    // SONRA uygulanır. Ters sırada (önce süzüp sonra yürütmek) kolon süzgece göre
    // değişen bir "bakiye" basardı ve o bakiye hiçbir hesabın bakiyesi olmazdı.
    // Süzgeçli listede `running` ATLAYARAK ilerler — bu DOĞRUDUR ve nota yazılır.
    rows = (movementsByAccount.get(params.accountId) ?? []).flatMap((m) => {
      const amt = D(m.amount);
      const signed = m.direction === "IN" ? amt : amt.negated();
      running = running.plus(signed);
      if (suzgecVar && !(
        (params.kategori === undefined || bucketOf(m).group === params.kategori)
        && (params.yon === undefined || m.direction === params.yon)
      )) { droppedRows++; return []; }
      return [{
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
      }];
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
    // Mühür notu koşullu — mühürsüz kurulumda yanıt bugünküyle birebir kalsın.
    ...(params.accountId && sealedThroughByAccount.has(params.accountId)
      ? [
          `Devir, ${formatDayKeyTr(sealedThroughByAccount.get(params.accountId) as Date)} dönem kapanışının MÜHÜRLÜ rakamından alındı — hesap o güne kadar mühürlüdür; kapanıştan dönem başına kadarki hareketler üstüne eklendi.`,
        ]
      : []),
    "Çekin tahsile verilmesi (DEPOSIT) para hareketi değildir ve deftere girmez; yalnız TAHSİL (COLLECT) ve kendi çekimizin ÖDENMESİ (PAY) yazılır.",
    "İptal edilen belgeler defterde iki satırla görünür: belge tarihinde asıl hareket, iptal anında ters hareket.",
    // Kırılım notu KOŞULLU: hareketi olmayan dönemde blok da çizilmiyor, notu
    // basmak "eksik bir şey mi var" sorusunu boş yere sordururdu.
    ...(categories.length > 0
      ? [
          "Kategori kırılımı hareketin KAYNAĞINA göre toplanır: kasa hareketleri kendi kategori metniyle (boş bırakılmışsa “Kategorisiz”), carili tahsilat/ödemeler ve çek tahsil/ödemeleri kendi tek kovalarında — bu kayıtlarda kategori alanı yoktur, uydurulmaz. Virman kendi hesaplarımız arasında aktarım olduğu için ayrı kovadadır.",
          "Kırılımda iptal NETLEŞİR: ters satır aslının kategorisine ters yönde düşer, yani iptal edilmiş bir gider kovada “giren = çıkan, net 0” olarak görünür. Kova toplamları dönemin giren/çıkan toplamına eşittir.",
        ]
      : []),
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

  if (suzgecVar) {
    notes.push(
      "SÜZGEÇ AÇIK: aşağıdaki DÖKÜM daraltıldı, ÖZET ve KATEGORİ kırılımı dönemin TAMAMIDIR — " +
        "kasadaki para ekranda neyi seçtiğinize göre değişmez. Yürüyen bakiye bütün hareketlerden " +
        "yürütülür, bu yüzden süzgeçli listede ATLAYARAK ilerler (doğrudur).",
    );
  }
  return {
    accounts, categories, rows, rowsTruncated, storedComparable, totals, notes,
    ...(suzgecVar
      ? { suzgec: { ...(params.kategori ? { kategori: params.kategori } : {}), ...(params.yon ? { yon: params.yon } : {}), dusenSatir: droppedRows } }
      : {}),
  };
}
