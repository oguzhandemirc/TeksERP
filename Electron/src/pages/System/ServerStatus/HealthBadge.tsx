// Y13: yüklenirken "Ulaşılamıyor" demez; hata = sağlık ucu okunamadı (bağlantı kenar çubuğunda ayrıca görünür) → yeniden dene.
import { Button } from "@/components/ui/button";

export function HealthBadge({ online, loading, onRetry }: { online: boolean; loading: boolean; onRetry: () => void }) {
  if (online) {
    return (
      <span className="flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Çevrimiçi
      </span>
    );
  }
  if (loading) return <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">Ölçülüyor…</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="rounded-full bg-destructive/15 px-3 py-1 text-xs font-medium text-destructive">Durum bilgisi alınamadı</span>
      <Button size="sm" variant="outline" onClick={onRetry}>Yeniden dene</Button>
    </span>
  );
}
