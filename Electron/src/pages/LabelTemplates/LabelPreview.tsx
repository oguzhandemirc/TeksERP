import { useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Badge } from "@/components/ui/badge";
import type {
  CatalogField,
  LabelKind,
  TemplateField,
} from "@/services/labelTemplateService";
import { labelKindLabels } from "@/services/labelTemplateService";
import type { MockLabelData, MockTableRow } from "./mockLabelData";
import { MOCK_DATA } from "./mockLabelData";

interface Props {
  kind: LabelKind;
  fields: TemplateField[];
  catalogByKey: Map<string, CatalogField>;
}

const FONT_CLASS: Record<NonNullable<TemplateField["fontSize"]>, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
  xl: "text-xl",
};

export function LabelPreview({ kind, fields, catalogByKey }: Props) {
  const mock = MOCK_DATA[kind];
  const visible = useMemo(
    () =>
      [...fields]
        .filter((f) => f.isVisible)
        .sort((a, b) => a.order - b.order),
    [fields],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Canlı Önizleme
        </div>
        <Badge variant="muted" className="text-[10px]">
          {labelKindLabels[kind]}
        </Badge>
      </div>

      <div className="rounded-lg border-2 border-dashed bg-background p-4 shadow-sm">
        {visible.length === 0 ? (
          <div className="py-8 text-center text-xs italic text-muted-foreground">
            Görünür alan yok. Soldan alan ekle ya da "Görünür" kutusunu işaretle.
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((f) => (
              <PreviewRow
                key={f.key}
                field={f}
                meta={catalogByKey.get(f.key)}
                value={mock[f.key] ?? null}
              />
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Önizleme örnek (mock) veri ile oluşturuldu. Gerçek etiket basıldığında
        veriler ilgili top/kartela/sevkiyattan gelir.
      </p>
    </div>
  );
}

function PreviewRow({
  field,
  meta,
  value,
}: {
  field: TemplateField;
  meta: CatalogField | undefined;
  value: unknown;
}) {
  const type = meta?.type ?? "text";
  const sizeClass = FONT_CLASS[field.fontSize ?? "md"];
  const weightClass = field.isBold ? "font-semibold" : "font-normal";

  if (type === "qr") {
    const v = typeof value === "string" && value ? value : "MOCK-QR";
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {field.label}
        </div>
        <div className="rounded bg-white p-2">
          <QRCodeSVG value={v} size={96} level="M" />
        </div>
      </div>
    );
  }

  if (type === "barcode") {
    const v = typeof value === "string" && value ? value : "—";
    return (
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {field.label}
        </div>
        <div
          className={`rounded border bg-white px-2 py-1 text-center font-mono ${sizeClass} ${weightClass}`}
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg,#111 0 2px,transparent 2px 4px,#111 4px 5px,transparent 5px 8px)",
            backgroundSize: "100% 18px",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "bottom",
            paddingBottom: "22px",
          }}
        >
          {v}
        </div>
      </div>
    );
  }

  if (type === "table") {
    const rows = Array.isArray(value) ? (value as MockTableRow[]) : [];
    return (
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {field.label}
        </div>
        <table className={`w-full border-collapse ${sizeClass}`}>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-0.5 pr-1 font-normal">Kod</th>
              <th className="py-0.5 pr-1 font-normal">Ürün</th>
              <th className="py-0.5 pr-1 font-normal">Renk</th>
              <th className="py-0.5 pr-1 text-right font-normal">Adet</th>
              <th className="py-0.5 text-right font-normal">Kg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className={`py-0.5 pr-1 font-mono ${weightClass}`}>{r.code}</td>
                <td className={`py-0.5 pr-1 ${weightClass}`}>{r.name}</td>
                <td className={`py-0.5 pr-1 ${weightClass}`}>{r.colorName}</td>
                <td className={`py-0.5 pr-1 text-right ${weightClass}`}>{r.qty}</td>
                <td className={`py-0.5 text-right ${weightClass}`}>
                  {r.weightKg.toLocaleString("tr-TR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const display = formatScalar(value, type);
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed pb-1 last:border-0 last:pb-0">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {field.label}
      </span>
      <span className={`${sizeClass} ${weightClass} text-right`}>{display}</span>
    </div>
  );
}

function formatScalar(value: unknown, type: CatalogField["type"]): string {
  if (value == null || value === "") return "—";
  if (type === "number" && typeof value === "number") {
    return value.toLocaleString("tr-TR");
  }
  if (type === "date" && typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        ...(value.length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}),
      });
    }
  }
  return String(value);
}
