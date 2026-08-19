import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, ScanBarcode, Search, Wrench } from "lucide-react";
import { productionReportsApi, type TravelerEvent } from "./service";
import apiClient from "@/services/apiClient";
import { ReportPageLayout } from "../_components";
import { ReportExportBar } from "../_components/ReportExportBar";
import { fmtDateTime, fmtMeters } from "../_components/formatters";
// Etiket sözlükleri dışa aktarım spec'iyle ORTAK: ekranda "Kurşun Geçildi" yazıp
// Excel'de ham enum basmak aynı olayı iki ad altında gösterirdi.
import {
  buildTravelerTraceExport,
  OP_TYPE_LABEL,
  STATION_KIND_LABEL,
} from "./travelerTraceExport";

interface RollLookupItem {
  id: string;
  barcode: string | null;
}

/** Barkod / id parça ile rulo arama (modal dialog yerine inline). */
async function resolveRoll(query: string): Promise<RollLookupItem | null> {
  const q = query.trim();
  if (!q) return null;
  // Barkod tam eşleşme önce
  try {
    const byBarcode = await apiClient.get<{ success: true; data: RollLookupItem[]; pagination: { total: number } }>(
      `/api/rolls?page=1&pageSize=1&filters[barcode]=${encodeURIComponent(q)}`,
    );
    if (byBarcode.data.data.length > 0 && byBarcode.data.data[0]) return byBarcode.data.data[0];
  } catch {
    // ignore, fall through
  }
  return null;
}

export function TravelerTracePage() {
  const [input, setInput] = useState("");
  const [rollId, setRollId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setResolveError(null);
    const trimmed = input.trim();
    if (!trimmed) return;
    // UUID gibi görünüyorsa direkt kullan
    if (/^[0-9a-f-]{32,}$/i.test(trimmed)) {
      setRollId(trimmed);
      return;
    }
    const roll = await resolveRoll(trimmed);
    if (!roll) {
      setResolveError("Barkod / rulo bulunamadı");
      return;
    }
    setRollId(roll.id);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["reports", "production", "traveler-trace", rollId],
    queryFn: () => productionReportsApi.travelerTrace(rollId!),
    enabled: Boolean(rollId),
    staleTime: 30_000,
  });

  const searchFilter = (
    <div className="border-b px-4 py-3">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Barkod veya rulo ID gir..."
          className="h-8 max-w-sm"
        />
        <Button type="submit" size="sm" className="h-8 gap-1">
          <Search className="h-3.5 w-3.5" />
          Ara
        </Button>
        {resolveError ? <span className="text-xs text-destructive">{resolveError}</span> : null}
      </form>
    </div>
  );

  return (
    <ReportPageLayout
      title="Refakat Kartı İzleme"
      description="Tek rulonun istasyon adımları, operatör ve süre geçmişi."
      filters={searchFilter}
      actions={
        <ReportExportBar
          disabled={!data}
          buildSpec={() => (data ? buildTravelerTraceExport(data.data) : null)}
        />
      }
    >
      {!rollId ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Bir rulo barkodu girip arayın.
        </Card>
      ) : isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Yükleniyor...</Card>
      ) : !data ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Rulo bulunamadı.</Card>
      ) : (
        <TraceContent trace={data.data} />
      )}
    </ReportPageLayout>
  );
}

function TraceContent({ trace }: { trace: NonNullable<Awaited<ReturnType<typeof productionReportsApi.travelerTrace>>>["data"] }) {
  const { roll, events } = trace;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Rulo</p>
            <p className="text-lg font-semibold tracking-tight">{roll.barcode ?? "(barkodsuz)"}</p>
          </div>
          <Badge variant="outline">{roll.status}</Badge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Kalite</p>
            <p className="font-medium">{roll.qualityGrade ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">İlk Metraj</p>
            <p className="font-medium">{fmtMeters(roll.initialQty)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Mevcut Metraj</p>
            <p className="font-medium">{fmtMeters(roll.currentQty)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">En</p>
            <p className="font-medium">{roll.width ? `${roll.width} cm` : "—"}</p>
          </div>
        </div>
      </Card>

      <Card className="p-0">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold tracking-tight">Zaman Çizelgesi</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{events.length} olay</p>
        </div>
        {events.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground/60">Olay bulunmuyor.</div>
        ) : (
          <ol className="divide-y">
            {events.map((ev, idx) => (
              <TraceEvent key={idx} ev={ev} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function TraceEvent({ ev }: { ev: TravelerEvent }) {
  const Icon = ev.type === "MOVEMENT_IN" ? ArrowDown : ev.type === "MOVEMENT_OUT" ? ArrowUp : Wrench;
  const tone =
    ev.type === "MOVEMENT_IN"
      ? "text-info bg-info/10"
      : ev.type === "MOVEMENT_OUT"
        ? "text-success bg-success/10"
        : "text-warning bg-warning/10";
  const title =
    ev.type === "MOVEMENT_IN"
      ? `${ev.stationName} — Giriş`
      : ev.type === "MOVEMENT_OUT"
        ? `${ev.stationName} — Çıkış`
        : `${ev.stationName} — ${OP_TYPE_LABEL[ev.operationType ?? ""] ?? ev.operationType}`;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-md ${tone}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium leading-tight">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {fmtDateTime(ev.at)}
          {ev.stationKind ? ` · ${STATION_KIND_LABEL[ev.stationKind] ?? ev.stationKind}` : ""}
          {ev.operatorName ? ` · ${ev.operatorName}` : ""}
          {ev.machineName ? ` · ${ev.machineName}` : ""}
          {ev.qty !== null ? ` · ${fmtMeters(ev.qty)}` : ""}
        </p>
        {ev.notes ? <p className="mt-1 text-xs italic text-muted-foreground/80">{ev.notes}</p> : null}
      </div>
      <ScanBarcode className="hidden h-4 w-4 text-muted-foreground/40" />
    </li>
  );
}
