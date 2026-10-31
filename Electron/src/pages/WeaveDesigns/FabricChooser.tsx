// Desene bağlı kumaşlar — atkı/varyant/çözgü katmanı sekmeleri seçili kumaşı okur. Kumaş desene
// ürün formundan bağlanır (`Item.weaveDesignId`); burada yalnız seçim yapılır.
import { cn } from "@/lib/utils";
import type { DesignFabric } from "./types";

interface Props { fabrics: DesignFabric[]; loading: boolean; selectedId: string | null; onSelect: (id: string) => void }

export function FabricChooser({ fabrics, loading, selectedId, onSelect }: Props) {
  if (loading) return <p className="text-sm text-muted-foreground">Kumaş listesi yükleniyor…</p>;
  if (fabrics.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Bu desene bağlı kumaş yok. Kumaşı Tanımlar → Ürünler'de açıp "Desen kartı" alanından bu deseni seçin; atkı sırası, varyant ve maliyet kumaş üzerinden tutulur.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Desene bağlı kumaşlar">
      <span className="text-sm text-muted-foreground">Kumaş:</span>
      {fabrics.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={f.id === selectedId}
          onClick={() => onSelect(f.id)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs",
            f.id === selectedId ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          <span className="font-mono">{f.code}</span> · {f.name}
        </button>
      ))}
    </div>
  );
}
