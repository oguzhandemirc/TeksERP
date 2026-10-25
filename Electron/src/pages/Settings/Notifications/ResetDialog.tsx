// "Varsayılana dön…" (yıkıcı → önizleme + kayıt başına seçim): sunucu kişinin sapma satırlarını listeler,
// yalnız SEÇİLENLER silinir; ardından form sunucudan yeniden kurulur.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NOTIFICATION_QUERY_KEY } from "@/lib/bildirim/hooks";
import type { NotificationChannel } from "@/lib/bildirim/types";
import { bildirimService } from "@/services/bildirimService";

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  UYGULAMA: "Uygulama içi",
  OZET: "Gün özeti",
  MASAUSTU: "Masaüstü",
  TABLET_SES: "Tablet sesi",
  PATRON_PUSH: "Patron uygulaması",
};

export function ResetDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const q = useQuery({
    queryKey: [...NOTIFICATION_QUERY_KEY, "varsayilana-don"],
    queryFn: () => bildirimService.varsayilanaDonOnizleme(),
    enabled: open,
    retry: false,
    gcTime: 0,
  });
  const rows = q.data?.satirlar ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => setSelected(new Set((q.data?.satirlar ?? []).map((r) => r.id))), [q.data]);
  const apply = async () => {
    setBusy(true);
    try {
      const r = await bildirimService.varsayilanaDon([...selected]);
      toast.success(`${r.silinen} tercih varsayılana döndü.`);
      onDone();
    } catch {
      toast.error("Tercihler varsayılana döndürülemedi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(36rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Varsayılana dön</DialogTitle>
          <DialogDescription>Seçtiğiniz kişisel tercihler silinir; o türlerde görevinizin ve fabrikanın varsayılanı geçerli olur.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Varsayılandan sapan tercihiniz yok.</p>
        ) : (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto" aria-label="Varsayılandan sapan tercihler">
            {rows.map((r) => (
              <li key={r.id}>
                <label className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted/60">
                  <Checkbox
                    checked={selected.has(r.id)}
                    onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v === true) n.add(r.id); else n.delete(r.id); return n; })}
                  />
                  <span>
                    {r.ad}
                    <span className="block text-xs text-muted-foreground">{CHANNEL_LABEL[r.kanal] ?? r.kanal}: {r.acik ? "açık" : "kapalı"}{r.kapsam ? " · kapsamlı" : ""}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={selected.size === 0 || busy} onClick={() => void apply()}>
            {selected.size} tercihi varsayılana döndür
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
