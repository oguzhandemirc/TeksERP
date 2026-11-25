// Kumaşın ek çözgü katmanları (döner / ikinci çözgü); katman satırında SARIM BİÇİMİ tek seçim (kullanıcı kararı 2026-10-31:
// ayrı levent varsayılan | zeminle aynı levent | cağlık). Kayıt katman kümesini olduğu gibi geri yazar (③b replace).
// D3/K7: katman kumaşa aittir → asıl yeri ürün penceresi > Çözgü (`place="item"`); desen kartında (`place="design"`) salt
// okunur özet + "Üründe aç". Ürün penceresinde Çözgü sekmesi yoksa (devere kapalı) tek yazma yeri desen kartı kalır.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useDevereEnabled } from "@/hooks/usePricingEnabled";
import { NATIVE_SELECT_CLASS } from "../WeaveDesignCreateDialog";
import { constructionApi } from "../service";
import { BEAM_MODE_OPTIONS, WARP_LAYER_ROLE_LABEL, type WarpBeamMode } from "../types";
import { ConstructionWarnings } from "./ConstructionWarnings";
import { WarpLayersVisual } from "./WarpLayersVisual";

interface Props {
  fabric: { id: string; code: string };
  canWrite: boolean;
  place: "item" | "design";
  /** Desen kartında: kumaşın ürün penceresini Çözgü sekmesinde açar. */
  onOpenItem?: () => void;
}

export function WarpLayersSection({ fabric, canWrite, place, onOpenItem }: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const devereEnabled = useDevereEnabled();
  const editable = place === "item" || !devereEnabled;
  const canSave = editable && canWrite && hasPermission("item:write");
  const c = useQuery({ queryKey: ["item-construction", fabric.id, null], queryFn: () => constructionApi.get(fabric.id) });
  const [modes, setModes] = useState<Record<string, WarpBeamMode>>({});
  const layers = c.data?.warpLayers ?? [];
  const dirty = layers.some((l) => modes[l.warpSpec.id] && modes[l.warpSpec.id] !== l.beamMode);
  const save = useMutation({
    mutationFn: () => constructionApi.putWarpLayers(fabric.id, layers.map((l) => ({
      warpSpecId: l.warpSpec.id, role: l.role, beamMode: modes[l.warpSpec.id] ?? l.beamMode,
    }))),
    onSuccess: () => {
      toast.success("Çözgü katmanları güncellendi.");
      setModes({});
      void qc.invalidateQueries({ queryKey: ["item-construction", fabric.id] });
    },
  });
  if (c.isLoading) return <p className="text-sm text-muted-foreground">Yapı yükleniyor…</p>;
  if (!c.data) return null;
  const g = c.data.groundWarp;
  return (
    <section className="space-y-3" aria-label="Ek çözgü katmanları">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{place === "item" ? "Ek çözgü katmanları" : `Çözgü — ${fabric.code}`}</h3>
        {!editable && onOpenItem && (
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onOpenItem}>
            <ExternalLink className="mr-1.5 h-4 w-4" />Üründe aç
          </Button>
        )}
      </div>
      {place === "design" && (
        <p className="text-sm">
          Zemin: {g ? <><span className="font-mono text-xs">{g.code}</span> · {g.name} · {g.endsCount} tel</> : <span className="text-muted-foreground">çözgü kartı bağlı değil</span>}
        </p>
      )}
      {!editable && <p className="text-xs text-muted-foreground">Çözgü kumaşa aittir; sarım biçimi kumaşın ürün penceresinde (Çözgü sekmesi) değiştirilir.</p>}
      {layers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ek çözgü katmanı yok.</p>
      ) : (
        <ul className="space-y-2">
          {layers.map((l) => {
            const mode = modes[l.warpSpec.id] ?? l.beamMode;
            const opt = BEAM_MODE_OPTIONS.find((o) => o.value === mode);
            return (
              <li key={l.warpSpec.id} className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[1fr_16rem]">
                <span className="text-sm">
                  {WARP_LAYER_ROLE_LABEL[l.role] ?? l.role}: <span className="font-mono text-xs">{l.warpSpec.code}</span> · {l.warpSpec.name} · {l.warpSpec.endsCount} tel
                </span>
                {editable ? (
                  <div>
                    <select aria-label={`${l.warpSpec.code} sarım biçimi`} className={NATIVE_SELECT_CLASS} value={mode} disabled={!canSave}
                      onChange={(e) => setModes((m) => ({ ...m, [l.warpSpec.id]: e.target.value as WarpBeamMode }))}>
                      {BEAM_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">{opt?.hint}</p>
                  </div>
                ) : (
                  <span className="text-sm" data-testid="beam-mode-readonly">Sarım: {opt?.label ?? mode}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canSave && dirty && <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Sarım biçimini kaydet</Button>}
      <WarpLayersVisual construction={c.data} />
      <ConstructionWarnings warnings={c.data.warnings} />
    </section>
  );
}
