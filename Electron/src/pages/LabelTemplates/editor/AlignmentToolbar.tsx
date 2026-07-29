// =============================================================================
// Etiket Stüdyosu — çoklu seçim hizalama araç çubuğu (≥2 eleman seçiliyken)
// =============================================================================

import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Group,
  Ungroup,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlignMode, DistributeMode } from "./canvas-align";

/** Büyült/küçült adımı — büyüt ×1.1, küçült tam tersi (1/1.1) → çift tıkla ~geri döner. */
const SCALE_STEP = 1.1;

interface Props {
  count: number;
  /** Seçimde gruplu (groupId'li) eleman var mı — "Grubu çöz" bunu gerektirir. */
  hasGroup: boolean;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (mode: DistributeMode) => void;
  onGroup: () => void;
  onUngroup: () => void;
  /** Seçimi ortak merkez etrafında factor ile ölçekle. */
  onScale: (factor: number) => void;
}

const ALIGNS: Array<{ mode: AlignMode; title: string; icon: React.ComponentType<{ className?: string }> }> = [
  { mode: "left",    title: "Sola hizala",            icon: AlignStartVertical },
  { mode: "hcenter", title: "Yatay ortala",           icon: AlignCenterVertical },
  { mode: "right",   title: "Sağa hizala",            icon: AlignEndVertical },
  { mode: "top",     title: "Üste hizala",            icon: AlignStartHorizontal },
  { mode: "vcenter", title: "Dikey ortala",           icon: AlignCenterHorizontal },
  { mode: "bottom",  title: "Alta hizala",            icon: AlignEndHorizontal },
];

export function AlignmentToolbar({ count, hasGroup, onAlign, onDistribute, onGroup, onUngroup, onScale }: Props) {
  if (count < 2) return null;
  return (
    <div className="flex items-center gap-0.5 rounded-md border bg-card px-1 py-0.5">
      <span className="px-1 text-[10px] font-medium text-muted-foreground">{count} seçili</span>
      {ALIGNS.map(({ mode, title, icon: Icon }) => (
        <Button key={mode} type="button" size="icon" variant="ghost" className="h-6 w-6"
          title={title} onClick={() => onAlign(mode)}>
          <Icon className="h-3.5 w-3.5" />
        </Button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-border" />
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6"
        title={count < 3 ? "Boşluk eşitleme için en az 3 eleman seçin" : "Yatay boşlukları eşitle"}
        disabled={count < 3} onClick={() => onDistribute("h")}>
        <AlignHorizontalDistributeCenter className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6"
        title={count < 3 ? "Boşluk eşitleme için en az 3 eleman seçin" : "Dikey boşlukları eşitle"}
        disabled={count < 3} onClick={() => onDistribute("v")}>
        <AlignVerticalDistributeCenter className="h-3.5 w-3.5" />
      </Button>
      <span className="mx-0.5 h-4 w-px bg-border" />
      {/* Birlikte büyüt/küçült — seçimi ortak merkez etrafında ölçekler. */}
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6"
        title="Seçimi birlikte büyüt" onClick={() => onScale(SCALE_STEP)}>
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6"
        title="Seçimi birlikte küçült" onClick={() => onScale(1 / SCALE_STEP)}>
        <Minimize2 className="h-3.5 w-3.5" />
      </Button>
      <span className="mx-0.5 h-4 w-px bg-border" />
      {/* Grupla / grubu çöz — aynı groupId birlikte hareket eder. */}
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6"
        title="Grupla (Ctrl+G)" onClick={onGroup}>
        <Group className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6"
        title={hasGroup ? "Grubu çöz (Ctrl+Shift+G)" : "Seçimde grup yok"}
        disabled={!hasGroup} onClick={onUngroup}>
        <Ungroup className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
