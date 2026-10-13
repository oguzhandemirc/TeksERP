// Dokuma İş Emri seçici (modal içinde liste; combobox yok) — "İş ver"in ortak işi ve tezgah başına iş (C.6) aynı listeyi kullanır.
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { foldedIncludes } from "@/lib/search-fold";
import { NO_JOB } from "./plan";
import type { JobOption } from "./runService";

export function JobPicker({ jobs, required, value, onChange, label = "Dokuma İş Emri" }: { jobs: JobOption[]; required: boolean; value: string | null; onChange: (v: string) => void; label?: string }) {
  const [q, setQ] = useState("");
  const shown = jobs.filter((j) => foldedIncludes(`${j.weavingOrderNumber} ${j.item.code} ${j.item.name} ${j.warpSpec?.code ?? ""}`, q));
  return (
    <div className="space-y-2">
      <Input placeholder="Dokuma İş Emri ara (no, kumaş, çözgü)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Dokuma İş Emri ara" />
      <div role="radiogroup" aria-label={label} className="max-h-[45vh] overflow-auto rounded border">
        {!required && (
          <JobRow id={NO_JOB} checked={value === NO_JOB} onChange={onChange} title="İşsiz (numune) koşum" sub="Dokuma İş Emrine bağlanmaz" />
        )}
        {shown.map((j) => (
          <JobRow
            key={j.id}
            id={j.id}
            checked={value === j.id}
            onChange={onChange}
            title={j.weavingOrderNumber}
            sub={[j.item.name, j.warpSpec ? `çözgü ${j.warpSpec.code}` : null, j.plannedM !== null ? `${j.plannedM} m` : null, j.status === "IN_PROGRESS" ? "devam ediyor" : "planlandı"].filter(Boolean).join(" · ")}
          />
        ))}
        {shown.length === 0 && <p className="p-3 text-sm text-muted-foreground">Açık Dokuma İş Emri yok.</p>}
      </div>
    </div>
  );
}

function JobRow({ id, checked, onChange, title, sub }: { id: string; checked: boolean; onChange: (v: string) => void; title: string; sub: string }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={() => onChange(id)} className={`block w-full border-b px-3 py-2 text-left last:border-b-0 ${checked ? "bg-primary/10" : "hover:bg-muted"}`}>
      <div className="font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </button>
  );
}
