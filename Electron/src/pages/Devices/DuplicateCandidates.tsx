import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { safeFormat } from "@/lib/format";
import { deviceKindLabel } from "./DeviceRow";
import { MergeDialog } from "./MergeDialog";
import { CONFIDENCE_LABEL, useMergeCandidates } from "./merge";
import type { MergeCandidateGroup } from "./types";

/**
 * Cihazlar sayfası şeridi (D4): aynı fiziksel cihazın yeniden kurulumla doğmuş olabilecek kopyaları.
 * Sezgi yalnız ÖNERİDİR — birleştirme önizleme + kayıt kayıt onayla yapılır. Eski backend → gizli.
 */
export function DuplicateCandidates({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const query = useMergeCandidates();
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [group, setGroup] = useState<MergeCandidateGroup | null>(null);
  const groups = query.data?.groups ?? [];
  if (groups.length === 0) return null;

  return (
    <section aria-label="Kopya olabilecek kayıtlar" className="rounded-md border border-sky-300 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-sky-900 dark:text-sky-200">
          <Copy className="h-4 w-4 shrink-0" />
          Kopya olabilecek kayıtlar ({groups.length} grup)
        </div>
        <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? "Gizle" : "İncele"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Aynı tablet uygulama yeniden kurulunca yeni kayıt açılmış olabilir. Birleştirme otomatik yapılmaz; her grubu
        önizleyip kayıt kayıt seçin.
      </p>
      {expanded && (
        <ul className="mt-3 divide-y divide-sky-200 dark:divide-sky-900/60">
          {groups.map((g) => (
            <li key={g.target.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium break-all">{g.target.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {deviceKindLabel(g.kind)} · {g.sources.length} kopya · son görülme{" "}
                  {g.target.lastSeenAt ? safeFormat(g.target.lastSeenAt, "dd.MM.yyyy HH:mm") : "—"}
                </span>{" "}
                <Badge variant={g.confidence === "LOW" ? "muted" : "secondary"}>güven: {CONFIDENCE_LABEL[g.confidence]}</Badge>
              </div>
              <Button size="sm" onClick={() => setGroup(g)}>
                Kopyaları birleştir
              </Button>
            </li>
          ))}
        </ul>
      )}
      <MergeDialog group={group} onClose={() => setGroup(null)} />
    </section>
  );
}
