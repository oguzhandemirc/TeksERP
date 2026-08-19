// =============================================================================
// ŞABLON ÜRETİMİ — sunucunun tarifinden .xlsx
// =============================================================================
// Sektör asgarisi (Odoo / SAP Migration Cockpit / NetSuite CSV Assistant):
// şablon dosyası kolon başlıklarını, zorunluluğu, tipi, örnek satırı VE kabul
// edilen değer listelerini AYNI dosyada taşır. Ayrı bir "kılavuz" dosyası
// kimsenin okumadığı bir belgedir; kural veriyle aynı yerde durmalı.
//
// Üç sayfa: "Veri" (doldurulacak) · "Açıklama" (sütun kuralları) · "Değerler"
// (enum + lookup listeleri).

import { buildWorkbook, saveWorkbook, type SheetSpec } from "@/lib/xlsx-export";
import type { ImportColumn, ImportTemplateSpec } from "@/services/importService";

const TYPE_LABEL: Record<ImportColumn["type"], string> = {
  text: "Metin",
  number: "Sayı",
  int: "Tam sayı",
  bool: "Evet / Hayır",
  date: "Tarih (GG.AA.YYYY)",
  enum: "Listeden seçim",
  lookup: "Kod referansı",
};

/** Şablon .xlsx'i üretir ve kaydet dialoğunu açar. */
export async function downloadTemplate(spec: ImportTemplateSpec): Promise<boolean> {
  const dataSheet: SheetSpec = {
    name: "Veri",
    columns: spec.columns
      .filter((c) => !c.readOnly)
      .map((c) => ({ header: c.label, key: c.key, width: Math.max(14, Math.min(40, c.label.length + 6)) })),
    // Tek ÖRNEK satır: boş bir şablon "buraya ne yazacağım" sorusunu cevaplamaz.
    // Kullanıcı bu satırın üzerine yazar ya da siler (Açıklama sayfasında yazıyor).
    rows: [
      Object.fromEntries(
        spec.columns.filter((c) => !c.readOnly).map((c) => [c.key, c.example ?? ""]),
      ),
    ],
  };

  const helpSheet: SheetSpec = {
    name: "Açıklama",
    columns: [
      { header: "Sütun", key: "label", width: 26 },
      { header: "Zorunlu", key: "required", width: 10 },
      { header: "Tip", key: "type", width: 22 },
      { header: "Kural", key: "help", width: 80 },
    ],
    rows: spec.columns
      .filter((c) => !c.readOnly)
      .map((c) => ({
        label: c.label,
        required: c.required ? "Evet" : "",
        type: TYPE_LABEL[c.type] + (c.maxLen ? ` (en fazla ${c.maxLen} karakter)` : ""),
        help: [
          c.help ?? "",
          c.createOnly ? "Yalnız YENİ kayıtta yazılır; mevcut kayıtta değiştirilemez." : "",
          c.child ? "ALT SATIR sütunu — her satırda doldurulur." : "",
          c.lookup?.multiple ? "Birden fazla değer noktalı virgülle (;) yazılır." : "",
        ]
          .filter(Boolean)
          .join(" "),
      })),
    notes: [
      "GENEL KURALLAR",
      ...spec.notes.map((n) => `• ${n}`),
      "• Örnek satırı silin ya da üzerine yazın — olduğu gibi yüklerseniz örnek veri kaydedilir.",
      "• Bu dosyayı yüklemeden önce 'Önizleme' adımında satır satır ne olacağını görürsünüz; hiçbir şey o adımda yazılmaz.",
    ],
  };

  const valueRows: Array<Record<string, unknown>> = [];
  for (const c of spec.columns) {
    if (c.enumValues?.length) {
      for (const v of c.enumValues) {
        valueRows.push({ column: c.label, value: v.label, note: `Kod: ${v.value}` });
      }
    } else if (c.lookup) {
      valueRows.push({
        column: c.label,
        value: "(kod yazın)",
        note: `Tanımlardaki ${lookupLabel(c.lookup.entity)} KODU. Kod bulunamazsa tam ADI da denenir; birden fazla eşleşirse satır hata verir.`,
      });
    }
  }

  const sheets: SheetSpec[] = [dataSheet, helpSheet];
  if (valueRows.length > 0) {
    sheets.push({
      name: "Değerler",
      columns: [
        { header: "Sütun", key: "column", width: 26 },
        { header: "Kabul edilen değer", key: "value", width: 30 },
        { header: "Açıklama", key: "note", width: 70 },
      ],
      rows: valueRows,
    });
  }

  const blob = await buildWorkbook(sheets);
  return saveWorkbook(blob, `${spec.label} - içe aktarım şablonu`);
}

function lookupLabel(entity: string): string {
  const map: Record<string, string> = {
    item: "kumaş",
    color: "renk",
    station: "istasyon",
    machine: "makine",
    fabricProperty: "özellik",
    customer: "cari",
    subcontractor: "fason firma",
    subcontractorCategory: "fason kategorisi",
    qualityGrade: "kalite",
    route: "rota",
    defectType: "hata tipi",
    returnReason: "iade sebebi",
  };
  return map[entity] ?? entity;
}

/**
 * Hatalı satır raporu — kullanıcının YÜKLEDİĞİ satırlar + "Hata" sütunu.
 * Sektör standardı: hataları ekranda okutup düzeltmeyi kullanıcıya bırakmak
 * 500 satırlık bir dosyada işe yaramaz; düzeltilecek satırlar indirilebilir
 * olmalı.
 */
export async function downloadErrorReport(
  spec: ImportTemplateSpec,
  rows: Array<{ rowNo: number; cells: Record<string, string> }>,
  results: Array<{ rowNo: number; errors: Array<{ column?: string; message: string }>; warnings: Array<{ column?: string; message: string }> }>,
): Promise<boolean> {
  const byRow = new Map(results.map((r) => [r.rowNo, r]));
  const cols = spec.columns.filter((c) => !c.readOnly);
  const problemRows = rows.filter((r) => {
    const res = byRow.get(r.rowNo);
    return res && (res.errors.length > 0 || res.warnings.length > 0);
  });

  const blob = await buildWorkbook([
    {
      name: "Hatalı Satırlar",
      columns: [
        { header: "Satır", key: "__rowNo", width: 8 },
        { header: "Hata", key: "__error", width: 60 },
        { header: "Uyarı", key: "__warning", width: 60 },
        ...cols.map((c) => ({ header: c.label, key: c.key, width: 20 })),
      ],
      rows: problemRows.map((r) => {
        const res = byRow.get(r.rowNo);
        return {
          __rowNo: r.rowNo,
          __error: (res?.errors ?? []).map((e) => e.message).join(" | "),
          __warning: (res?.warnings ?? []).map((w) => w.message).join(" | "),
          ...Object.fromEntries(cols.map((c) => [c.key, r.cells[c.key] ?? ""])),
        };
      }),
      notes: [
        "Bu dosya YALNIZ sorunlu satırları içerir; hatayı düzeltip aynı dosyayı yeniden yükleyebilirsiniz.",
        "İlk üç sütun (Satır / Hata / Uyarı) yükleme sırasında yok sayılır — silmenize gerek yok.",
      ],
    },
  ]);
  return saveWorkbook(blob, `${spec.label} - hatalı satırlar`);
}
