import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { systemLogService } from "@/services/systemLogService";
import { AuditDataBlock } from "@/components/AuditDataBlock";
import { tableLabel, actionLabel, actionVariant } from "./labels";

interface Props {
  logId: string | null;
  onClose: () => void;
  source?: "active" | "archive";
}

export function ActivityDetailSheet({ logId, onClose, source = "active" }: Props) {
  const query = useQuery({
    queryKey: ["system-log", source, logId],
    queryFn: () =>
      (source === "archive"
        ? systemLogService.findArchiveById(logId!)
        : systemLogService.findById(logId!)
      ).then((r) => r.data),
    enabled: !!logId,
    staleTime: 60_000,
  });

  return (
    <Sheet open={!!logId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Aktivite Detayı</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {query.isLoading ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </>
          ) : query.data ? (
            <>
              <div className="space-y-2 rounded-md border bg-card/40 p-3 text-sm">
                <Row label="Kullanıcı">
                  {query.data.user
                    ? `${query.data.user.fullName || query.data.user.username}`
                    : "Sistem"}
                </Row>
                <Row label="Modül">{tableLabel(query.data.tableName)}</Row>
                <Row label="İşlem">
                  <Badge variant={actionVariant(query.data.action)}>
                    {actionLabel(query.data.action)}
                  </Badge>
                </Row>
                <Row label="Kayıt ID">
                  <span className="font-mono text-xs">{query.data.recordId}</span>
                </Row>
                <Row label="Tarih">
                  {format(new Date(query.data.createdAt), "dd.MM.yyyy HH:mm:ss", {
                    locale: tr,
                  })}
                </Row>
              </div>

              {/* ⚠️ `tableName` bağlam OLARAK geçer: bazı enum değerleri iki
                  enum'da çelişir (`PURCHASE` fatura türü ↔ fiyat türü) ve
                  yalnız `TABLO.alan` çifti onları ayırabilir. */}
              <AuditDataBlock
                title="Önceki Değer"
                data={query.data.oldData}
                tableName={query.data.tableName}
              />
              <AuditDataBlock
                title="Yeni Değer"
                data={query.data.newData}
                tableName={query.data.tableName}
              />
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

