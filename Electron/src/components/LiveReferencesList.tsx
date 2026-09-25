// =============================================================================
// CANLI KAYIT LİSTESİ — arşiv kapısının engellediği kayıtlar TEK TEK (yıkıcı işlem kuralı)
// =============================================================================
// Kaynak: ürün önizlemesi (`/items/:id/lifecycle-preview`) ya da 409 gövdesi
// (`ITEM_HAS_LIVE_REFERENCES` / `MASTER_DATA_HAS_LIVE_REFERENCES` → `details.references`).
// Toplar duruma göre katlanır; diğer türler kayıt kayıt.
// =============================================================================
import { foldRollsByStatus, type LiveRefGroup, type LiveRefRecord } from "@/lib/item-lifecycle";

function RecordRows({ records }: { records: LiveRefRecord[] }) {
  return (
    <ul className="space-y-0.5 pl-4 text-xs">
      {records.map((r) => (
        <li key={r.id} className="flex gap-2">
          <span className="font-mono">{r.title}</span>
          {r.detail && <span className="text-muted-foreground">{r.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

function GroupBody({ group }: { group: LiveRefGroup }) {
  const more = group.count > group.records.length ? group.count - group.records.length : 0;
  return (
    <>
      {group.kind === "ROLL" ? (
        foldRollsByStatus(group.records).map((f) => (
          <details key={f.status} className="pl-2">
            <summary className="cursor-pointer text-xs">
              {f.label} · {f.records.length}
            </summary>
            <RecordRows records={f.records} />
          </details>
        ))
      ) : (
        <RecordRows records={group.records} />
      )}
      {more > 0 && <p className="pl-4 text-xs text-muted-foreground">… ve {more} kayıt daha</p>}
    </>
  );
}

export function LiveReferencesList({ references }: { references: LiveRefGroup[] }) {
  const live = references.filter((g) => g.count > 0);
  if (live.length === 0) return <p className="text-sm text-muted-foreground">Bağlı canlı kayıt yok.</p>;
  return (
    <div className="max-h-72 space-y-2 overflow-y-auto rounded border p-2" aria-label="Bağlı canlı kayıtlar">
      {live.map((g) => (
        <section key={g.kind}>
          <h4 className="text-sm font-medium">
            {g.label} · {g.count}
          </h4>
          <GroupBody group={g} />
        </section>
      ))}
    </div>
  );
}
