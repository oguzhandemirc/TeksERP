import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { apiErrorMessage } from "@/services/apiClient";
import { safeFormat } from "@/lib/format";
import { deviceService } from "../service";
import { MERGE_CANDIDATES_QUERY_KEY } from "../merge";
import type { DeviceDetail, PastInstallation } from "../types";

const fmt = (iso: string | null) => (iso ? safeFormat(iso, "dd.MM.yyyy HH:mm") : "—");
export const UNDO_MERGE_EFFECT =
  "Kayıt ana kayıttan ayrılır ve PASİF kalır. Birleştirme olayı geçmişte durur; taşınan donanım bağları geri taşınmaz.";

/**
 * Birleşme bağları (D4): kopya kayıtta ana kayda işaret + "Birleştirmeyi geri al";
 * ana kayıtta "Geçmiş kurulumlar" (kopyaların iş oturumları yerinde kalır).
 */
export function MergeLinksCard({ device }: { device: DeviceDetail }) {
  const qc = useQueryClient();
  const openTarget = useOpenTarget();
  const [undoTarget, setUndoTarget] = useState<{ id: string; name: string } | null>(null);
  const undo = useMutation({
    mutationFn: (id: string) => deviceService.undoMerge(id),
    onSuccess: () => {
      toast.success("Birleştirme geri alındı; kayıt pasif olarak ayrıldı");
      setUndoTarget(null);
      void qc.invalidateQueries({ queryKey: ["admin-devices"] });
      void qc.invalidateQueries({ queryKey: [MERGE_CANDIDATES_QUERY_KEY] });
    },
    onError: (e) => {
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istek suppressErrorToast taşır; tek toast burası
      toast.error(apiErrorMessage(e, "Geri alma yapılamadı"));
      setUndoTarget(null);
      void qc.invalidateQueries({ queryKey: ["admin-devices"] });
    },
  });

  const past = device.pastInstallations ?? [];
  const link = device.mergedInto ?? null;
  if (!link && past.length === 0) return null;

  return (
    <>
      {link && (
        <MergedIntoBanner link={link} onOpen={() => openTarget(`/access/devices/${link.id}`)} onUndo={() => setUndoTarget({ id: device.id, name: device.name })} />
      )}
      {past.length > 0 && (
        <PastInstallationsList past={past} onOpen={(id) => openTarget(`/access/devices/${id}`)} onUndo={(p) => setUndoTarget(p)} />
      )}
      <ConfirmDialog
        open={undoTarget !== null}
        onOpenChange={(o) => { if (!o) setUndoTarget(null); }}
        title={`Birleştirmeyi geri al — ${undoTarget?.name ?? ""}`}
        description={UNDO_MERGE_EFFECT}
        confirmLabel="Birleştirmeyi geri al"
        onConfirm={async () => { if (undoTarget) await undo.mutateAsync(undoTarget.id).catch(() => undefined); }}
        isPending={undo.isPending}
      />
    </>
  );
}

function MergedIntoBanner({
  link,
  onOpen,
  onUndo,
}: {
  link: NonNullable<DeviceDetail["mergedInto"]>;
  onOpen: () => void;
  onUndo: () => void;
}) {
  return (
    <Card className="border-sky-300 dark:border-sky-900">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div className="flex min-w-0 items-start gap-2">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-300" />
          <span>
            Bu kayıt <strong className="break-all">{link.name}</strong> ana kaydına birleştirildi ({fmt(link.mergedAt)}). Oturumları
            burada kalır, raporlarda ana kayıt adıyla görünür.
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onOpen}>
            Ana kayda git
          </Button>
          <Button size="sm" variant="outline" onClick={onUndo}>
            <Undo2 className="mr-1 h-4 w-4" /> Birleştirmeyi geri al
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PastInstallationsList({
  past,
  onOpen,
  onUndo,
}: {
  past: PastInstallation[];
  onOpen: (id: string) => void;
  onUndo: (p: { id: string; name: string }) => void;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 text-sm font-semibold">Geçmiş kurulumlar ({past.length})</div>
        <p className="mb-3 text-xs text-muted-foreground">
          Bu cihazın uygulama yeniden kurulmadan önceki kayıtları. İş oturumları kendi kayıtlarında kalır.
        </p>
        <ul className="divide-y text-sm">
          {past.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <button type="button" className="font-medium hover:underline break-all" onClick={() => onOpen(p.id)}>
                  {p.name}
                </button>{" "}
                <span className="font-mono text-xs text-muted-foreground">{p.deviceId.slice(0, 8)}</span>
                <div className="text-xs text-muted-foreground">
                  {fmt(p.createdAt)} → {fmt(p.lastSeenAt)} · {p.workSessionCount} iş oturumu · birleştirme {fmt(p.mergedAt)}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onUndo({ id: p.id, name: p.name })}>
                <Undo2 className="mr-1 h-4 w-4" /> Geri al
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
