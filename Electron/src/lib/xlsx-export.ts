// Genel .xlsx üretimi — exceljs etrafında ince, yeniden kullanılabilir sarmalayıcı.
// CSV (table-export.ts) sadece tek-sayfa düz metin; bu yardımcı çok-sayfalı,
// biçimli (sayı/tarih format, bold başlık, TOPLAM satırı) gerçek Excel üretir.
// İndirme: table-export.ts ile aynı Blob+anchor kalıbı (Electron'da IPC gerekmez).
// exceljs (~1MB) yalnız export tıklanınca dinamik yüklenir (Vite ayrı chunk) —
// uygulama açılışı şişmez.

import { saveBlobAs, downloadBlob } from "./file-save";

export interface SheetColumn {
  header: string;
  /** rows[]/totalRow içindeki alan adı. */
  key: string;
  width?: number;
  /** Sayı/tarih biçimi — örn "#,##0.0" (metre/kg), "#,##0" (adet), "dd.mm.yyyy hh:mm". */
  numFmt?: string;
  /** Veri hücrelerinin yatay hizası — belgedeki kolon hizasının aynısı. */
  align?: "left" | "right" | "center";
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Array<Record<string, unknown>>;
  /** Opsiyonel kalın TOPLAM satırı (kolon key'lerine göre). */
  totalRow?: Record<string, unknown>;
  /** Tablonun ALTINA (boş satırdan sonra) basılan açıklama satırları — italik/gri.
   *  Sayı değil BAĞLAM taşır: "bu rakamlar sevk anına aittir, iade düşülmemiştir"
   *  gibi. Rakamın nasıl okunacağını söyleyen not, rakamla aynı dosyada durmalı —
   *  aksi halde Excel elden ele dolaşırken bağlam kaybolur. */
  notes?: string[];
  /** Tablonun ÜSTÜNE basılan belge başlığı satırları (ör. [etiket, değer]) — tek
   *  hücreli satır kalın basılır. Verilmezse sayfa bugünkü gibi başlık satırıyla açılır. */
  preamble?: Array<Array<string | number | null>>;
}

const HEADER_FILL = "FFEFEFEF"; // açık gri başlık zemini
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Excel sayfa adı: ≤31 karakter ve : \ / ? * [ ] yasak.
const sanitizeSheetName = (n: string) => n.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);

/** Çok-sayfalı çalışma kitabı üretir → indirilebilir Blob. */
export async function buildWorkbook(sheets: SheetSpec[]): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "TeksERP";

  for (const spec of sheets) {
    const ws = wb.addWorksheet(sanitizeSheetName(spec.name));
    const preamble = spec.preamble ?? [];
    let headerRowNo = 1;
    if (preamble.length) {
      // Başlık bloğu önce; kolon başlığı satırı bloktan sonra elle yazılır.
      ws.columns = spec.columns.map((c) => ({ key: c.key, width: c.width ?? 16 }));
      for (const line of preamble) {
        const pr = ws.addRow(line);
        if (line.length === 1) pr.font = { bold: true };
        else pr.getCell(1).font = { bold: true };
      }
      ws.addRow([]);
      headerRowNo = ws.addRow(spec.columns.map((c) => c.header)).number;
    } else {
      ws.columns = spec.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
    }

    const headerRow = ws.getRow(headerRowNo);
    headerRow.font = { bold: true };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    headerRow.alignment = { vertical: "middle" };

    const aligned = spec.columns.map((c, idx) => ({ idx: idx + 1, align: c.align })).filter((c) => c.align);
    const alignRow = (row: { getCell: (n: number) => { alignment: unknown } }) => {
      for (const c of aligned) row.getCell(c.idx).alignment = { horizontal: c.align };
    };

    for (const r of spec.rows) alignRow(ws.addRow(r));

    spec.columns.forEach((c, idx) => {
      if (c.numFmt) ws.getColumn(idx + 1).numFmt = c.numFmt;
    });

    if (spec.totalRow) {
      const tr = ws.addRow(spec.totalRow);
      tr.font = { bold: true };
      alignRow(tr);
    }

    if (spec.notes?.length) {
      ws.addRow([]); // notları TOPLAM'dan ayır (autoFilter aralığına yapışmasın)
      for (const n of spec.notes) {
        const nr = ws.addRow([n]);
        nr.font = { italic: true, color: { argb: "FF666666" } };
      }
    }

    ws.views = [{ state: "frozen", ySplit: headerRowNo }];
    if (spec.columns.length > 0) {
      ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo, column: spec.columns.length } };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: XLSX_MIME });
}

/**
 * .xlsx'i KAYDET DİALOĞUYLA yazar (Electron: pencereye bağlı → arka plan KARARIR +
 * kullanıcı ONAYLAYINCA döner). Böylece toast doğru zamanda atılır (erken değil) ve
 * PDF ile aynı davranır. Electron API yoksa tarayıcı indirmesine düşer.
 * Döner: gerçekten kaydedildi mi (iptal edilirse false).
 */
export async function saveWorkbook(blob: Blob, name: string): Promise<boolean> {
  return saveBlobAs(blob, withXlsxExt(name));
}

/** Blob'u .xlsx olarak indirir (tarayıcı fallback / dialogsuz). */
export function downloadWorkbook(blob: Blob, filename: string): void {
  downloadBlob(blob, withXlsxExt(filename));
}

const withXlsxExt = (n: string): string => (n.endsWith(".xlsx") ? n : `${n}.xlsx`);
