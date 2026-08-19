import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { systemLogService } from "@/services/systemLogService";
import type { AuditChange } from "@/types/systemLog";
import { AuditDataBlock } from "@/components/AuditDataBlock";
import { AuditChangeList } from "@/components/AuditChangeList";
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

  // Elle yazılmış audit yükleri gerekçeyi `newData.reason`da taşır (renk
  // değişikliği, iptal, manuel düzeltme…). Diff satırı "ne", gerekçe "neden"
  // sorusunu cevaplar — ham JSON'ın içinde kaybolmamalı.
  const log = query.data;
  const changes = (log?.changes ?? []) as AuditChange[];
  const reasonText = pickReason(log?.newData);

  // ── AYNI İŞLEMDEKİ DİĞER KAYITLAR (2026-08-19) ──────────────────────────
  // Bir kaydetme tuşu birden çok audit satırı üretir (iş emri + adımlar +
  // sipariş bağları). `requestId` onları bağlar; SAP'ta bu bilgi `CDHDR`
  // başlığında yaşar.
  // ⚠️ requestId YOKSA sorgu HİÇ atılmaz: null filtre backend'de "filtre yok"
  // anlamına gelir ve alakasız satırlar dönerdi. Eski (19.08.2026 öncesi) ve
  // iş/script kaynaklı kayıtlarda bölüm hiç çizilmez.
  const requestId = log?.requestId ?? null;
  const siblingQuery = useQuery({
    queryKey: ["system-log-siblings", source, requestId],
    queryFn: () =>
      (source === "archive"
        ? systemLogService.listArchive({ requestId: requestId!, limit: 20 })
        : systemLogService.list({ requestId: requestId!, limit: 20 })
      ).then((r) => r.data),
    enabled: !!logId && !!requestId,
    staleTime: 60_000,
  });
  const siblings = (siblingQuery.data ?? []).filter((r) => r.id !== log?.id);

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
                {requestId && (
                  <Row label="İşlem no">
                    <span
                      className="font-mono text-xs text-muted-foreground"
                      title={requestId}
                    >
                      {requestId.slice(0, 8)}
                    </span>
                  </Row>
                )}
              </div>

              {/* AYNI İŞLEMDE — tek kaydetme tuşunun ürettiği diğer satırlar.
                  ⚠️ SIRA VAADİ YOK: satırlar aynı transaction'da, aynı
                  `createdAt` ile yazılır ve id'leri rastgeledir; "önce şu oldu"
                  denemez, yalnız "aynı işlem" denir. */}
              {requestId && siblings.length > 0 && (
                <div className="rounded-md border bg-card/40 p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Aynı işlemde ({siblings.length} kayıt daha)
                  </div>
                  <div className="space-y-1">
                    {siblings.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                        <Badge variant={actionVariant(s.action)} className="text-[10px]">
                          {actionLabel(s.action)}
                        </Badge>
                        <span>{tableLabel(s.tableName)}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {s.recordId}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* NE DEĞİŞTİ — birincil okuma yüzeyi. Ham JSON blokları altta ve
                  KATLI durur: adli inceleme için gerekli, günlük okuma için
                  gürültü. Eskiden yalnız ham bloklar vardı ve renk değişikliği
                  ekranda "targetColorId: 91cd… → bb82…" diye görünüyordu. */}
              {changes.length > 0 ? (
                <div className="rounded-md border bg-card/40 p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Ne değişti
                  </div>
                  <AuditChangeList changes={changes} />
                  {reasonText && (
                    <div className="mt-2 border-t pt-2 text-sm">
                      <span className="text-muted-foreground">Gerekçe: </span>
                      {reasonText}
                    </div>
                  )}
                </div>
              ) : query.data.action === "UPDATE" ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Alan-bazlı ayrıntı kaydedilmemiş (19.08.2026 öncesi kayıt) — aşağıdaki
                  ham veriye bak.
                </div>
              ) : null}

              <details className="rounded-md border bg-card/20 p-2">
                <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">
                  Ham veri (teknik)
                </summary>
                <div className="mt-2 space-y-3">
                  <AuditDataBlock title="Önceki Değer" data={query.data.oldData} />
                  <AuditDataBlock title="Yeni Değer" data={query.data.newData} />
                </div>
              </details>
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


/** `newData` içindeki gerekçe alanını bulur — çağrı noktaları farklı ad kullanıyor. */
function pickReason(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  for (const k of ["reason", "sebep", "cancelReason", "reissueReason", "voidReason"]) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
