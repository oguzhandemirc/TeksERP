// =============================================================================
// ÇEK / SENET PORTFÖYÜ — dışa aktarım spec'i (TEK spec → Excel + PDF + Yazdır)
// =============================================================================
// ⚠️ Üç çıktı AYRI AYRI YAZILMAZ (`Reports/_components/reportExport.ts` başlığı):
// tek `ReportExportSpec`'ten türeyen Excel, PDF ve yazıcı çıktısı ayrışamaz.
//
// ⚠️ KOLONLAR EKRANDAKİ TABLONUN AYNISIDIR — ama İKİ BİLGİ TAŞIYAN HÜCRE
// BÖLÜNÜR. `ChequeTable` yerden kazanmak için bir hücreye iki veri koyuyor
// ("İşlem: … / Keşide: …", "Keşideci / Banka", tutarın altında TL karşılığı…).
// Ekranda bu doğru; Excel'de DEĞİL: iki tarih taşıyan bir hücre sıralanamaz,
// süzülemez ve tarih olarak toplanamaz — dosyayı indirmenin tek sebebi odur.
// Bu yüzden eşleme ekran başlığı → BİR YA DA DAHA FAZLA kolon şeklindedir ve
// bekçi (`chequeExport.test.ts` §2) onu kaynaktan okuyup MEKANİK doğrular:
// tabloya kolon eklenirse ya da buradan bir kolon düşerse test kırmızı verir.
//
// ⚠️ İŞLEM ≠ KEŞİDE (SINIF 1). İşlem tarihi defterin/belge numarasının/kurun
// çıpasıdır; keşide tarihi kâğıdın üzerindeki hukuki gündür ve defteri
// ETKİLEMEZ. Tek "Tarih" kolonuna katlamak, dosyayı açan kişiye hangi tarihe
// baktığını sormadan cevap verirdi.
//
// ⚠️ FARKLI PARA BİRİMLERİ TOPLANMAZ. Portföy listesi karışık para birimli
// olabilir; "Tutar" toplamı YALNIZ tek para birimi kaldığında yazılır. "TL
// karşılığı" toplanır (hepsi TL'dir) ve nereden geldiği notta söylenir.
//
// ⚠️ İPTAL EDİLEN KAYIT TOPLAMA GİRMEZ ama satır olarak DURUR. Ekranda üstü
// çizili görünüyor; dosyadan silmek "bu çek hiç olmadı" demek olurdu, toplama
// katmak ise elde olmayan parayı portföye yazmak.
// =============================================================================

import type { ReportColumn, ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { LIVE_STATUS, type ChequeFilterState } from "./ChequeFilterBar";
import { dueHint, dueTone, ymd } from "./dates";
import { DOCTYPE_LABEL, KIND_LABEL, STATUS_LABEL, cariName } from "./labels";
import { toNum, type ChequeRow, type ChequeStatus } from "./service";

const MONEY = "#,##0.00";

const COLUMNS: ReportColumn[] = [
  { header: "Belge No", key: "docNo", width: 16 },
  { header: "Seri No", key: "serialNo", width: 14 },
  { header: "Tür", key: "docType", width: 10 },
  { header: "Yön", key: "kind", width: 12 },
  { header: "Cari", key: "cari", width: 28 },
  { header: "Ciro edilen", key: "endorsedTo", width: 24 },
  { header: "Keşideci", key: "drawer", width: 24 },
  { header: "Banka", key: "bank", width: 20 },
  { header: "İşlem tarihi", key: "postingDate", width: 12 },
  { header: "Keşide tarihi", key: "issueDate", width: 12 },
  { header: "Vade", key: "dueDate", width: 12 },
  { header: "Vade durumu", key: "dueHint", width: 13 },
  { header: "Durum", key: "status", width: 18 },
  { header: "Bulunduğu banka", key: "atBank", width: 22 },
  { header: "Para", key: "currency", width: 7 },
  { header: "Tutar", key: "amount", width: 15, numFmt: MONEY, align: "right" },
  { header: "TL karşılığı", key: "amountTry", width: 15, numFmt: MONEY, align: "right" },
  { header: "Faturaya kapatılan", key: "allocated", width: 16, numFmt: MONEY, align: "right" },
];

/**
 * Tarih hücresi — boş/bozuk değerde BOŞ döner, ekrandaki "—" DEĞİL.
 * Excel'de "—" o kolonu metne çevirir (sıralama bozulur) ve veri varmış gibi
 * görünür. `postingDate` liste ucunda henüz taşınmıyor olabilir (bkz. `service.ts`).
 */
function dateCell(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR");
}

/**
 * Kuruşa yuvarlanmış toplam.
 *
 * ⚠️ Bu dosyadaki TEK hesap burasıdır (diğer her rakam backend'in gönderdiği
 * değerdir) ve JS ikili kayan noktasında ham `reduce` `16500.499999999996` gibi
 * bir hücre değeri üretebilir: ekranda `numFmt` onu düzgün gösterir ama
 * muhasebeci ondalık basamağı açtığında dosyaya güveni biter.
 */
function sum2(values: number[]): number {
  return Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;
}

/** `YYYY-MM-DD` → `GG.AA.YYYY` (parçalardan; `new Date("…")` UTC'ye kaydırır). */
function fmtYmd(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

/**
 * Durum süzgecinin okunur adı. Sözlük `ChequeFilterBar`'ın özel
 * `STATUS_OPTIONS` listesinden DEĞİL, ortak `STATUS_LABEL`'dan kurulur:
 * kova karosuna tıklayarak oluşan (`kind:status`) süzgeçler o listede yok ve
 * ham enum basılırdı ("AT_BANK").
 */
export function statusFilterLabel(status: string): string {
  if (!status) return "Tümü (geçmiş dahil)";
  if (status === LIVE_STATUS) return "Canlı olanlar";
  return status
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => STATUS_LABEL[s as ChequeStatus] ?? s)
    .join(" + ");
}

/**
 * AKTİF FİLTRELERİN ÖZETİ — dosyanın kapağına yazılır.
 *
 * ⚠️ Bu satır olmadan dosya YANILTICI olur: portföyün varsayılanı "canlı
 * olanlar"dır, yani indirilen dosya tanım gereği DAR bir kesittir. Kapakta
 * yazmazsa dosyayı açan kişi onu tam portföy sanır ve tahsil edilmiş çekleri
 * "kayıp" olarak arar. Durum her zaman basılır (varsayılan da bir süzgeçtir).
 */
export function chequeFilterSummary(f: ChequeFilterState): string[] {
  const parts = [`Durum: ${statusFilterLabel(f.status)}`];
  if (f.kind) parts.push(`Yön: ${KIND_LABEL[f.kind as keyof typeof KIND_LABEL] ?? f.kind}`);
  if (f.docType) {
    parts.push(`Tür: ${DOCTYPE_LABEL[f.docType as keyof typeof DOCTYPE_LABEL] ?? f.docType}`);
  }
  if (f.currency) parts.push(`Para: ${f.currency}`);
  if (f.dueFrom || f.dueTo) {
    parts.push(`Vade: ${f.dueFrom ? fmtYmd(f.dueFrom) : "…"} – ${f.dueTo ? fmtYmd(f.dueTo) : "…"}`);
  }
  if (f.search.trim()) parts.push(`Arama: “${f.search.trim()}”`);
  return parts;
}

export function buildChequeExport(opts: {
  /** EKRANDAKİ satırlar — yeni istek atılmaz, dosya ile ekran ayrışamaz. */
  rows: ChequeRow[];
  filters: ChequeFilterState;
  /** Sunucudaki toplam kayıt — gösterilenden büyükse KIRPMA notu basılır. */
  total: number;
}): ReportExportSpec {
  const { rows, filters, total } = opts;
  const summary = chequeFilterSummary(filters);

  const body = rows.map((c) => {
    const tone = dueTone(c.dueDate, c.status);
    return {
      docNo: c.docNo,
      serialNo: c.serialNo ?? "",
      docType: DOCTYPE_LABEL[c.docType],
      kind: KIND_LABEL[c.kind],
      cari: cariName(c.cari),
      endorsedTo: c.endorsedToCari ? cariName(c.endorsedToCari) : "",
      drawer: c.drawerName ?? "",
      bank: c.bankName ?? "",
      postingDate: dateCell(c.postingDate),
      issueDate: dateCell(c.issueDate),
      dueDate: dateCell(c.dueDate),
      dueHint: dueHint(tone),
      status: STATUS_LABEL[c.status],
      atBank: c.bankAccount?.name ?? "",
      currency: c.currency,
      amount: toNum(c.amount),
      amountTry: toNum(c.amountTry),
      // Kapama YOKSA boş: her satıra "0,00" yazmak, gerçekten kapatılmış olan
      // birkaç satırı sıfırlar denizinde görünmez yapardı.
      allocated: toNum(c.allocatedTotal) === 0 ? "" : toNum(c.allocatedTotal),
    };
  });

  // TOPLAM — iptaller HARİÇ (yukarıdaki başlık uyarısı).
  const counted = rows.filter((c) => c.status !== "CANCELLED");
  const currencies = new Set(counted.map((c) => c.currency));
  const singleCurrency = currencies.size === 1 ? [...currencies][0] : null;

  const notes: string[] = [];
  if (total > rows.length) {
    // "İlk N kayıt" gerçeği söylenmezse, aradığı çeki bulamayan kullanıcı onun
    // sistemde olmadığı sonucuna varır (ekrandaki kırpma uyarısının dosya ikizi).
    notes.push(
      `⚠️ Sunucudaki ${total} kaydın ilk ${rows.length} tanesi (vade sırasına göre) dışa aktarıldı — bu dosya TAM LİSTE DEĞİLDİR. Süzgeci daraltıp tekrar aktarın.`,
    );
  }
  if (rows.length > counted.length) {
    notes.push(
      `TOPLAM satırı ${rows.length - counted.length} iptal kaydını KAPSAMAZ; iptal edilen kayıtlar listede “İptal” durumuyla durmaya devam eder.`,
    );
  }
  notes.push(
    singleCurrency
      ? `Tutar toplamı ${singleCurrency} cinsindendir. “TL karşılığı” kolonu kaydın KENDİ kurundan çevrilmiştir (bugünkü kurla yeniden hesaplanmaz).`
      : "Listede birden fazla para birimi var → “Tutar” toplamı YAZILMADI (farklı para birimlerini toplamak anlamsızdır). Yalnız “TL karşılığı” toplanmıştır; her kayıt kendi kuruyla çevrilmiştir.",
  );
  notes.push(
    `“Vade durumu” dosyanın üretildiği güne (${fmtYmd(ymd(new Date()))}) göre hesaplanır — dosya eskidikçe o kolon bayatlar, vade tarihinin kendisi bayatlamaz.`,
  );
  if (rows.length > 0 && rows.every((c) => !c.postingDate)) {
    // Kolonun neden boş olduğunu dosyanın kendisi söylesin: "veri yok" ile
    // "bu uçtan gelmiyor" farklı şeylerdir. (Bugünkü backend `list` select'i
    // alanı DÖNÜYOR — bu not eski sunucuya karşı derinlik savunmasıdır ve
    // pratikte hiç basılmaz; kolon sessizce boş kalırsa sebebi yazılı olsun.)
    notes.push(
      "“İşlem tarihi” bu listede boş: alan liste ucundan gelmiyor (çek detayında doludur).",
    );
  }

  return {
    title: "Çek / Senet Portföyü",
    // 18 kolon dikey A4'e sığmaz — PDF/Yazdır yatay basılır (Excel etkilenmez).
    orientation: "landscape",
    subtitle: summary.join(" · "),
    meta: [
      `Kayıt: ${rows.length}${total > rows.length ? ` / ${total}` : ""}`,
      "Alınan çek kaydedildiği AN carinin borcunu azaltır; tahsil edildiğinde kasa/banka bakiyesi artar.",
    ],
    tables: [
      {
        // Excel sayfa adında "/" yasak (` ` ile değiştirilir) — ad burada
        // baştan "ve" ile yazılır ki sayfa sekmesinde çift boşluk kalmasın.
        name: "Çek ve Senet Portföyü",
        columns: COLUMNS,
        rows: body,
        totalRow:
          counted.length > 0
            ? {
                docNo: "",
                serialNo: "",
                docType: "",
                kind: "",
                cari: "",
                endorsedTo: "",
                drawer: "",
                bank: "",
                postingDate: "",
                issueDate: "",
                dueDate: "",
                dueHint: "",
                status: `TOPLAM (${counted.length} kayıt)`,
                atBank: "",
                currency: singleCurrency ?? "",
                // "Tutar" ve "Faturaya kapatılan" AYNI kuralı izler: ikisi de
                // kaydın KENDİ para birimindedir, karışık listede toplanamaz.
                // "TL karşılığı" her zaman toplanır — hepsi zaten TL.
                amount: singleCurrency ? sum2(counted.map((c) => toNum(c.amount))) : "",
                amountTry: sum2(counted.map((c) => toNum(c.amountTry))),
                allocated: singleCurrency
                  ? sum2(counted.map((c) => toNum(c.allocatedTotal)))
                  : "",
              }
            : undefined,
        notes,
      },
    ],
  };
}
