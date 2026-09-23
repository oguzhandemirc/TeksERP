import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SeriesDateSegment, SeriesFormatInput } from "./types";

/** Tarih segmenti = SAYACIN SIFIRLAMA DÖNEMİ; ayrı bir "periyot" ayarı YOKTUR. */
const SEGMENTLER: Array<{ value: SeriesDateSegment; label: string }> = [
  { value: "DDMMYY", label: "Günlük (GGAAYY)" },
  { value: "DDMMYYYY", label: "Günlük (GGAAYYYY — 23092026)" },
  { value: "YYYYMMDD", label: "Günlük (YYYYAAGG — 20260923)" },
  { value: "YYMM", label: "Aylık (YYAA)" },
  { value: "MMYY", label: "Aylık (AAYY — 0926)" },
  { value: "YYYYMM", label: "Aylık (YYYYAA)" },
  { value: "YY", label: "Yıllık (YY)" },
  { value: "YYYY", label: "Yıllık (YYYY)" },
  { value: "NONE", label: "Tarihsiz (sayaç hiç sıfırlanmaz)" },
];

/**
 * ⚠️ KİLİTLİ SERİDE ALANLAR ÇİZİLİR AMA PASİFTİR (2026-09-23): gizlenince
 * kullanıcı bugünkü biçimi göremiyor ve "ne açılacak" sorusunun ekranda karşılığı
 * kalmıyordu. Pasif alan hem bugünkü değeri gösterir hem de kilidin neyi
 * kapattığını.
 *
 * ⚠️ HATA ALANIN YANINDA: sunucunun Türkçe doğrulama mesajı bölümün ALTINDA
 * gösterilir, global bir toast'ta değil — kullanıcı sebebi aradığı yerde bulur.
 */
export function NumberingFields({
  fmt,
  onChange,
  disabled = false,
  lockedAxes,
  hata = null,
}: {
  fmt: SeriesFormatInput;
  onChange: (next: SeriesFormatInput) => void;
  disabled?: boolean;
  /**
   * ALAN BAZINDA KİLİT (E4): eski istemcinin kırıldığı eksenler. Ölçüldü — sekiz
   * okutulan serinin altısında YALNIZ ön ek kırıyor, yani "seriyi tamamen kapat"
   * fabrikanın hane/ayraç ayarını sebepsiz kilitliyordu. `undefined` = eski
   * sözleşme (bütün biçim `disabled`a bağlı).
   */
  lockedAxes?: Array<"prefix" | "dateSegment" | "digits" | "separator" | "separator2">;
  /** Sunucudan gelen biçim hatası (önizleme ya da kaydetme). */
  hata?: string | null;
}) {
  const axisLocked = (eksen: "prefix" | "dateSegment" | "digits" | "separator" | "separator2"): boolean =>
    disabled || (lockedAxes?.includes(eksen) ?? false);
  return (
    <div className="space-y-2">
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor="ns-prefix">Ön ek</Label>
        <Input
          id="ns-prefix"
          disabled={axisLocked("prefix")}
          value={fmt.prefix}
          maxLength={6}
          onChange={(e) => onChange({ ...fmt, prefix: e.target.value.toUpperCase() })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ns-digits">Hane</Label>
        <Input
          id="ns-digits"
          disabled={axisLocked("digits")}
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
          disabled={axisLocked("dateSegment")}
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={fmt.dateSegment}
          onChange={(e) => onChange({ ...fmt, dateSegment: e.target.value as SeriesDateSegment })}
        >
          {SEGMENTLER.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      <NumberingSeparatorFields fmt={fmt} onChange={onChange} axisLocked={axisLocked} />
    </div>
    {hata && <p className="text-sm font-medium text-destructive">{hata}</p>}
    </div>
  );
}

/**
 * AYRAÇ ALANLARI — `NumberingFields`ten AYRILDI (2026-09-23, boyut tavanı).
 * Bölme ekseni: yukarısı kodun PARÇALARI (ön ek · hane · tarih), burası
 * parçaların EKLEM YERLERİ. İkinci ayraç tarih yokken hiç çizilmez — görünüp
 * hiçbir şey yapmayan alan kullanıcıya "ayarladım" dedirtir.
 */
function NumberingSeparatorFields({
  fmt,
  onChange,
  axisLocked,
}: {
  fmt: SeriesFormatInput;
  onChange: (next: SeriesFormatInput) => void;
  axisLocked: (eksen: "prefix" | "dateSegment" | "digits" | "separator" | "separator2") => boolean;
}) {
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="ns-sep">Ayraç (ön ek ile tarih arası)</Label>
        <Input
          id="ns-sep"
          disabled={axisLocked("separator")}
          value={fmt.separator}
          maxLength={2}
          onChange={(e) => onChange({ ...fmt, separator: e.target.value })}
        />
      </div>
      {/*
        İKİNCİ AYRAÇ — tarih YOKKEN tek eklem vardır ve onu birinci ayraç kurar,
        bu yüzden alan o durumda ÇİZİLMEZ: görünüp hiçbir şey yapmayan bir alan,
        kullanıcıya "ayarladım" dedirtip sonucu değiştirmez.
        Boş bırakıldığında `null` gider = "birinci ayraca düş" (bugünkü davranış).
      */}
      {fmt.dateSegment !== "NONE" && (
        <div className="space-y-1">
          <Label htmlFor="ns-sep2">Ayraç 2 (tarih ile sayaç arası)</Label>
          <Input
            id="ns-sep2"
            disabled={axisLocked("separator2")}
            value={fmt.separator2 ?? ""}
            maxLength={2}
            placeholder={fmt.separator === "" ? "(ayraçsız)" : fmt.separator}
            onChange={(e) => onChange({ ...fmt, separator2: e.target.value === "" ? null : e.target.value })}
          />
        </div>
      )}
    </>
  );
}
