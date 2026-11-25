// Atkı raporu sekmesi: seçili kumaşın atkı kartı (sıra kodu · sıklık · program no · A/B/C iplikleri) + atkı seçici görseli.
// D3/K7: atkı kumaşa aittir, desen birçok kumaşı besler → burada SALT OKUNUR özet. Kumaşın atkısı ürün penceresinin Atkı
// sekmesinde ("Üründe aç"; orada paylaşılan kart kilitli, "yalnız bu kumaş için kopya"), ortak kart Atkı Kartları ekranında
// ("Atkı Kartları ekranında aç") düzenlenir.
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { openWeftSpecsTab } from "@/pages/WeftSpecs/open-weft-specs";
import { weftSpecApi } from "../service";
import type { DesignFabric } from "../types";
import { WeftSpecView } from "./WeftSpecEditor";
import { WeftSequenceStrip } from "./WeftSequenceStrip";

export function WeftTab({ fabric, onOpenItem }: { fabric: DesignFabric | null; onOpenItem?: () => void }) {
  const weftId = fabric?.weftSpecId ?? null;
  const spec = useQuery({ queryKey: ["weft-specs", "detail", weftId], queryFn: () => weftSpecApi.get(weftId!), enabled: !!weftId });
  if (!fabric) return <p className="text-sm text-muted-foreground">Önce desene bir kumaş bağlayın.</p>;
  const openItem = onOpenItem && (
    <Button size="sm" variant="outline" onClick={onOpenItem}><ExternalLink className="mr-1.5 h-4 w-4" />Üründe aç</Button>
  );
  if (!weftId) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{fabric.code} kumaşına atkı kartı bağlı değil — ürün penceresinin Atkı sekmesinden bağlanır.</p>
        {openItem}
      </div>
    );
  }
  if (spec.isLoading || !spec.data) return <p className="text-sm text-muted-foreground">Atkı kartı yükleniyor…</p>;
  const code = spec.data.code;
  return (
    <div className="space-y-4">
      <Callout tone="info" title="Atkı bu ekranda değiştirilmez">
        Atkı kumaşa aittir: {fabric.code} kumaşının atkısı ürün penceresinin Atkı sekmesinde, birçok kumaşın kullandığı ortak atkı kartı Atkı Kartları ekranında düzenlenir.
        <div className="mt-2 flex flex-wrap gap-2">
          {openItem}
          <Button size="sm" variant="ghost" onClick={() => openWeftSpecsTab(code)}>
            <ExternalLink className="mr-1.5 h-4 w-4" />Atkı Kartları ekranında aç
          </Button>
        </div>
      </Callout>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]">
        <WeftSpecView spec={spec.data} />
        <WeftSequenceStrip fabricId={fabric.id} />
      </div>
    </div>
  );
}
