// Bekleyen Kabul — kartela firmasındaki (AT_KARTELA) toplar, sevke göre gruplu. Liste tek istekte gelir
// (`/outstanding`, sunucu tavanı 2000) → arama istemcide (EL-15), tabletle aynı alanlarda.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { safeFormat } from "@/lib/format";
import { kartelaService } from "./service";
import { filterJobs, groupOutstanding, type KartelaJob } from "./kartelaActions";
import { KartelaReceiveDialog } from "./KartelaReceiveDialog";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1, useGrouping: false });

export function OutstandingTab() {
  const [search, setSearch] = useState("");
  const [job, setJob] = useState<KartelaJob | null>(null);
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("kartela:write");
  const q = useQuery({
    queryKey: ["kartela", "outstanding"],
    queryFn: () => kartelaService.outstanding(),
    staleTime: 0, // tablet kabulü/iptali anında görünsün
  });
  const jobs = useMemo(() => groupOutstanding(q.data?.data ?? []), [q.data]);
  const shown = useMemo(() => filterJobs(jobs, search), [jobs, search]);

  return (
    <>
      <ListToolbar>
        <div className="relative w-80">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" aria-label="Bekleyen kabullerde ara" placeholder="Firma, sevk no, kumaş, renk ya da top barkodu…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </ListToolbar>
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : shown.length === 0 ? (
          <ListMessage className="text-sm text-muted-foreground">
            {jobs.length === 0 ? "Kartela firmalarında kabul bekleyen top yok." : "Aramaya uyan sevk yok."}
          </ListMessage>
        ) : (
          <JobsTable jobs={shown} onOpen={canWrite ? setJob : undefined} />
        )}
      </ListBody>
      <ListFooter loaded={shown.length} label={`${shown.length} sevk · ${shown.reduce((s, j) => s + j.rolls.length, 0)} top bekliyor`} />
      <KartelaReceiveDialog job={job} onClose={() => setJob(null)} />
    </>
  );
}

function JobsTable({ jobs, onOpen }: { jobs: KartelaJob[]; onOpen?: (j: KartelaJob) => void }) {
  return (
    <Table data-testid="bekleyen-kabul">
      <TableHeader>
        <TableRow>
          <TableHead>Sevk No</TableHead>
          <TableHead>Tarih</TableHead>
          <TableHead>Firma</TableHead>
          <TableHead>Kumaş / Renk</TableHead>
          <TableHead className="text-right">Top</TableHead>
          <TableHead className="text-right">Metre</TableHead>
          <TableHead className="w-32" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((j) => (
          <TableRow key={j.dispatchId} className={onOpen ? "cursor-pointer" : undefined} onClick={() => onOpen?.(j)}>
            <TableCell className="font-mono text-xs">{j.dispatchNo}</TableCell>
            <TableCell className="whitespace-nowrap">{safeFormat(j.dispatchedAt, "dd.MM.yyyy HH:mm")}</TableCell>
            <TableCell>{j.firm.name}</TableCell>
            <TableCell className="max-w-[20rem] truncate">
              {[j.itemNames[0], j.colorNames[0]].filter(Boolean).join(" · ") || "—"}
              {j.itemNames.length > 1 ? ` (+${j.itemNames.length - 1} kumaş)` : ""}
            </TableCell>
            <TableCell className="text-right tabular-nums">{j.rolls.length}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtM(j.totalQty)}</TableCell>
            <TableCell className="text-right">
              <PermissionGate permission="kartela:write">
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); onOpen?.(j); }}>
                  <PackageCheck className="h-3.5 w-3.5" /> Kabul Et
                </Button>
              </PermissionGate>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
