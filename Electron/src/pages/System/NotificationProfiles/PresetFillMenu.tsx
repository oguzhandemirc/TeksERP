// Rol profili matrisini hazır profille tek tıkla doldurur (taslağa; "Kaydet" mevcut hücre yazımıdır). Kümeler sunucuda
// katalogdan türer (`/profiller/hazir`); eski sunucuda (404) menü çizilmez.
import { useQuery } from "@tanstack/react-query";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { bildirimProfilService, type PresetProfileSet } from "@/services/bildirimProfilService";
import { PROFILES_QUERY_ROOT } from "./queries";

export function PresetFillMenu({ disabled, onFill }: { disabled: boolean; onFill: (p: PresetProfileSet) => void }) {
  const q = useQuery({ queryKey: [...PROFILES_QUERY_ROOT, "hazir"], queryFn: () => bildirimProfilService.hazirProfiller(), retry: false, staleTime: 300_000 });
  if (!q.data) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled}>
          <Wand2 className="h-4 w-4" /> Hazır profilden doldur
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Kümedeki türler Açık, diğerleri Kapalı olur; Kilitli hücreler korunur. Kaydetmeden yazılmaz.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {q.data.items.map((p) => (
          <DropdownMenuItem key={p.kod} onSelect={() => onFill(p)} className="flex flex-col items-start gap-0.5">
            <span className="text-sm">{p.ad} <span className="text-xs text-muted-foreground">({p.turler.length} tür)</span></span>
            <span className="text-xs text-muted-foreground">{p.aciklama}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
