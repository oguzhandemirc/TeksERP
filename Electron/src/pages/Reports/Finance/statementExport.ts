// =============================================================================
// CARİ EKSTRE — dışa aktarım spec'i (TEK spec → Excel + PDF + Yazdır)
// =============================================================================
// ⚠️ Üç çıktı AYRI AYRI YAZILMAZ. Bu projede bir kez "aynı başlık altında farklı
// rakam" yaşandı (kök CLAUDE.md'deki "aynı sevkiyat üç ekranda üç şey söyledi"
// vakası); bekçi (`statementExport.test.ts` §1) Excel kolonları ile PDF
// başlıklarının eşitliğini MEKANİK doğrular.
//
// ⚠️ TEK KOLON KÜMESİ, İKİ EKRAN. Ekstrenin iki yüzeyi var — rapor yüzeyi
// (`Reports/Finance/CariStatementDialog`, `report:finance`) ve ön muhasebe
// yüzeyi (`Finance/StatementDialog`, `finance:read`) — ve ekrandaki tabloları
// bir kolon farkla ayrışıyor: ilkinde "Kaynak" sütunu var, ikincisinde yok.
// DIŞA AKTARIM İKİSİNDE DE AYNIDIR ve "Kaynak"ı BASAR:
//   • veri İKİ uçta da dönüyor (`StatementRow.sourceType` her iki serviste de
//     zorunlu alan) — yani uydurulan bir şey yok, yalnız çizilmeyen bir şey var;
//   • aynı carinin aynı dönemi için "Cari Ekstre" başlıklı İKİ FARKLI dosya
//     dolaşıma girerse hangisinin eksik olduğu dosyanın kendisinden anlaşılamaz.
// Bekçi bu kararı kilitler (§2): iki ekranın başlıkları kaynaktan okunur, rapor
// yüzeyiyle BİREBİR eşitlik ve ön muhasebe yüzeyiyle tek farkın "Kaynak" olduğu
// doğrulanır. Ekranlardan birine kolon eklenirse test kırmızı verir.
//
// ⚠️ DEVİR SATIRI OPSİYONEL DEĞİL — ilk satırdır. Dönem başından ÖNCEKİ tüm
// hareketlerin toplamıdır; olmadan dosyadaki en çok bakılan sayı (kapanış
// bakiyesi) satırlar toplanarak DOĞRULANAMAZ ve okuyucu "rapor tutmuyor" der.
//
// ⚠️ Excel hücresine `toNum` ile SAYI konur (string'e `numFmt` UYGULANMAZ, hücre
// metne düşer ve muhasebeci üzerinde toplama yapamaz — dosyayı indirmesinin tek
// sebebi odur). Dönüşüm tek değer üzerindedir, toplama YAPILMAZ: dosyadaki her
// toplam backend'in gönderdiği rakamdır.
//
// ⚠️ PARA BİRİMİ TEKTİR ve bu dosyada YAZILI: ekstre tek para biriminde tutulur
// ("hepsi" seçeneği bilinçli olarak yok — iki para birimini tek yürüyen bakiyede
// toplamak anlamsızdır). Dosyayı açan kişi bunu bilmezse eksik bir defter gördüğünü
// fark etmez.
// =============================================================================

import type { ReportColumn, ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import { formatDayKey } from "../../Finance/PeriodClose/service";
import { CARI_TXN_SOURCE_LABEL, toNum, type Currency } from "./service";

const MONEY = "#,##0.00";

/** Backend farkını yutan nötr satır — iki ekstre ucu tutarları string/number döner. */
export interface StatementExportRow {
  txnDate: string;
  docNo: string | null;
  sourceType: string;
  description: string | null;
  debit: string | number;
  credit: string | number;
  running: string | number;
}

export interface StatementExportInput {
  /** Süzgeç satırları (K10) — ekrandakiyle AYNI dizi. */
  filterNotes?: string[];
  cariName: string;
  /**
   * Cari kodu — varsa başlık satırında parantez içinde basılır, YOKSA hiç
   * basılmaz (uydurulmaz). Rapor yüzeyi bugün kodu taşımıyor: `StatementTarget`
   * yalnız `{cariId, name, currency}` alıyor (bkz. dosya sonundaki dikiş notu).
   */
  cariCode?: string | null;
  currency: Currency;
  /** Ekrandaki tarih girdisi değerleri (YYYY-MM-DD) — ne yazıyorsa o. */
  fromYmd: string;
  toYmd: string;
  opening: string | number;
  closing: string | number;
  totalDebit: string | number;
  totalCredit: string | number;
  /** Devir MÜHÜRLÜ kapanıştan kuruluysa dolu (K5) — yoksa not düz toplamı söyler. */
  carriedFrom?: { periodEnd: string; closingBalance: string | number } | null;
  rows: StatementExportRow[];
}

/**
 * `YYYY-MM-DD` → `GG.AA.YYYY`.
 *
 * ⚠️ `new Date("2026-08-14")` KULLANILMAZ: ECMAScript bu metni **UTC gece
 * yarısı** sayar ve negatif UTC farkı olan bir makinede gün BİR GERİ kayar —
 * dosyanın kapağındaki dönem, içindeki hareketlerle çelişirdi. Parçalardan
 * kurmak belirsizliği tamamen ortadan kaldırır (`Cheques/dates.ts` emsali).
 */
function fmtYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ymd;
}

/** Hareket tarihi — mutlak an, `tr-TR` (ekrandaki `fmtDate` ile aynı biçim). */
function fmtInstant(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR");
}

/**
 * Borç/alacak hücresi. SIFIR yerine BOŞ bırakılır: her hareket satırında iki
 * kolondan biri tanım gereği sıfırdır ve sıfırlarla dolu bir ekstre okunmaz
 * (ekranda da boş basılıyor — `isZeroAmount` dalı).
 *
 * ⚠️ Bakiye/toplam kolonlarında bu YAPILMAZ: orada 0 bir TUTARDIR ("borcu yok"),
 * boş hücre ise "bilinmiyor" diye okunur.
 */
function sideCell(value: string | number | null | undefined): number | "" {
  const n = toNum(value);
  return n === 0 ? "" : n;
}

const COLUMNS: ReportColumn[] = [
  { header: "Tarih", key: "date", width: 12 },
  { header: "Belge", key: "docNo", width: 18 },
  { header: "Kaynak", key: "source", width: 18 },
  { header: "Açıklama", key: "description", width: 40 },
  { header: "Borç", key: "debit", width: 15, numFmt: MONEY, align: "right" },
  { header: "Alacak", key: "credit", width: 15, numFmt: MONEY, align: "right" },
  { header: "Bakiye", key: "running", width: 16, numFmt: MONEY, align: "right" },
];

export function buildStatementExport(input: StatementExportInput): ReportExportSpec {
  const { cariName, cariCode, currency, fromYmd, toYmd, rows, filterNotes = [] } = input;
  const periodLabel = `${fmtYmd(fromYmd)} – ${fmtYmd(toYmd)}`;

  const meta = [
    ...filterNotes,
    `Cari: ${cariName}${cariCode ? ` (${cariCode})` : ""}`,
    `Para birimi: ${currency} — ekstre TEK para biriminde tutulur; carinin başka para birimindeki hareketleri bu dosyada YOKTUR.`,
    "Bakiye pozitifse cari size borçludur, negatifse siz ona borçlusunuz.",
  ];

  return {
    title: "Cari Ekstre",
    subtitle: `${periodLabel} · ${currency}`,
    meta,
    tables: [statementTable(input, periodLabel)],
  };
}

function statementTable(input: StatementExportInput, periodLabel: string): ReportTableSpec {
  const { rows, carriedFrom } = input;

  // DEVİR — tablonun İLK satırı (ekrandaki yerleşimin aynısı). Tarih/belge
  // hücreleri boş: devir bir hareket değil, bir toplamdır.
  const openingRow: Record<string, unknown> = {
    date: "",
    docNo: "",
    source: "",
    description: `Dönem devri (${fmtYmd(input.fromYmd)} öncesi)`,
    debit: "",
    credit: "",
    running: toNum(input.opening),
  };

  const movementRows = rows.map((r) => ({
    date: fmtInstant(r.txnDate),
    docNo: r.docNo ?? "",
    // Etiketi olmayan yeni bir `CariTxnSource` değeri HAM ENUM basar — sessizce
    // boş bırakmaktansa okunur ama çirkin olsun (sözlük eksiği böyle görülür).
    source: CARI_TXN_SOURCE_LABEL[r.sourceType] ?? r.sourceType,
    description: r.description ?? "",
    debit: sideCell(r.debit),
    credit: sideCell(r.credit),
    running: toNum(r.running),
  }));

  const notes: string[] = [
    carriedFrom
      ? `Dönem devri ${formatDayKey(carriedFrom.periodEnd)} kapanışının MÜHÜRLÜ bakiyesinden kurulmuştur (o günden dönem başına kadarki hareketler dahildir).`
      : "Dönem devri = dönem başından ÖNCEKİ tüm hareketlerin toplamıdır.",
    `Dönem: ${periodLabel}. Devir satırı + hareketler = dönem toplamı satırındaki kapanış bakiyesi.`,
  ];
  if (rows.length === 0) {
    // Ekranın söylediği cümlenin aynısı. Boş bir tablo "veri gelmedi" diye
    // okunur; oysa gerçek şudur: dönemde hareket yok ve bakiye devirden geliyor.
    notes.push("Bu dönemde hareket yok — bakiye devirden geliyor.");
  }

  return {
    name: "Cari Ekstre",
    columns: COLUMNS,
    rows: [openingRow, ...movementRows],
    totalRow: {
      date: "",
      docNo: "",
      source: "",
      description: "DÖNEM TOPLAMI",
      // Toplamlarda 0 BASILIR (bkz. `sideCell` uyarısı): "bu dönemde borç
      // hareketi olmadı" ile "bilinmiyor" farklı cümlelerdir.
      debit: toNum(input.totalDebit),
      credit: toNum(input.totalCredit),
      running: toNum(input.closing),
    },
    notes,
  };
}

// -----------------------------------------------------------------------------
// DİKİŞ NOTU (kapsam dışı, bilinçli)
// -----------------------------------------------------------------------------
// Rapor yüzeyinden alınan dosyanın kapağında bugün yalnız cari ADI yazıyor.
// `StatementTarget.code` alanı HAZIR ve diyalog onu spec'e geçiriyor; eksik olan
// tek şey hedefi KURAN satır: `AgingReportPage.tsx`'te
// `setStatementTarget({ cariId: r.cariId, name: r.name, currency: r.currency })`
// çağrısına `code: r.code` eklenince kod kendiliğinden basılır (yaşlandırma
// satırı kodu zaten taşıyor). O dosya bu işin sahipliğinde değil; alan opsiyonel
// olduğu için mevcut çağrı dokunulmadan derlenmeye devam eder ve buraya sahte
// bir değer YAZILMADI: uydurulmuş kod, eksik koddan kötüdür.
