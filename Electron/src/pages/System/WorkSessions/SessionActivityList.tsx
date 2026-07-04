import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Cog, LogIn, LogOut, PackagePlus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFormat } from "@/lib/format";
import { workSessionService } from "./service";
import type { SessionActivityEvent } from "./types";
import { formatDurationMinutes } from "./types";
import {
  eventDetail,
  eventLabel,
  noteLabel,
  rollLabel,
  rollSubLabel,
  summaryLine,
} from "./activity-utils";

const KIND_ICON = {
  ROLL_CREATED: PackagePlus,
  OPERATION: Cog,
  MOVE_IN: LogIn,
  MOVE_OUT: LogOut,
  ERROR: AlertTriangle,
  ROLL_CANCELLED: Trash2,
} as const;

/**
 * Bir oturumun penceresindeki işlem dökümü — KRONOLOJİK (giriş → hata → işlem → çıkış).
 * Oturum satırı genişletilince mount edilir → sorgu o zaman koşar (lazy). Döküm tek
 * bir oturuma kapalı olduğundan tek çekiş; üst sınır aşılırsa truncation uyarısı.
 */
export function SessionActivityList({ sessionId }: { sessionId: string }) {
  const query = useQuery({
    queryKey: ["work-sessions", "activity", sessionId],
    queryFn: () => workSessionService.activity(sessionId),
    staleTime: 30_000,
  });

  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.isError || !query.data) {
    return <p className="py-3 text-sm text-destructive">Döküm yüklenemedi.</p>;
  }

  const { summary, events } = query.data.data;
  const summaryText = summaryLine(summary);

  return (
    <div className="space-y-2">
      {summaryText && <p className="text-xs text-muted-foreground">{summaryText}</p>}

      {events.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          Bu oturum penceresinde bu operatöre/makineye atfedilebilen işlem yok. (Tartı/paket ve
          sevkiyat hareketleri bu dökümün kapsamı dışındadır.)
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {events.map((e) => (
            <EventRow key={`${e.kind}:${e.id}`} event={e} />
          ))}
        </ul>
      )}

      {query.data.truncated && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Bu oturumda {query.data.max}'den fazla işlem var — yalnızca ilk {query.data.max} olay
          gösteriliyor.
        </p>
      )}
    </div>
  );
}

function EventRow({ event: e }: { event: SessionActivityEvent }) {
  const Icon = KIND_ICON[e.kind];
  const detail = eventDetail(e);
  // Kapanış işaretçisi (İptal / Tambur kesimi / Redye) — "0 m çıkış" aslında
  // iptal olabilir; işaretsiz gösterilirse normal çıkışla karışır.
  const note = e.kind === "MOVE_OUT" || e.kind === "MOVE_IN" ? noteLabel(e.notes) : null;
  const isError = e.kind === "ERROR";
  const isCancel = e.kind === "ROLL_CANCELLED";
  const labelTone = isError
    ? "text-amber-600 dark:text-amber-400"
    : isCancel
      ? "text-rose-600 dark:text-rose-400"
      : "";
  const subLabel = rollSubLabel(e.roll);
  // MOVE_OUT: girişten çıkışa AÇIK etiketle — "Giriş … → Çıkış … · N dk kaldı".
  // Giriş başka oturumda olsa bile movement'ın kendi enteredAt/exitedAt'inden gelir;
  // satır tek başına net (soldaki damga çıkış anı, burada ikisi de yazılı).
  const moveOutInfo =
    e.kind === "MOVE_OUT" && e.enteredAt
      ? `Giriş ${safeFormat(e.enteredAt, "dd.MM HH:mm")} → Çıkış ${safeFormat(e.at, "dd.MM HH:mm")}` +
        (e.stayMinutes != null
          ? ` · ${e.stayMinutes === 0 ? "<1 dk" : formatDurationMinutes(e.stayMinutes)} kaldı`
          : "")
      : "";

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
        {safeFormat(e.at, "dd.MM HH:mm:ss")}
      </span>
      <span className={`flex items-center gap-1.5 font-medium ${labelTone}`}>
        <Icon className="h-3.5 w-3.5" />
        {eventLabel(e)}
      </span>
      <span className="font-medium">{rollLabel(e.roll)}</span>
      {subLabel && <span className="font-mono text-xs text-muted-foreground">{subLabel}</span>}
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      {moveOutInfo && <span className="text-xs text-muted-foreground">{moveOutInfo}</span>}
      {note &&
        (note.known ? (
          <Badge variant="muted">{note.label}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{note.label}</span>
        ))}
      {/* Sağ küme: yer + (varsa) makine + operatör. Makine adının VARLIĞI kaydın o
          makinede yapıldığını gösterir; iptal/hata/giriş gibi türlerde makine
          tutulmadığından makine adı yoktur (ayrı "kesinlik" rozetine gerek kalmaz). */}
      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span>{e.station.name}</span>
        {e.machine && <span className="font-mono">{e.machine.code}</span>}
        {e.operator && <span>{e.operator.fullName}</span>}
      </span>
    </li>
  );
}
