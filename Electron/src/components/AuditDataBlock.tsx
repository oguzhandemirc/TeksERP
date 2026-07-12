import { fieldLabel, formatAuditValue } from "@/lib/audit-labels";

/**
 * Audit kaydının oldData/newData snapshot'ını okunur Türkçe bir alan-değer
 * tablosu olarak gösterir: alan adları {@link fieldLabel} ile, değerler
 * {@link formatAuditValue} ile (tarih/enum/boolean biçimlenir) çevrilir.
 * Düz nesne değilse (dizi/skaler) ham JSON'a düşer. Aktivite Günlüğü ve Sistem
 * Kayıtları detay çekmecelerinin ortak bloğu — eski ham `JSON.stringify` yerine.
 */
export function AuditDataBlock({ title, data }: { title: string; data: unknown }) {
  if (data == null) return null;
  if (typeof data !== "object" || Array.isArray(data)) {
    return <RawJsonBlock title={title} data={data} />;
  }
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return <RawJsonBlock title={title} data={data} />;

  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="overflow-hidden rounded-md border bg-muted/30 text-[11px]">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="flex gap-3 border-b px-3 py-1.5 last:border-b-0"
          >
            <span className="w-40 shrink-0 text-muted-foreground">
              {fieldLabel(key)}
            </span>
            <AuditValue value={value} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditValue({ value }: { value: unknown }) {
  // İç içe nesne/dizi → kompakt JSON (alan adı yine Türkçe üstte).
  if (value !== null && typeof value === "object") {
    return (
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words font-mono">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return (
    <span className="min-w-0 flex-1 break-words font-mono">
      {formatAuditValue(value)}
    </span>
  );
}

function RawJsonBlock({ title, data }: { title: string; data: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
