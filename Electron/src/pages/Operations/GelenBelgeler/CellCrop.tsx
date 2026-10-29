// Hücre kırpığı: kaynak kutusu (+ kenar payı) büyütülerek gösterilir — el yazısı rakam okunaklı olsun.
import { useState } from "react";
import { useScanImage } from "./useScanImage";
import type { OcrRect } from "./types";

const PAD = 12;
const TARGET_W = 320;

export function CellCrop({ scanId, rect }: { scanId: string | null; rect: OcrRect | null }) {
  const img = useScanImage(scanId);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  if (!rect || !img.url || img.isPdf) {
    return <div className="flex h-24 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">Hücre görüntüsü yok</div>;
  }
  const x = Math.max(0, rect.x - PAD);
  const y = Math.max(0, rect.y - PAD);
  const w = rect.width + PAD * 2;
  const h = rect.height + PAD * 2;
  const s = Math.min(4, TARGET_W / Math.max(1, w));
  return (
    <div className="relative mx-auto overflow-hidden rounded border bg-white" style={{ width: w * s, height: h * s, maxWidth: "100%" }} data-testid="cell-crop">
      <img
        src={img.url}
        alt="Hücre"
        onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={{ position: "absolute", left: -x * s, top: -y * s, width: nat ? nat.w * s : undefined, maxWidth: "none" }}
      />
    </div>
  );
}
