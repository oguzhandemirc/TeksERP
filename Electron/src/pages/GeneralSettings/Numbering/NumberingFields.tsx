import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SeriesDateSegment, SeriesFormatInput } from "./types";

/** Tarih segmenti = SAYACIN SIFIRLAMA DÖNEMİ; ayrı bir "periyot" ayarı YOKTUR. */
const SEGMENTLER: Array<{ value: SeriesDateSegment; label: string }> = [
  { value: "DDMMYY", label: "Günlük (GGAAYY)" },
  { value: "YYMM", label: "Aylık (YYAA)" },
  { value: "YYYYMM", label: "Aylık (YYYYAA)" },
  { value: "YY", label: "Yıllık (YY)" },
  { value: "YYYY", label: "Yıllık (YYYY)" },
  { value: "NONE", label: "Tarihsiz (sayaç hiç sıfırlanmaz)" },
];

export function NumberingFields({
  fmt,
  onChange,
}: {
  fmt: SeriesFormatInput;
  onChange: (next: SeriesFormatInput) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor="ns-prefix">Ön ek</Label>
        <Input
          id="ns-prefix"
          value={fmt.prefix}
          maxLength={6}
          onChange={(e) => onChange({ ...fmt, prefix: e.target.value.toUpperCase() })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ns-digits">Hane</Label>
        <Input
          id="ns-digits"
          type="number"
          min={1}
          max={8}
          value={fmt.digits}
          onChange={(e) => onChange({ ...fmt, digits: Number(e.target.value) })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ns-segment">Tarih</Label>
        <select
          id="ns-segment"
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={fmt.dateSegment}
          onChange={(e) => onChange({ ...fmt, dateSegment: e.target.value as SeriesDateSegment })}
        >
          {SEGMENTLER.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ns-sep">Ayraç</Label>
        <Input
          id="ns-sep"
          value={fmt.separator}
          maxLength={2}
          onChange={(e) => onChange({ ...fmt, separator: e.target.value })}
        />
      </div>
    </div>
  );
}
