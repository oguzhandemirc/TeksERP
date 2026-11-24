// Jakar desen görseli: kart başına tek JPEG/PNG (≤5 MB). Bayt ayrı uçtan blob gelir, `<img>` blob URL'siyle
// çizilir; tür/boyut kapısı sunucuda (sihirli bayt), panel yalnız aynı sınırı önceden söyler.
import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InfoPopover } from "@/components/ui/info-popover";
import { readFileBase64 } from "@/pages/Quality/Certificates/service";
import { weaveDesignApi } from "../service";
import type { WeaveDesign } from "../types";

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_INFO = "Desenin fotoğrafı ya da tezgâh programından alınmış görüntüsü (JPEG veya PNG, en çok 5 MB). Desen kartı ekranında gösterilir; hesaba girmez.";

export function DesignImageSection({ design, canWrite }: { design: WeaveDesign; canWrite: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const meta = design.image ?? null;
  const blob = useQuery({
    queryKey: ["weave-designs", "image", design.id, meta?.updatedAt ?? null],
    queryFn: () => weaveDesignApi.imageBlob(design.id),
    enabled: !!meta,
  });
  const url = useMemo(() => (blob.data ? URL.createObjectURL(blob.data) : null), [blob.data]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["weave-designs"] });
  const upload = useMutation({
    mutationFn: async (file: File) => weaveDesignApi.uploadImage(design.id, { fileName: file.name, contentBase64: await readFileBase64(file) }),
    onSuccess: (r) => { toast.success(r.message ?? "Desen görseli kaydedildi."); refresh(); },
  });
  const remove = useMutation({
    mutationFn: () => weaveDesignApi.deleteImage(design.id),
    onSuccess: (r) => { toast.success(r.message ?? "Desen görseli kaldırıldı."); refresh(); },
  });
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) { toast.error("Görsel en çok 5 MB olabilir."); return; }
    upload.mutate(file);
  };
  const busy = upload.isPending || remove.isPending;
  return (
    <div className="space-y-2 sm:col-span-2 lg:col-span-3">
      <div className="flex items-center gap-1.5">
        <Label>Desen görseli</Label>
        <InfoPopover desc={IMAGE_INFO} label="Desen görseli açıklaması" />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-40 w-64 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {url ? <img src={url} alt={`${design.code} desen görseli`} className="max-h-full max-w-full object-contain" />
            : <span className="px-3 text-center text-xs text-muted-foreground">{meta ? "Yükleniyor…" : "Görsel yok"}</span>}
        </div>
        {canWrite && (
          <div className="flex flex-col gap-2">
            <input ref={input} type="file" accept="image/jpeg,image/png" className="hidden" aria-label="Desen görseli dosyası"
              onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>{meta ? "Görseli değiştir" : "Görsel yükle"}</Button>
            {meta && <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove.mutate()}>Görseli kaldır</Button>}
            {meta && <span className="text-xs text-muted-foreground">{meta.fileName}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
