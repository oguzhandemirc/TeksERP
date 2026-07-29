// Genel .xlsx üretimi — exceljs etrafında ince, yeniden kullanılabilir sarmalayıcı.
// CSV (table-export.ts) sadece tek-sayfa düz metin; bu yardımcı çok-sayfalı,
// biçimli (sayı/tarih format, bold başlık, TOPLAM satırı) gerçek Excel üretir.
// İndirme: table-export.ts ile aynı Blob+anchor kalıbı (Electron'da IPC gerekmez).
// exceljs (~1MB) yalnız export tıklanınca dinamik yüklenir (Vite ayrı chunk) —
// uygulama açılışı şişmez.

export interface SheetColumn {
  header: string;
  /** rows[]/totalRow içindeki alan adı. */
  key: string;
  width?: number;
  /** Sayı/tarih biçimi — örn "#,##0.0" (metre/kg), "#,##0" (adet), "dd.mm.yyyy hh:mm". */
  numFmt?: string;
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Array<Record<string, unknown>>;
  /** Opsiyonel kalın TOPLAM satırı (kolon key'lerine göre). */
  totalRow?: Record<string, unknown>;
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
    ws.columns = spec.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    headerRow.alignment = { vertical: "middle" };

    for (const r of spec.rows) ws.addRow(r);

    spec.columns.forEach((c, idx) => {
      if (c.numFmt) ws.getColumn(idx + 1).numFmt = c.numFmt;
    });

    if (spec.totalRow) {
      const tr = ws.addRow(spec.totalRow);
      tr.font = { bold: true };
    }

    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: XLSX_MIME });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * .xlsx'i KAYDET DİALOĞUYLA yazar (Electron: pencereye bağlı → arka plan KARARIR +
 * kullanıcı ONAYLAYINCA döner). Böylece toast doğru zamanda atılır (erken değil) ve
 * PDF ile aynı davranır. Electron API yoksa tarayıcı indirmesine düşer.
 * Döner: gerçekten kaydedildi mi (iptal edilirse false).
 */
export async function saveWorkbook(blob: Blob, name: string): Promise<boolean> {
  const filesApi = typeof window !== "undefined" ? window.api?.files : undefined;
  const filename = name.endsWith(".xlsx") ? name : `${name}.xlsx`;
  if (!filesApi?.save) {
    downloadWorkbook(blob, name);
    return true;
  }
  const res = await filesApi.save({ name: filename, base64: await blobToBase64(blob) });
  return res.saved;
}

/** Blob'u .xlsx olarak indirir (tarayıcı fallback / dialogsuz). */
export function downloadWorkbook(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
