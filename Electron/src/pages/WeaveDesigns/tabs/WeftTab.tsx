// Atkı sırası sekmesi: seçili kumaşın atkı kartını düzenler (sıra kodu · sıklık · program no · A/B/C iplikleri).
// Kart başka kumaşlarda da kullanılıyorsa "N kumaşta kullanılıyor" bandı — burada yapılan düzeltme ötekileri
// de değiştirir (tasarım §2.9 risk 1). Sıra kodu doluysa rapordaki adetleri SUNUCU türetir.
import { useQuery } from "@tanstack/react-query";
import { Callout } from "@/components/ui/callout";
import { countWeftSpecUsers, weftSpecApi } from "../service";
import type { DesignFabric } from "../types";
import { WeftSpecEditor } from "./WeftSpecEditor";

export function WeftTab({ fabric, canWrite }: { fabric: DesignFabric | null; canWrite: boolean }) {
  const weftId = fabric?.weftSpecId ?? null;
  const spec = useQuery({ queryKey: ["weft-specs", "detail", weftId], queryFn: () => weftSpecApi.get(weftId!), enabled: !!weftId });
  const users = useQuery({ queryKey: ["weft-specs", "users", weftId], queryFn: () => countWeftSpecUsers(weftId!), enabled: !!weftId });
  if (!fabric) return <p className="text-sm text-muted-foreground">Önce desene bir kumaş bağlayın.</p>;
  if (!weftId) {
    return <p className="text-sm text-muted-foreground">{fabric.code} kumaşına atkı kartı bağlı değil — ürün kartından bağlanır.</p>;
  }
  if (spec.isLoading || !spec.data) return <p className="text-sm text-muted-foreground">Atkı kartı yükleniyor…</p>;
  const shared = (users.data ?? 0) > 1;
  return (
    <div className="space-y-4">
      {shared && (
        <Callout tone="warning" title={`Bu atkı kartı ${users.data} kumaşta kullanılıyor`}>
          Burada yapılan değişiklik o kumaşların hepsine uygulanır. Kayıtlı standart maliyet sürümleri donmuştur, değişmez.
        </Callout>
      )}
      <WeftSpecEditor key={spec.dataUpdatedAt} spec={spec.data} fabricId={fabric.id} canWrite={canWrite} />
    </div>
  );
}
