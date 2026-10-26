// Alt şerit: "Bu ayarla haftada ~N bildirim (en çok: …)" — sayıyı SUNUCU hesaplar (`POST /tercihler/onizleme`,
// yazmaz); taslak değiştikçe 400 ms gecikmeyle sorulur. Kaynak etiketi ölçüm (son 30 gün) / tahmin (katalog).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { NOTIFICATION_QUERY_KEY } from "@/lib/bildirim/hooks";
import { draftToBody, type PreferenceDraft } from "@/lib/bildirim/tercih-taslak";
import type { NotificationCatalogKind } from "@/lib/bildirim/types";
import { bildirimService } from "@/services/bildirimService";

export const PREVIEW_DEBOUNCE_MS = 400;

const fmt = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);

export function PreviewStrip({ draft, kinds }: { draft: PreferenceDraft; kinds: readonly NotificationCatalogKind[] }) {
  const body = JSON.stringify(draftToBody(draft));
  const [debounced, setDebounced] = useState(body);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(body), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [body]);
  const q = useQuery({
    queryKey: [...NOTIFICATION_QUERY_KEY, "onizleme", debounced],
    queryFn: () => bildirimService.tercihOnizleme(JSON.parse(debounced)),
    enabled: debounced !== "[]",
    retry: false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  if (!q.data) return null;
  const name = (kod: string) => kinds.find((k) => k.kod === kod)?.ad ?? kod;
  const top = q.data.enCok[0];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-4 py-2 text-sm" data-testid="onizleme-serit" aria-live="polite">
      <span>
        Bu ayarla haftada <strong className="tabular-nums">~{fmt(q.data.haftalik)}</strong> bildirim
        {top ? ` (en çok: ${name(top.kind)} ${fmt(top.sayi)})` : ""}
      </span>
      <Badge variant="outline" title={q.data.kaynak === "olcum" ? "Son 30 günün gerçek bildirim sayımından" : "Henüz ölçüm yok; katalog tahmini"}>
        {q.data.kaynak === "olcum" ? "ölçüm" : "tahmin"}
      </Badge>
    </div>
  );
}
