import { AlertTriangle, Info } from "lucide-react";
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

/**
 * Şablonun İÇERİĞİ — indirmeden önce ekranda.
 *
 * Neden gerekli: bilgi zaten sunucudan geliyor (sütunlar + kurallar + kabul
 * edilen değerler), ama şu ana kadar öğrenmenin tek yolu dosyayı indirip
 * Excel'de açmaktı. Hangi varlığı aktaracağından emin değilsen 5 dosya indirip
 * Downloads'ı dolduruyordun. Sektör emsali: SAP Migration Cockpit "alan
 * listesi", Dynamics veri varlığı alan görünümü.
 */
export function ImportSpecPreview({ spec }: { spec: ImportTemplateSpec }) {
  const cols = spec.columns.filter((c) => !c.readOnly);
  const required = cols.filter((c) => c.required);
  const withValues = cols.filter((c) => c.enumValues?.length);
  const childCols = cols.filter((c) => c.child);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Chip label="Sütun" value={cols.length} />
        <Chip label="Zorunlu" value={required.length} />
        <Chip label="Eşleşme anahtarı" text={spec.keyColumns.join(" + ")} />
        {childCols.length > 0 ? <Chip label="Alt satır sütunu" value={childCols.length} /> : null}
      </div>

      {childCols.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            <strong>Gruplu şablon:</strong> bir kaydın her alt satırı (adım / kalem) ayrı bir satırdır
            ve satırlar <strong>{spec.keyColumns.join(" + ")}</strong> sütununa göre gruplanır. Alt
            satır listesi <strong>değiştirme</strong> mantığıyla yazılır — dosyada olmayan alt satır
            kayıttan silinir.
          </span>
        </p>
      )}

      <div className="max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="px-2 py-1.5 text-left">Sütun</th>
              <th className="px-2 py-1.5 text-left">Zorunlu</th>
              <th className="px-2 py-1.5 text-left">Tip</th>
              <th className="px-2 py-1.5 text-left">Kural</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c.key} className="border-t align-top">
                <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                  {c.label}
                  {c.child ? <span className="text-muted-foreground"> ↳</span> : null}
                </td>
                <td className="px-2 py-1.5">{c.required ? "Evet" : ""}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                  {TYPE_LABEL[c.type]}
                  {c.maxLen ? ` · ≤${c.maxLen}` : ""}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {[
                    c.help ?? "",
                    c.createOnly ? "Mevcut kayıtta değiştirilemez." : "",
                    c.lookup?.multiple ? "Çoklu değer noktalı virgülle (;)." : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {withValues.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Kabul edilen değerler</p>
          {withValues.map((c) => (
            <p key={c.key} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{c.label}:</span>{" "}
              {c.enumValues!.map((v) => v.label).join(" · ")}
            </p>
          ))}
        </div>
      )}

      <ul className="space-y-0.5 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
        {spec.notes.map((n) => (
          <li key={n} className="flex items-start gap-1.5">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chip({ label, value, text }: { label: string; value?: number; text?: string }) {
  return (
    <span className="rounded-md border px-2 py-0.5">
      {label}: <strong>{text ?? value}</strong>
    </span>
  );
}

/**
 * Mevcut kayıtların İLK N satırı — "indireceğim dosya neye benziyor".
 *
 * Bu ekrandaki "Veriyi indir" kör bir indirmeydi (karta bas, dosya insin) ve
 * dosyanın sütunları ekrandaki listeden FARKLI (round-trip biçimi). Çoğu ERP'de
 * dışa aktarma zaten baktığın listeden yapılır, yani önizleme örtük vardır;
 * bizde yoktu.
 */
export function ImportDataPreview({
  columns,
  rows,
  total,
  truncated,
}: {
  columns: ImportColumn[];
  rows: Array<Record<string, string>>;
  total: number;
  truncated: boolean;
}) {
  const cols = columns.filter((c) => !c.readOnly);
  if (total === 0) {
    return <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">Kayıt yok.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Toplam <strong>{total.toLocaleString("tr-TR")}</strong> kayıt
        {truncated ? ` · aşağıda ilk ${rows.length} tanesi gösteriliyor` : ""}. İndirilen dosya bu
        sütunları taşır ve <strong>düzenlenip geri yüklenebilir</strong>.
      </p>
      <div className="max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className="px-2 py-1.5 text-left whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {cols.map((c) => (
                  <td key={c.key} className="px-2 py-1 whitespace-nowrap">
                    {r[c.key] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
