// Çıktı diyaloğunun sütun modeli (saf). Katalog = dosyaya girebilen BÜTÜN sütunlar (ekranda gizli olanlar dahil),
// varsayılan seçim = ekranda görünenler. Seçim yalnız katalog id'leriyle yapılır; tanınmayan id HATADIR (fail-closed):
// sessizce düşürmek "Excel'de sütun eksik" ya da ekrandan farklı dosya demektir.

/** Diyalogdaki tek sütun: id + etiket + ekranda görünüyor mu. */
export interface ExportColumnOption {
  id: string;
  label: string;
  visible: boolean;
}

export class UnknownExportColumnError extends Error {
  readonly unknown: string[];
  constructor(unknown: string[]) {
    super(`Tanınmayan çıktı sütunu: ${unknown.join(", ")}`);
    this.name = "UnknownExportColumnError";
    this.unknown = unknown;
  }
}

/** Seçim katalogda olmayan id taşıyorsa fırlatır; boş seçim de geçersizdir (boş dosya veri sanılır). */
export function assertKnownColumns(catalog: readonly ExportColumnOption[], ids: readonly string[]): void {
  const known = new Set(catalog.map((c) => c.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new UnknownExportColumnError(unknown);
  if (ids.length === 0) throw new Error("En az bir sütun seçilmeli.");
}

/** Seçimi katalog sırasına dizer (dosyadaki sıra = ekrandaki sıra; işaretleme sırası değil). */
export function orderByCatalog(catalog: readonly ExportColumnOption[], ids: readonly string[]): string[] {
  const set = new Set(ids);
  return catalog.filter((c) => set.has(c.id)).map((c) => c.id);
}

/** Ekranda görünen sütunlar (diyaloğun ilk açılış seçimi). */
export function defaultColumnSelection(catalog: readonly ExportColumnOption[]): string[] {
  const visible = catalog.filter((c) => c.visible).map((c) => c.id);
  return visible.length > 0 ? visible : catalog.map((c) => c.id);
}

/**
 * Kayıtlı seçimi bugünkü kataloğa uyarlar: tercih blob'u ESKİ olabilir (sütun kaldırılmış/yeniden adlandırılmış),
 * o yüzden burada bilinmeyen id atılır — doğrulama ÇALIŞTIRMADA (`assertKnownColumns`) sıkıdır. Hiçbiri kalmazsa null.
 */
export function restoreColumnSelection(catalog: readonly ExportColumnOption[], saved: unknown): string[] | null {
  if (!Array.isArray(saved)) return null;
  const ids = orderByCatalog(catalog, saved.filter((x): x is string => typeof x === "string"));
  return ids.length > 0 ? ids : null;
}

export type ExportFormat = "xlsx" | "pdf" | "csv";
export type ExportScope = "all" | "selected" | "loaded";

/** Kullanıcı tercihindeki kayıt (`prefs.exportDialog[anahtar]`). */
export interface SavedExportChoice {
  columns?: string[];
  format?: ExportFormat;
  detail?: string;
}

const FORMATS: readonly ExportFormat[] = ["xlsx", "pdf", "csv"];

/** Tercih blob'undan güvenli okuma — bozuk/eski şekil boş kayıt sayılır. */
export function readSavedExportChoice(raw: unknown): SavedExportChoice | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: SavedExportChoice = {};
  if (Array.isArray(o.columns)) out.columns = o.columns.filter((x): x is string => typeof x === "string");
  if (typeof o.format === "string" && (FORMATS as readonly string[]).includes(o.format)) out.format = o.format as ExportFormat;
  if (typeof o.detail === "string") out.detail = o.detail;
  return out;
}
