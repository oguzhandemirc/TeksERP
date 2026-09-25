// Çek/senet teslim bordrosu belgesinin saf (DB'siz) fikstür uzayı — altın kopya
// bekçisi (`test_cek_bordro_altin`) ile PDF↔Excel eşitlik bekçisi
// (`test_cek_bordro_excel_esit`) AYNI kombinasyonları ölçsün diye tek yerde durur.
// `test_` öneki YOK: koşucu bunu test saymaz.
import type { PrintedDocSnapshot } from "../../src/services/printed-document.service";
import type { DocumentConfig } from "../../src/services/system-setting.service";
import { SAMPLE_PRINTED_DOCS, setSampleClock } from "../../src/services/document-render/sample-data";

type Meta = Record<string, unknown>;

const ISO = "2026-09-26T08:30:00.000Z";

/** Örnek belgenin numarası ve vadesi saatten gelir; sabitlenmezse altın her gün kırmızı. */
setSampleClock(() => new Date(ISO));

const satir = (i: number, over: Record<string, unknown> = {}) => ({
  docNo: `ACK260926${String(i).padStart(4, "0")}`,
  serialNo: `00${34500 + i}`,
  issueDate: ISO,
  dueDate: `2026-1${i % 3}-0${(i % 9) + 1}T09:00:00.000Z`,
  drawerName: "Yıldız Konfeksiyon A.Ş.",
  bankName: "Garanti BBVA",
  currency: "TRY",
  amount: `${1000 * i + 0.5}`,
  ...over,
});

/** Tek para birimi, kaçış gerektiren metin, boş alanlar, binlik ayraçlı ve kuruşlu tutar. */
const TEK_PARA = {
  header: {
    documentNo: "BRD2609260003",
    date: ISO,
    kind: "RECEIVED",
    kindLabel: "Alınan",
    targetName: "Ziraat <Bankası> — Kadıköy & Şb.",
    targetKindLabel: "Teslim Edilen Banka",
    createdBy: "Ayşe \"Kaya\"",
  },
  lines: [
    satir(1),
    satir(2, { serialNo: null, bankName: null, drawerName: "Delta & Ortak <Ltd>" }),
    satir(3, { issueDate: null, amount: "1234567.89" }),
    satir(4, { amount: "0.00" }),
    satir(5, { amount: "12.345" }),
  ],
  totals: [{ currency: "TRY", count: 5, amount: "1250581.235" }],
  notes: "Kurye ile <elden> teslim",
};

/** Verdiğimiz senetler — hedef yok, düzenleyen yok, not yok. */
const VERILEN = {
  header: {
    documentNo: "BRD2609260004",
    date: ISO,
    kind: "ISSUED",
    kindLabel: "Verilen",
    targetName: null,
    targetKindLabel: null,
    createdBy: null,
  },
  lines: [satir(7, { docNo: "VSN2609260001", currency: "USD", amount: "5000" })],
  totals: [{ currency: "USD", count: 1, amount: "5000" }],
  notes: null,
};

/** Üç para birimi — tek TOPLAM basılmaz, ara toplam kutusu üç satır. */
const KARISIK = {
  header: { ...TEK_PARA.header, documentNo: "BRD2609260005", targetName: "Serbest hedef", targetKindLabel: "Teslim Edilen" },
  lines: [
    satir(1),
    satir(2, { currency: "EUR", amount: "750.25" }),
    satir(3, { currency: "USD", amount: "1999.99" }),
    satir(4, { currency: "EUR", amount: "10" }),
  ],
  totals: [
    { currency: "TRY", count: 1, amount: "1000.5" },
    { currency: "USD", count: 1, amount: "1999.99" },
    { currency: "EUR", count: 2, amount: "760.25" },
  ],
  notes: null,
};

/** Satırsız belge — tablo gövdesi boş, toplam kutusu yok. */
const BOS = {
  header: { ...VERILEN.header, documentNo: "BRD2609260006" },
  lines: [],
  totals: [],
  notes: null,
};

export const CEK_BORDRO_DOCS: Record<string, Record<string, unknown>> = {
  ornek: SAMPLE_PRINTED_DOCS.CHEQUE_DELIVERY_NOTE as Record<string, unknown>,
  tekPara: TEK_PARA,
  verilen: VERILEN,
  karisik: KARISIK,
  bos: BOS,
};

const TUM_KOLONLAR = ["no", "docNo", "serialNo", "issueDate", "dueDate", "drawer", "bank", "currency", "amount"];

export const CEK_BORDRO_CFGS: Record<string, DocumentConfig | null> = {
  yok: null,
  bos: {},
  kolonGizle: { columns: { chequeTable: { hidden: ["serialNo", "bank", "issueDate"] } } },
  siraBaslik: {
    columns: {
      chequeTable: {
        order: ["amount", "currency", "docNo"],
        labels: { docNo: "ÇEK <#>", drawer: "  ", amount: "TUTAR & TL" },
        blankLabels: ["currency"],
        shown: ["bank"],
      },
    },
  },
  toplamsiz: { columns: { chequeTable: { hidden: ["amount", "no"] } } },
  tumuGizli: { columns: { chequeTable: { hidden: TUM_KOLONLAR } } },
  tabloKapali: { sections: { chequeTable: false } },
  bolumler: { sections: { declaration: false, createdBy: false, documentNo: false, date: false } },
  baslik: {
    titleOverride: "Kıymet Teslim <Tutanağı>",
    signatureLabels: ["Veren", "Alan & Onay"],
    footerNote: "Alt not",
    showLetterhead: false,
  },
  a5: { style: { pageSize: "A5" }, showSignatures: false },
} as Record<string, DocumentConfig | null>;

export const CEK_BORDRO_METAS: Record<string, Meta> = {
  yok: {},
  taslak: { draft: true },
  iptal: { status: "VOIDED", voidReason: "hata" },
  eskiKopya: { status: "SUPERSEDED" },
  notDamga: { printNote: "baskı <notu>", printedAt: "26.09.2026 11:30", printedBy: "admin" },
};

export interface CekBordroKombinasyon {
  ad: string;
  snapshot: PrintedDocSnapshot;
  meta: Meta;
}

/** Beş doc × on config × beş meta = 250 kombinasyon, sıra deterministik. */
export function cekBordroKombinasyonlari(): CekBordroKombinasyon[] {
  const out: CekBordroKombinasyon[] = [];
  for (const [docAd, doc] of Object.entries(CEK_BORDRO_DOCS)) {
    for (const [cfgAd, cfg] of Object.entries(CEK_BORDRO_CFGS)) {
      for (const [metaAd, meta] of Object.entries(CEK_BORDRO_METAS)) {
        out.push({
          ad: `${docAd}/${cfgAd}/${metaAd}`,
          snapshot: {
            schemaVersion: 1,
            frozenAt: ISO,
            company: {
              name: "Deneme Tekstil",
              letterhead: { addressLine: "Organize San.", phone: "0232", taxInfo: "VD 1" },
              logoHash: null,
            },
            docConfigOverride: cfg,
            doc,
          } as unknown as PrintedDocSnapshot,
          meta,
        });
      }
    }
  }
  return out;
}
