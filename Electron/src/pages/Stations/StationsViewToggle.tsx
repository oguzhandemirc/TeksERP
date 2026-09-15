// Sayfa başlığındaki kart ⇄ liste ikon çifti (kullanıcı isteği #3). Basılı olan `aria-pressed`.
import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StationsViewMode } from "./stationsViewMode";

export function StationsViewToggle({ mode, onChange }: { mode: StationsViewMode; onChange: (m: StationsViewMode) => void }) {
  const item = (m: StationsViewMode, label: string, Icon: typeof List) => (
    <Button
      type="button"
      size="sm"
      variant={mode === m ? "secondary" : "ghost"}
      aria-label={label}
      aria-pressed={mode === m}
      title={label}
      onClick={() => onChange(m)}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
  return (
    <div className="flex items-center rounded-md border" role="group" aria-label="Görünüm">
      {item("list", "Liste görünümü", List)}
      {item("cards", "Kart görünümü", LayoutGrid)}
    </div>
  );
}
