import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { systemLogService } from "@/services/systemLogService";
import { AuditDataBlock } from "@/components/AuditDataBlock";
import {
  categoryLabels,
  categoryVariants,
  eventActionLabel,
  eventActionVariant,
} from "./labels";

interface Props {
  logId: string | null;
  onClose: () => void;
}

export function SystemEventDetailSheet({ logId, onClose }: Props) {
  const query = useQuery({
    queryKey: ["system-event", logId],
    queryFn: () => systemLogService.findById(logId!).then((r) => r.data),
    enabled: !!logId,
    staleTime: 60_000,
  });

  return (
    <Sheet open={!!logId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Sistem Kayıt Detayı</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {query.isLoading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-48 w-full" />
            </>
          ) : query.data ? (
            <>
              <div className="space-y-2 rounded-md border bg-card/40 p-3 text-sm">
                <Row label="Kategori">
                  <Badge variant={categoryVariants[query.data.category]}>
                    {categoryLabels[query.data.category]}
                  </Badge>
                </Row>
                <Row label="Olay">
                  <Badge variant={eventActionVariant(query.data.action)}>
                    {eventActionLabel(query.data.action)}
                  </Badge>
                </Row>
                <Row label="Hedef">
                  <span className="font-mono text-xs">
                    {query.data.recordId === "-" ? "—" : query.data.recordId}
                  </span>
                </Row>
                <Row label="Kullanıcı">
                  {query.data.user
                    ? query.data.user.fullName || query.data.user.username
                    : "—"}
                </Row>
                <Row label="IP">
                  <span className="font-mono text-xs">
                    {query.data.ipAddress ?? "—"}
                  </span>
                </Row>
                <Row label="Tarih">
                  {format(new Date(query.data.createdAt), "dd.MM.yyyy HH:mm:ss", {
                    locale: tr,
                  })}
                </Row>
              </div>

              <AuditDataBlock title="Olay Verisi" data={query.data.newData} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Kayıt bulunamadı.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

