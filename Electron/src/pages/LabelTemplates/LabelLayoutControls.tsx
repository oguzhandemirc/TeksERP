import { Input } from "@/components/ui/input";

interface Props {
  lineStepMm: number | null;
  qrScale: number | null;
  onLineStepMm: (v: number | null) => void;
  onQrScale: (v: number | null) => void;
}

/** Şablon-başına yerleşim ayarları — satır aralığı (mm) + QR boyutu. Boş = varsayılan.
 *  Değişiklik canlı önizlemeye anında yansır (LabelPreview'a prop olarak geçer). */
export function LabelLayoutControls({ lineStepMm, qrScale, onLineStepMm, onQrScale }: Props) {
  const num = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Yerleşim
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="block text-[11px] text-muted-foreground">Satır aralığı (mm)</span>
          <Input
            type="number"
            min={1}
            max={30}
            step={0.5}
            value={lineStepMm ?? ""}
            onChange={(e) => onLineStepMm(num(e.target.value))}
            placeholder="oto"
            className="h-8"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] text-muted-foreground">QR boyutu</span>
          <Input
            type="number"
            min={2}
            max={15}
            step={1}
            value={qrScale ?? ""}
            onChange={(e) => onQrScale(num(e.target.value))}
            placeholder="5"
            className="h-8"
          />
        </label>
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Boş = varsayılan. Satır aralığı = satırlar arası <strong>ek boşluk</strong> (yazı
        yüksekliğine eklenir → yazılar asla üst üste binmez); QR boyutu = modül büyütmesi
        (yüksek = daha büyük kare kod, metin sağa kayar). Değişiklik önizlemeye anında yansır.
      </p>
    </div>
  );
}
