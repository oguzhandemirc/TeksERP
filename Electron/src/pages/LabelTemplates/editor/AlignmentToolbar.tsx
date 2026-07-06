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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlignMode, DistributeMode } from "./canvas-model";

interface Props {
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (mode: DistributeMode) => void;
}

const ALIGNS: Array<{ mode: AlignMode; title: string; icon: React.ComponentType<{ className?: string }> }> = [
  { mode: "left",    title: "Sola hizala",            icon: AlignStartVertical },
  { mode: "hcenter", title: "Yatay ortala",           icon: AlignCenterVertical },
  { mode: "right",   title: "Sağa hizala",            icon: AlignEndVertical },
  { mode: "top",     title: "Üste hizala",            icon: AlignStartHorizontal },
  { mode: "vcenter", title: "Dikey ortala",           icon: AlignCenterHorizontal },
  { mode: "bottom",  title: "Alta hizala",            icon: AlignEndHorizontal },
];

export function AlignmentToolbar({ count, onAlign, onDistribute }: Props) {
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
    </div>
  );
}
