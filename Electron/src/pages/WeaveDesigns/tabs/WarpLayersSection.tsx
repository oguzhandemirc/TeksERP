// Seçili kumaşın çözgüsü: zemin (ürün kartında) + ek katmanlar; katman satırında SARIM BİÇİMİ tek seçim
// (kullanıcı kararı 2026-10-31: ayrı levent varsayılan | zeminle aynı levent | cağlık). Kayıt katman
// kümesini olduğu gibi geri yazar (③b replace); katman ekleme/çıkarma ürün yapısı işidir.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { NATIVE_SELECT_CLASS } from "../WeaveDesignCreateDialog";
import { constructionApi } from "../service";
import { BEAM_MODE_OPTIONS, WARP_LAYER_ROLE_LABEL, type DesignFabric, type WarpBeamMode } from "../types";
import { ConstructionWarnings } from "./ConstructionWarnings";

export function WarpLayersSection({ fabric, canWrite }: { fabric: DesignFabric; canWrite: boolean }) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canSave = canWrite && hasPermission("item:write");
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
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Çözgü — {fabric.code}</h3>
      <p className="text-sm">
        Zemin: {g ? <><span className="font-mono text-xs">{g.code}</span> · {g.name} · {g.endsCount} tel</> : <span className="text-muted-foreground">çözgü kartı bağlı değil</span>}
      </p>
      {layers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ek çözgü katmanı yok.</p>
      ) : (
        <ul className="space-y-2">
          {layers.map((l) => {
            const mode = modes[l.warpSpec.id] ?? l.beamMode;
            return (
              <li key={l.warpSpec.id} className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[1fr_16rem]">
                <span className="text-sm">
                  {WARP_LAYER_ROLE_LABEL[l.role] ?? l.role}: <span className="font-mono text-xs">{l.warpSpec.code}</span> · {l.warpSpec.name} · {l.warpSpec.endsCount} tel
                </span>
                <div>
                  <select aria-label={`${l.warpSpec.code} sarım biçimi`} className={NATIVE_SELECT_CLASS} value={mode} disabled={!canSave}
                    onChange={(e) => setModes((m) => ({ ...m, [l.warpSpec.id]: e.target.value as WarpBeamMode }))}>
                    {BEAM_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">{BEAM_MODE_OPTIONS.find((o) => o.value === mode)?.hint}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canSave && dirty && <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Sarım biçimini kaydet</Button>}
      <ConstructionWarnings warnings={c.data.warnings} />
    </section>
  );
}
