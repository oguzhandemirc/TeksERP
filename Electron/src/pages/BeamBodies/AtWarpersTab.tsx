// "Devereci elinde" sekmesi (devere D3) — deverecide duran boş gövdelerimiz, devereci başına gruplu
// (`GET /api/beam-bodies/at-warpers`; deverecinin kendi gövdesi girmez, sayılar sunucuda). Kabulde gönderilenden farklı
// gövde dönünce gönderilen burada kalır: devereci onu sonraki sarım için saklıyor demektir.
import { useQuery } from "@tanstack/react-query";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { PageBody } from "@/components/layout/PageShell";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { useListSearch } from "@/hooks/useListSearch";
import { fmtFactoryDate } from "@/lib/factory-time";
import { apiErrorMessage } from "@/services/apiClient";
import { atWarperSourceText, getBodiesAtWarpers, type WarperBodyGroup } from "./at-warpers";
import { BEAM_BODIES_QUERY_KEY, beamBodyPath } from "./service";

export function AtWarpersTab() {
  const { search, setSearch, term } = useListSearch();
  const q = useQuery({ queryKey: [BEAM_BODIES_QUERY_KEY, "at-warpers", term], queryFn: () => getBodiesAtWarpers({ search: term }) });
  return (
    <PageBody className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-8 w-60" placeholder="Gövde no ara" aria-label="Gövde no ara" value={search} onChange={(e) => setSearch(e.target.value)} />
        {q.data && <span className="text-sm text-muted-foreground">{q.data.summary.bodyCount} gövde · {q.data.summary.warperCount} devereci</span>}
      </div>
      <p className="text-sm text-muted-foreground">Deverecilere gönderdiğimiz ve henüz dolu dönmemiş boş gövdelerimiz. Devereci gönderdiğimizi sonraki sarım için saklayıp elindeki başka gövdemizle dönebilir; o zaman gönderilen burada kalır.</p>
      {q.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
      {q.isError && <Callout tone="danger">{apiErrorMessage(q.error)}</Callout>}
      {q.data?.truncated && <Callout tone="warning">Liste ilk 1000 gövdeyle sınırlı (toplam {q.data.summary.bodyCount}) — aramayla daraltın.</Callout>}
      {q.data && q.data.data.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{term ? "Aramaya uyan, deverecide duran gövde yok." : "Şu an hiçbir deverecide boş gövdemiz yok."}</p>
      )}
      {q.data?.data.map((g) => <WarperGroup key={g.subcontractor.id} group={g} />)}
    </PageBody>
  );
}

function WarperGroup({ group }: { group: WarperBodyGroup }) {
  const openTarget = useOpenTarget();
  return (
    <section className="rounded-xl border border-card-border bg-card shadow-card" aria-label={group.subcontractor.name}>
      <header className="flex flex-wrap items-center gap-3 border-b px-5 py-2.5">
        <h3 className="font-semibold">{group.subcontractor.name}</h3>
        <span className="text-xs text-muted-foreground">{group.count} gövde</span>
      </header>
      <ul className="divide-y">
        {group.bodies.map((b) => (
          <li key={b.id}>
            <button type="button" className="flex w-full items-center gap-3 px-5 py-2 text-left text-sm hover:bg-muted/50" onClick={() => openTarget(beamBodyPath(b.id))}>
              <span className="w-32 font-mono font-medium">{b.bodyNo}</span>
              <span className="w-40 text-muted-foreground">{b.owner.kind === "OURS" ? b.owner.label : b.owner.customer?.name ?? b.owner.label}</span>
              <span className="flex-1">{atWarperSourceText(b)}</span>
              <span className="tabular-nums text-muted-foreground" title={`Deverecide: ${fmtFactoryDate(b.statusSince)}`}>{b.statusAgeDays} gün</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
