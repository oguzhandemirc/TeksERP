import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { loadAllForPicker } from "@/lib/picker-loader";
import { safeFormat } from "@/lib/format";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import type { ExportColumn } from "@/lib/list-export";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { deviceService } from "@/pages/Devices/service";
import { machineService } from "@/pages/Machines/service";
import { stationService } from "@/pages/Stations/service";
import { adminUserService } from "@/services/adminUserService";
import { workSessionService } from "./service";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { endReasonLabels, formatDurationMinutes, sessionDurationMinutes, type WorkSessionItem } from "./types";
import { useSessionHistoryTable } from "./historyColumns";

const PAGE_SIZE = 25;
const SELECT_CLS = "h-9 rounded-md border border-input bg-background px-2 text-sm";

// Dışa aktarım sütunları — ekrandaki "Yer" kolonu dosyada İSTASYON + MAKİNE olarak
// ayrılır (süzülebilsin). Süre İKİ kolon: okunur metin ("3 sa 25 dk") + toplanabilir
// dakika (TOPLAM satırı yalnız sayısal kolondan çıkar; "3 sa 25 dk" metni sayıya
// çevrilseydi 325 okunurdu). AÇIK oturumlarda bitiş boş, süre indirme anına göredir.
const SESSION_EXPORT_COLUMNS: ExportColumn<WorkSessionItem>[] = [
  { label: "Kullanıcı", value: (s) => s.user.fullName },
  { label: "İstasyon", value: (s) => s.station.name },
  { label: "Makine", value: (s) => (s.machine ? `${s.machine.code} — ${s.machine.name}` : "") },
  { label: "Cihaz", value: (s) => s.device.name },
  { label: "Başlangıç", value: (s) => safeFormat(s.startedAt, "dd.MM.yyyy HH:mm") },
  { label: "Bitiş", value: (s) => (s.endedAt ? safeFormat(s.endedAt, "dd.MM.yyyy HH:mm") : "Açık") },
  {
    label: "Süre",
    value: (s) => formatDurationMinutes(sessionDurationMinutes(s.startedAt, s.endedAt)),
  },
  {
    label: "Süre (dk)",
    value: (s) => sessionDurationMinutes(s.startedAt, s.endedAt),
    summable: true,
  },
  { label: "Kapanış", value: (s) => (s.endReason ? endReasonLabels[s.endReason] : "") },
];

/**
 * Oturum geçmişi (ayak izi) — kullanıcı/makine/istasyon/tarih filtreli, offset
 * sayfalı (hacim düşük: vardiya başına cihaz başına birkaç satır). "Kim, nerede,
 * ne zaman, nasıl kapandı" sorusunun kalıcı kaydı.
 */
export function HistoryTable() {
  const [userId, setUserId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [stationId, setStationId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const openTarget = useOpenTarget();
  const { search, setSearch, term } = useListSearch();

  const usersQ = useQuery({ queryKey: ["admin-users", "picker"], queryFn: adminUserService.list });
  const devicesQ = useQuery({ queryKey: ["admin-devices", "picker"], queryFn: deviceService.list });
  const machinesQ = useQuery({
    queryKey: ["machines", "picker"],
    queryFn: () => loadAllForPicker(machineService),
  });
  const stationsQ = useQuery({
    queryKey: ["stations", "picker"],
    queryFn: () => loadAllForPicker(stationService),
  });

  const q = useQuery({
    queryKey: ["work-sessions", "history", { userId, deviceId, machineId, stationId, from, to, page, term: term ?? "" }],
    queryFn: () =>
      workSessionService.history({
        userId: userId || undefined,
        deviceId: deviceId || undefined,
        machineId: machineId || undefined,
        stationId: stationId || undefined,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
        search: term,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });
  const rows = q.data?.data ?? [];
  const pagination = q.data?.pagination;
  const table = useSessionHistoryTable(rows, openTarget);

  const resetPage = () => setPage(1);

  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-center">
        <select
          className={SELECT_CLS}
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            resetPage();
          }}
        >
          <option value="">Tüm kullanıcılar</option>
          {(usersQ.data?.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLS}
          value={stationId}
          onChange={(e) => {
            setStationId(e.target.value);
            resetPage();
          }}
        >
          <option value="">Tüm istasyonlar</option>
          {(stationsQ.data?.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLS}
          value={machineId}
          onChange={(e) => {
            setMachineId(e.target.value);
            resetPage();
          }}
        >
          <option value="">Tüm makineler</option>
          {(machinesQ.data?.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.code} — {m.name}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLS}
          value={deviceId}
          onChange={(e) => {
            setDeviceId(e.target.value);
            resetPage();
          }}
        >
          <option value="">Tüm cihazlar</option>
          {(devicesQ.data?.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <DateRangeInput
          from={from}
          to={to}
          onFrom={(v) => {
            setFrom(v);
            resetPage();
          }}
          onTo={(v) => {
            setTo(v);
            resetPage();
          }}
          inputClassName="h-9 w-40"
          fromLabel="Oturum tarihi başlangıcı"
          toLabel="Oturum tarihi bitişi"
        />
        <div className="ml-auto flex items-center gap-1.5">
          <ListSearchBox
            value={search}
            onSearchChange={(v) => {
              setSearch(v);
              resetPage();
            }}
            searchHint="Kullanıcı, cihaz, makine ya da istasyon (ad/kod) ara"
          />
          {/* Dosya kendi sütunlarıyla iner (İstasyon/Makine ayrı, toplanabilir dakika) — tablo menüsünde ikinci indirme yok. */}
          <DataTableTools table={table} compact hideExport />
          <ListExportMenu
            name="Çalışma Oturumları"
            rows={rows}
            columns={SESSION_EXPORT_COLUMNS}
            notes={[
              // ⚠️ Liste offset SAYFALI — dosyaya yalnız EKRANDAKİ sayfa iner. Bunu
              // yazmazsak kullanıcı 25 satırlık dosyayı "tüm geçmiş" sanır.
              pagination && pagination.totalPages > 1
                ? `Yalnız görüntülenen sayfa: ${rows.length} oturum (sayfa ${pagination.page}/${pagination.totalPages}, filtreye uyan toplam ${pagination.total}). Diğer sayfalar dosyaya girmez.`
                : `Filtreye uyan ${rows.length} oturum.`,
              "Filtreler (kullanıcı / istasyon / makine / cihaz / tarih / arama) dosyaya birebir yansır.",
              "Açık oturumlarda bitiş boştur; süre indirme anına göre hesaplanır.",
            ]}
          />
        </div>
      </ListToolbar>

      {!q.isLoading && rows.length > 0 ? (
        <DataTable table={table} exportName="Çalışma Oturumları" />
      ) : (
        <ListBody>
          {q.isLoading ? (
            <ListMessage>
              <Skeleton className="h-64 w-full" />
            </ListMessage>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{term ? "Aramaya uyan oturum yok." : "Filtrelere uyan oturum yok."}</p>
          )}
        </ListBody>
      )}

      <ListFooter
        loaded={rows.length}
        label={pagination ? `${pagination.total} oturum · sayfa ${pagination.page}/${pagination.totalPages}` : ""}
      >
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || q.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" /> Önceki
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!pagination || page >= pagination.totalPages || q.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Sonraki <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </ListFooter>
    </>
  );
}
