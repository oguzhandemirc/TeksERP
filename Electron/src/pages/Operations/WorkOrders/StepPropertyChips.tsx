// Rota adımı özellik çipleri + işlem ayarları kutusu (K20) — RouteStepDetail'den ayrıldı (dosya tavanı).
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ChipsProps {
  properties: { id: string; name: string }[];
  selected: ReadonlySet<string>;
  locked: ReadonlySet<string>;
  /** İstasyon özellik uygular ama listesi boş — açıklama basılır. */
  empty: boolean;
  onToggle: (id: string) => void;
}

export function StepPropertyChips({ properties, selected, locked, empty, onToggle }: ChipsProps) {
  if (empty) {
    return (
      <div className="text-[11px] italic text-muted-foreground">
        Bu istasyonun yetenek listesi boş — henüz hiçbir özellik
        tanımlanmamış. Aşağıdan ekleyebilir ya da Tanımlar → Kumaş
        Özellikleri'nden bu istasyona atayabilirsiniz.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {properties.map((p) => {
        const on = selected.has(p.id);
        const isLocked = locked.has(p.id);
        return (
          <Badge
            key={p.id}
            variant={on ? "default" : "outline"}
            className={cn("cursor-pointer gap-1 text-[10px]", isLocked && "cursor-not-allowed opacity-50")}
            onClick={() => onToggle(p.id)}
          >
            {on && <Check className="h-3 w-3" />}
            {p.name}
          </Badge>
        );
      })}
    </div>
  );
}

interface BoxProps {
  title: string;
  /** Özellik çipleri (+ küçük "Yeni özellik tanımla" bağlantısı); istasyon özellik uygulamıyorsa null. */
  property: ReactNode | null;
  content: ReactNode;
}

/** "İşlem + işlem parametresi": Özellik (yapılan iş) → parametreler (gramaj, makine) tek kutuda. */
export function StepParamBoxView({ title, property, content }: BoxProps) {
  return (
    <div className="space-y-2.5 rounded-md border bg-card/60 p-2.5" data-testid="step-param-box">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {property && (
        <div className="space-y-1" data-testid="step-param-property">
          <div className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
            <span className="font-semibold">Özellik</span>
            <span className="text-muted-foreground">— yapılan iş (rota bunu karşılar)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">{property}</div>
        </div>
      )}
      {content}
    </div>
  );
}
