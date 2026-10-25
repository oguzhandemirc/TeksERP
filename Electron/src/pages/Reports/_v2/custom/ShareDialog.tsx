import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { foldedIncludes } from "@/lib/search-fold";
import { customReportApi, type ShareState } from "./custom-api";

interface Props {
  definitionId: string;
  open: boolean;
  canPublish: boolean;
  onClose: () => void;
}

type Access = "GOR" | "DUZENLE";
const VISIBILITY: Array<{ value: ShareState["gorunurluk"]; label: string; hint: string }> = [
  { value: "OZEL", label: "Yalnız ben", hint: "Rapor yalnız sizde görünür." },
  { value: "PAYLASIMLI", label: "Seçtiğim kişiler", hint: "Aşağıda işaretlediğiniz kişiler görür." },
  { value: "HERKES", label: "Herkes", hint: "Rapor izni olan herkes görür (rapor yayınlama yetkisi gerekir)." },
];

/** Paylaşım — görünürlük verir, veri yetkisi vermez: her kişi raporda yalnız kendi izninin yettiği bölümleri görür. */
export function ShareDialog({ definitionId, open, canPublish, onClose }: Props) {
  const qc = useQueryClient();
  const current = useQuery({ queryKey: ["custom-report-share", definitionId], queryFn: () => customReportApi.shares(definitionId), enabled: open });
  const candidates = useQuery({ queryKey: ["custom-report-share-candidates"], queryFn: customReportApi.shareCandidates, enabled: open, staleTime: 60_000 });
  const [visibility, setVisibility] = useState<ShareState["gorunurluk"]>("OZEL");
  const [picked, setPicked] = useState<Map<string, Access>>(new Map());
  const [term, setTerm] = useState("");
  useEffect(() => {
    if (!open || !current.data) return;
    setVisibility(current.data.gorunurluk);
    setPicked(new Map(current.data.paylasimlar.map((p) => [p.kullaniciId, p.yetki])));
    setTerm("");
  }, [open, current.data]);
  const shown = useMemo(() => (candidates.data ?? []).filter((u) => !term || foldedIncludes(u.ad, term)), [candidates.data, term]);
  const save = useMutation({
    mutationFn: () =>
      customReportApi.replaceShares(definitionId, {
        gorunurluk: visibility,
        paylasimlar: visibility === "PAYLASIMLI" ? [...picked].map(([kullaniciId, yetki]) => ({ kullaniciId, yetki })) : [],
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["custom-report-share", definitionId] });
      await qc.invalidateQueries({ queryKey: ["custom-reports"] });
      await qc.invalidateQueries({ queryKey: ["custom-report", definitionId] });
      toast.success("Paylaşım kaydedildi.");
      onClose();
    },
  });
  const toggle = (id: string) => setPicked((m) => { const n = new Map(m); if (n.has(id)) n.delete(id); else n.set(id, "GOR"); return n; });
  const flip = (id: string) => setPicked((m) => new Map(m).set(id, m.get(id) === "GOR" ? "DUZENLE" : "GOR"));

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raporu paylaş</DialogTitle>
          <DialogDescription>Paylaşım görmeyi açar; kişi yalnız kendi izninin yettiği bölümleri görür.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Görünürlük">
          {VISIBILITY.map((v) => (
            <button key={v.value} type="button" role="radio" aria-checked={visibility === v.value} disabled={v.value === "HERKES" && !canPublish} onClick={() => setVisibility(v.value)}
              className={cn("rounded-md border p-2 text-left text-sm disabled:opacity-50", visibility === v.value ? "border-primary bg-primary/10" : "hover:bg-muted")}>
              <span className="block font-medium">{v.label}</span>
              <span className="block text-xs text-muted-foreground">{v.hint}</span>
            </button>
          ))}
        </div>
        {visibility === "PAYLASIMLI" ? (
          <div className="flex flex-col gap-2">
            <Input placeholder="Kişi ara…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Kişi ara" />
            <ul className="max-h-64 overflow-auto rounded-md border p-1" aria-label="Kişiler">
              {shown.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
                    <span className="truncate">{u.ad}</span>
                  </label>
                  {picked.has(u.id) ? (
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => flip(u.id)}>
                      {picked.get(u.id) === "GOR" ? "Görebilir" : "Düzenleyebilir"}
                    </Button>
                  ) : null}
                </li>
              ))}
              {shown.length === 0 ? <li className="px-2 py-3 text-sm text-muted-foreground">Kişi bulunamadı.</li> : null}
            </ul>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button type="button" disabled={save.isPending || current.isLoading} onClick={() => save.mutate()}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
