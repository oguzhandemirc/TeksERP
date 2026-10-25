import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { customReportApi } from "./custom-api";

/** Sürüm geçmişi — sürümler değişmez ve silinmez; eski hâle dönmek yeni sürüm kaydetmektir. */
export function VersionsDialog({ definitionId, open, onClose }: { definitionId: string; open: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ["custom-report-versions", definitionId], queryFn: () => customReportApi.versions(definitionId), enabled: open });
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sürümler</DialogTitle>
          <DialogDescription>Her kayıt yeni bir sürüm açar; eski sürümler olduğu gibi saklanır.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Yükleniyor…</p> : null}
        <ol className="flex max-h-80 flex-col gap-1 overflow-auto">
          {(q.data ?? []).map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="flex items-center gap-2 font-medium">
                Sürüm {v.no} {v.aktif ? <Badge variant="secondary">Yürürlükte</Badge> : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {v.tarihMetni}
                {v.yazan ? ` · ${v.yazan}` : ""}
                {v.not ? ` · ${v.not}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
