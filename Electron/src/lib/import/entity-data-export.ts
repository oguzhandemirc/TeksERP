import { importService } from "@/services/importService";

/**
 * Bir varlığın TÜM verisini içe aktarım şablonuyla aynı sütunlarla Excel'e indirir.
 * Tek kaynak: Veri Aktarımı önizlemesi ve lisans "verilerimi al" kapısı aynı dosyayı üretir.
 * Dönüş: indirilen satır sayısı (0 → dosya yazılmadı).
 */
export async function downloadEntityData(entity: string): Promise<number> {
  // İndirme LİMİTSİZ çeker — önizlemedeki birkaç satır yalnız bakmak içindi.
  const res = await importService.exportData(entity);
  const { columns, rows, label } = res.data;
  if (rows.length === 0) return 0;
  const { exportRowsToXlsx } = await import("@/lib/list-export");
  const cols = columns
    .filter((c) => !c.readOnly)
    .map((c) => ({ label: c.label, value: (r: Record<string, string>) => r[c.key] ?? "" }));
  await exportRowsToXlsx(cols, rows, `${label} - veri`, [
    "Bu dosya içe aktarım şablonuyla AYNI sütunları taşır — düzenleyip geri yükleyebilirsiniz.",
  ]);
  return rows.length;
}
