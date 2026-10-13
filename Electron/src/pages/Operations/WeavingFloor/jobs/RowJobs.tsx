// Tezgah başına iş (tasarım §C.6): her tezgah satırında geçerli iş + "Başka iş…" (seçici modal açar); ortak işi seçmek
// "hepsine aynı işi uygula"dır ve tezgah başına seçimleri sıfırlar (`AssignJobDialog`). Gönderim yine tek istek.
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LiveLoom } from "../types";
import { JobPicker } from "./JobPicker";
import { NO_JOB, effectiveJobOf } from "./plan";
import type { JobOption } from "./runService";

interface Props {
  looms: readonly LiveLoom[];
  jobs: JobOption[];
  required: boolean;
  shared: string | null;
  overrides: ReadonlyMap<string, string>;
  /** `null` = tezgah ortak işe döner. */
  onPick: (loomId: string, jobId: string | null) => void;
}

export function jobLabelOf(jobs: readonly JobOption[], id: string | null): string {
  if (id === null) return "İş seçilmedi";
  if (id === NO_JOB) return "İşsiz (numune)";
  return jobs.find((j) => j.id === id)?.weavingOrderNumber ?? "İş listede yok";
}

export function RowJobs({ looms, jobs, required, shared, overrides, onPick }: Props) {
  const [editing, setEditing] = useState<LiveLoom | null>(null);
  return (
    <section aria-label="Tezgah başına iş" className="space-y-1">
      <p className="text-sm font-medium">Tezgah başına iş</p>
      <ul className="max-h-[30vh] divide-y overflow-auto rounded border text-sm">
        {looms.map((l) => {
          const own = overrides.has(l.id);
          return (
            <li key={l.id} data-loom={l.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="w-28 font-medium">{l.code}</span>
              <span className="flex-1">
                {jobLabelOf(jobs, effectiveJobOf(l.id, shared, overrides))}
                {!own && <span className="text-xs text-muted-foreground"> · ortak</span>}
              </span>
              {own && (
                <Button type="button" size="sm" variant="ghost" onClick={() => onPick(l.id, null)} aria-label={`${l.code} ortak işe dön`}>
                  Ortak işe dön
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(l)} aria-label={`${l.code} için başka iş`}>
                Başka iş…
              </Button>
            </li>
          );
        })}
      </ul>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.code} için iş</DialogTitle>
          </DialogHeader>
          {editing && (
            <JobPicker
              label={`${editing.code} için Dokuma İş Emri`}
              jobs={jobs}
              required={required}
              value={effectiveJobOf(editing.id, shared, overrides)}
              onChange={(v) => {
                onPick(editing.id, v);
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
