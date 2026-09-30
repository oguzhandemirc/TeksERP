// CSV (RFC 4180) — dışa aktarmanın tek biçimleyicisi. UTF-8 + BOM (Excel Türkçe karakteri doğru açsın), satır sonu
// CRLF, virgül ayırıcı, nokta ondalık (makinece okunabilir). İç içe değer (nesne/dizi) hücreye JSON olarak girer.
// Formül enjeksiyonu: `= + - @` ya da sekme/CR ile başlayan METİN hücresinin başına `'` konur (tablolama programı
// komut çalıştırmasın); düz sayı dizesi ("-12.50") olduğu gibi kalır.
export const CSV_BOM = "\uFEFF";
export const CSV_EOL = "\r\n";

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "string") text = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else text = JSON.stringify(value);
  const quote = /[",\r\n]/.test(text) || text !== text.trim();
  return quote ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: readonly unknown[]): string {
  return values.map(csvCell).join(",") + CSV_EOL;
}
