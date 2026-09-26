// Kartela Hareketleri sekmesi — kartela olay defterinin salt-okunur dökümü. Arama TAM eşleşmedir
// (kartela barkodu/kart no · çuval no · sevkiyat no · kabul no; el okuyucusu klavye gibi yazar);
// süzme sunucuda, gövde olay defterlerinin ortak zaman çizelgesidir.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StandaloneDateRangeFilter } from "@/components/data-table/FilterBar";
import { EventTimelinePanel } from "@/components/timeline/EventTimeline";
import { KARTELA_EVENT_COLUMNS, getKartelaEvents, type KartelaEventFilter } from "./kartelaEvents";

const DATE_FILTER = { kind: "dateRange", label: "Tarih", defaultField: "createdAt" } as const;

export function KartelaEventsTab() {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sp] = useSearchParams();
  const filter: KartelaEventFilter = {
    search: search || undefined,
    dateFrom: sp.get("dateFrom") ?? undefined,
    dateTo: sp.get("dateTo") ?? undefined,
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <form
        className="flex flex-wrap items-center gap-2 border-b py-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft.trim());
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Kartela · çuval · sevkiyat · kabul no"
          className="h-8 w-72 text-xs"
          aria-label="Kartela hareketlerinde ara"
        />
        <Button type="submit" size="sm" variant="outline">
          Ara
        </Button>
        {search && (
          <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(""); setSearch(""); }}>
            Temizle
          </Button>
        )}
        <StandaloneDateRangeFilter def={DATE_FILTER} />
      </form>
      <EventTimelinePanel
        queryKey={["kartela", "events", filter]}
        resetKey={JSON.stringify(filter)}
        fetchPage={(o) => getKartelaEvents(filter, o)}
        columns={KARTELA_EVENT_COLUMNS}
        testId="kartela-hareketleri"
        fileName={search ? `kartela-hareketleri-${search}` : "kartela-hareketleri"}
        emptyText={search ? "Bu aramaya uyan kartela hareketi yok." : "Henüz kayıtlı kartela hareketi yok."}
      />
    </div>
  );
}

/** Tek kartelanın hareketleri — kartela detay panelindeki bölüm. */
export function SwatchEventsSection({ swatch }: { swatch: { id: string; cardNumber: string } }) {
  const filter: KartelaEventFilter = { swatchId: swatch.id };
  return (
    <div className="flex min-h-[16rem] flex-col">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hareketler</div>
      <EventTimelinePanel
        queryKey={["kartela", "events", filter]}
        resetKey={swatch.id}
        fetchPage={(o) => getKartelaEvents(filter, o)}
        columns={KARTELA_EVENT_COLUMNS}
        testId="kartela-hareketleri"
        fileName={`${swatch.cardNumber}-hareketler`}
        emptyText="Bu kartelanın kayıtlı hareketi yok (defter bu sürümle başladı; önceki hareketler aktarılmadı)."
      />
    </div>
  );
}
