import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ColumnMapping, ParsedFile } from "@/lib/import/parse";
import { missingRequiredOf, unmatchedHeadersOf } from "@/lib/import/parse";
import type { ImportColumn } from "@/services/importService";

/** Yok say seçeneğinin değeri (boş string select'te sorunlu). */
const IGNORE = "__IGNORE__";

/**
 * SÜTUN EŞLEME — "senin sütunun → bizim alanımız".
 *
 * Sektör standardı (Odoo import wizard, NetSuite CSV Assistant, Salesforce Data
 * Loader, Dynamics Data Management): dosyayı yükleyen kişi eşlemeyi GÖRÜR ve
 * DÜZELTİR. Biz başlık adından otomatik eşliyoruz; bu, dosya BİZİM şablonumuzsa
 * yeterli — ama müşterinin kendi Excel'inde başlık "Kumaş Kodu" değil "ÜRÜN"
 * olur ve o dosyayı elle düzenlemek zorunda kalmak gereksizdir.
 *
 * ⚠️ Adım yalnız otomatik eşleme EKSİK kaldığında kendiliğinden açılır; kendi
 * şablonumuzda her seferinde göstermek boşuna bir tık olurdu. "Sütun
 * eşlemesini düzenle" ile her zaman elle açılabilir.
 */
export function ColumnMappingStep({
  parsed,
  columns,
  mapping,
  onChange,
  onReset,
}: {
  parsed: ParsedFile;
  columns: ImportColumn[];
  mapping: ColumnMapping;
  onChange: (next: ColumnMapping) => void;
  onReset: () => void;
}) {
  const usable = columns.filter((c) => !c.readOnly);
  const unmatched = unmatchedHeadersOf(parsed, mapping);
  const missing = missingRequiredOf(columns, mapping);
  // Aynı şablon sütununa iki dosya sütunu bağlanamaz — ikincisi ilkini ezerdi
  // ve hangisinin kazandığı görünmezdi.
  const used = new Map<string, number>();
  mapping.forEach((k, i) => {
    if (k && !used.has(k)) used.set(k, i);
  });
  const duplicates = mapping.filter((k, i) => k && used.get(k) !== i) as string[];

  const set = (index: number, value: string) => {
    const next = [...mapping];
    next[index] = value === IGNORE ? null : value;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Dosyandaki her sütunun hangi alana yazılacağını seç. Eşlenmeyen sütunlar yok sayılır.
        </p>
        <Button size="sm" variant="ghost" onClick={onReset} title="Otomatik eşlemeye dön">
          <RotateCcw className="h-3.5 w-3.5" /> Otomatik
        </Button>
      </div>

      {missing.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            Zorunlu alan eşlenmedi: <strong>{missing.map((c) => c.label).join(", ")}</strong>. Bu
            alanları taşıyan sütunu seç ya da şablonu indirip başlıkları oradan kopyala.
          </span>
        </p>
      )}
      {duplicates.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>Aynı alana birden fazla sütun bağlandı — her alan tek sütundan beslenmeli.</span>
        </p>
      )}
      {missing.length === 0 && duplicates.length === 0 && unmatched.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> Tüm sütunlar eşleşti.
        </p>
      )}

      <div className="max-h-80 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="px-2 py-1.5 text-left">Dosyadaki sütun</th>
              <th className="px-2 py-1.5 text-left">İlk satırdaki değer</th>
              <th className="px-2 py-1.5 text-left">Yazılacağı alan</th>
            </tr>
          </thead>
          <tbody>
            {parsed.headers.map((h, i) => {
              const isDup = Boolean(mapping[i]) && used.get(mapping[i]!) !== i;
              return (
                <tr key={`${h}-${i}`} className="border-t">
                  <td className="px-2 py-1.5 font-medium">{h || <em className="text-muted-foreground">(başlıksız)</em>}</td>
                  {/* Örnek değer, "hangi sütun neydi" sorusunu başlık belirsizken cevaplar. */}
                  <td className="px-2 py-1.5 text-muted-foreground">{parsed.rows[0]?.cells[i] ?? ""}</td>
                  <td className="px-2 py-1.5">
                    <select
                      className={`h-7 w-full rounded-md border bg-background px-1.5 text-xs ${
                        isDup ? "border-destructive" : ""
                      }`}
                      value={mapping[i] ?? IGNORE}
                      onChange={(e) => set(i, e.target.value)}
                    >
                      <option value={IGNORE}>— yok say —</option>
                      {usable.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                          {c.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">* zorunlu alan</p>
    </div>
  );
}

/** Eşleme "uygulanabilir" mi (zorunlular tam, çift bağ yok)? */
export function isMappingValid(columns: ImportColumn[], mapping: ColumnMapping): boolean {
  if (missingRequiredOf(columns, mapping).length > 0) return false;
  const seen = new Set<string>();
  for (const k of mapping) {
    if (!k) continue;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}
