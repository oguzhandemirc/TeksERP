import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import { workSessionService } from "./service";
import {
  endReasonLabels,
  endReasonTooltip,
  formatDurationMinutes,
  placeLabel,
  sessionDurationMinutes,
  type WorkSessionItem,
} from "./types";
import { defaultRange } from "./activity-utils";
import { SessionActivityList } from "./SessionActivityList";
import { DateRangeInput } from "@/components/forms/DateRangeInput";

const PAGE_SIZE = 25;

/** Cihaz ayak izinde satırın birincil etiketi = KULLANICI; kullanıcı ayak izinde = CİHAZ. */
type Variant = "device" | "user";

/**
 * Bir cihazın VEYA kullanıcının çalışma oturumları — tarih aralığı ZORUNLU (varsayılan
 * son 7 gün). Oturum satırı genişletilince o pencerenin işlem dökümü lazy yüklenir.
 * Cihaz ve kullanıcı ayak izi tek bileşeni paylaşır (yalnız filtre + satır etiketi farklı).
 */
export function SessionHistoryList({
  filter,
  variant,
}: {
  filter: { deviceId: string } | { userId: string };
  variant: Variant;
}) {
  const initial = defaultRange(7);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["work-sessions", "history", { ...filter, from, to, page }],
    queryFn: () =>
      workSessionService.history({
        ...filter,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });
  const rows = q.data?.data ?? [];
  const pagination = q.data?.pagination;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const emptyText =
    variant === "device"
      ? "Bu aralıkta cihazın çalışma oturumu yok."
      : "Bu aralıkta kullanıcının çalışma oturumu yok.";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Oturumlar</span>
        <DateRangeInput
          from={from}
          to={to}
          onFrom={(v) => { setFrom(v); setPage(1); }}
          onTo={(v) => { setTo(v); setPage(1); }}
          inputClassName="h-9 w-40"
          fromLabel="Oturum tarihi başlangıcı"
          toLabel="Oturum tarihi bitişi"
        />
      </div>

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="rounded-md border py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              variant={variant}
              open={expanded.has(s.id)}
              onToggle={() => toggle(s.id)}
            />
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{`${pagination.total} oturum · sayfa ${pagination.page}/${pagination.totalPages}`}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1 || q.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-4 w-4" /> Önceki
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pagination.totalPages || q.isFetching} onClick={() => setPage((p) => p + 1)}>
              Sonraki <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session: s,
  variant,
  open,
  onToggle,
}: {
  session: WorkSessionItem;
  variant: Variant;
  open: boolean;
  onToggle: () => void;
}) {
  const live = !s.endedAt;
  // Cihaz ayak izi: kim (kullanıcı) çalıştı. Kullanıcı ayak izi: hangi cihazdan.
  const primary = variant === "device" ? s.user.fullName : s.device.name;
  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-accent/50"
        >
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
          <span className="font-medium">{primary}</span>
          <span className="text-muted-foreground">{placeLabel(s)}</span>
          {/* Oturum yaşam döngüsü: başladı → bitti (neden) · süre. Soldaki tarih
              BAŞLANGIÇ; rozet (Çıkış/Devralındı…) oturumun NASIL bittiğini söyler. */}
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span title="Oturumun başladığı an">{safeFormat(s.startedAt, "dd.MM.yyyy HH:mm")}</span>
            <span aria-hidden>→</span>
            {live ? (
              <>
                <span>şu an</span>
                <Badge>Açık</Badge>
              </>
            ) : (
              <>
                <span title="Oturumun bittiği an">{safeFormat(s.endedAt, "HH:mm")}</span>
                {s.endReason && (
                  <Badge variant="outline" title={endReasonTooltip(s)}>
                    {endReasonLabels[s.endReason]}
                    {s.successor && " ⓘ"}
                  </Badge>
                )}
              </>
            )}
            <span>· {formatDurationMinutes(sessionDurationMinutes(s.startedAt, s.endedAt))}</span>
          </span>
        </button>
        {open && (
          <div className="border-t px-4 py-3">
            <SessionActivityList sessionId={s.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
