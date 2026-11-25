// Atkı sırası sekmesi: seçili kumaşın atkı kartı (sıra kodu · sıklık · program no · A/B/C iplikleri).
// Burası kartın KULLANIM yeridir, asıl yeri Atkı Kartları ekranı (kullanıcı 2026-11-25): kart yalnız bu kumaşa aitse burada
// düzenlenir; başka kumaşlarda da kullanılıyorsa (ya da sayı bilinmiyorsa) kilitli — "Örnek al (yalnız bu desen)" kartı bu kumaşa
// ayırır (SY-P3, `fork`), "Atkı Kartları ekranında aç" asıl yere götürür. Sıra kodu doluysa rapordaki adetleri SUNUCU türetir.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { openWeftSpecsTab } from "@/pages/WeftSpecs/open-weft-specs";
import { countWeftSpecUsers, weftSpecApi } from "../service";
import type { DesignFabric } from "../types";
import { WeftSpecEditor } from "./WeftSpecEditor";
import { WeftSpecForkDialog } from "./WeftSpecForkDialog";
import { WeftSequenceStrip } from "./WeftSequenceStrip";

export function WeftTab({ fabric, canWrite }: { fabric: DesignFabric | null; canWrite: boolean }) {
  const weftId = fabric?.weftSpecId ?? null;
  const [forking, setForking] = useState(false);
  const [draftSeq, setDraftSeq] = useState<string | null>(null);
  const spec = useQuery({ queryKey: ["weft-specs", "detail", weftId], queryFn: () => weftSpecApi.get(weftId!), enabled: !!weftId });
  const users = useQuery({ queryKey: ["weft-specs", "users", weftId], queryFn: () => countWeftSpecUsers(weftId!), enabled: !!weftId });
  if (!fabric) return <p className="text-sm text-muted-foreground">Önce desene bir kumaş bağlayın.</p>;
  if (!weftId) {
    return <p className="text-sm text-muted-foreground">{fabric.code} kumaşına atkı kartı bağlı değil — ürün kartından bağlanır.</p>;
  }
  if (spec.isLoading || !spec.data) return <p className="text-sm text-muted-foreground">Atkı kartı yükleniyor…</p>;
  // Yalnız "bu kumaştan başka kullanan yok" BİLİNİYORSA düzenlenir; sayı gelmediyse kilitli (fail-closed).
  const ownOnly = users.isSuccess && users.data <= 1;
  const title = users.isSuccess ? `Bu atkı kartı ${users.data} kumaşta kullanılıyor` : users.isLoading ? "Atkı kartının kullanımı denetleniyor…" : "Atkı kartının kaç kumaşta kullanıldığı öğrenilemedi";
  return (
    <div className="space-y-4">
      {!ownOnly && (
        <Callout tone="warning" title={title}>
          Ortak atkı kartı burada değiştirilmez. Yalnız bu deseni değiştirmek için örnek alın; bütün kumaşlar için Atkı Kartları ekranında düzeltin.
          Kayıtlı standart maliyet sürümleri donmuştur, değişmez.
          <div className="mt-2 flex flex-wrap gap-2">
            {canWrite && (
              <Button size="sm" variant="outline" onClick={() => setForking(true)}>
                <Copy className="mr-1.5 h-4 w-4" />Örnek al (yalnız bu desen)
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => openWeftSpecsTab(spec.data.code)}>
              <ExternalLink className="mr-1.5 h-4 w-4" />Atkı Kartları ekranında aç
            </Button>
          </div>
        </Callout>
      )}
      {forking && !ownOnly && <WeftSpecForkDialog spec={spec.data} fabric={fabric} onClose={() => setForking(false)} />}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]">
        <WeftSpecEditor key={spec.dataUpdatedAt} spec={spec.data} fabricId={fabric.id} canWrite={canWrite && ownOnly} onSequenceChange={setDraftSeq} />
        <WeftSequenceStrip fabricId={fabric.id} stale={draftSeq !== null && draftSeq.trim() !== (spec.data.sequenceCode ?? "").trim()} />
      </div>
    </div>
  );
}
