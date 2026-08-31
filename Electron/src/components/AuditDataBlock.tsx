import { fieldLabel, formatAuditValue } from "@/lib/audit-labels";

/**
 * Audit kaydının oldData/newData snapshot'ını okunur Türkçe bir alan-değer
 * tablosu olarak gösterir: alan adları {@link fieldLabel} ile, değerler
 * {@link formatAuditValue} ile (tarih/enum/boolean biçimlenir) çevrilir.
 * Düz nesne değilse (dizi/skaler) ham JSON'a düşer. Aktivite Günlüğü ve Sistem
 * Kayıtları detay çekmecelerinin ortak bloğu — eski ham `JSON.stringify` yerine.
 */
export function AuditDataBlock({
  title,
  data,
  tableName,
}: {
  title: string;
  data: unknown;
  /**
   * Kaydın tablosu (`SystemLog.tableName`). Bazı enum DEĞERLERİ iki farklı
   * enum'da ÇELİŞİR (`PURCHASE`: fatura türü ↔ fiyat türü · `ISSUED`: çekin
   * türü ↔ durumu) ve bunları yalnız `TABLO.alan` bağlamı ayırabilir. Prop
   * verilmezse global sözlük kullanılır — davranış bugünküyle aynı.
   */
  tableName?: string | null;
}) {
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
            <AuditValue value={value} tableName={tableName} field={key} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditValue({
  value,
  tableName,
  field,
}: {
  value: unknown;
  tableName?: string | null;
  field: string;
}) {
  // İç içe nesne/dizi → kompakt JSON (alan adı yine Türkçe üstte).
  if (value !== null && typeof value === "object") {
    return (
      <div className="min-w-0 flex-1">
        <NestedValue value={value} depth={0} />
      </div>
    );
  }
  return (
    <span className="min-w-0 flex-1 break-words font-mono">
      {formatAuditValue(value, { tableName, field })}
    </span>
  );
}

// İç içe değerlerde de alan adları ÇEVRİLİR. Eskiden burası `JSON.stringify`
// idi ve blok Türkçe başlıklı olsa da içi ham İngilizce kalıyordu (ölçüm
// 2026-08-25: 10.172 kaydın 2.676'sında en az bir iç içe nesne/dizi var).
//
// ⚠️ DERİNLİK SINIRI load-bearing: audit yükünde tek bir alan (`snapshot`,
// `config`) koca bir belgeyi taşıyabilir. Belirli bir derinlikten sonra ham
// JSON'a düşülür — çeviri denemesi orada okunurluk kazandırmaz, satır sayısını
// patlatır. Ham JSON hâlâ adli inceleme için doğru cevaptır.
const MAX_DEPTH = 2;
/** Uzun dizilerde ilk N eleman gösterilir; gerisi "+N" olarak özetlenir. */
const MAX_ITEMS = 12;

function NestedValue({ value, depth }: { value: unknown; depth: number }) {
  if (value === null || value === undefined) {
    return <span className="font-mono">—</span>;
  }
  if (typeof value !== "object") {
    return <span className="break-words font-mono">{formatAuditValue(value)}</span>;
  }
  if (depth >= MAX_DEPTH) return <InlineJson data={value} />;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="font-mono text-muted-foreground">(boş)</span>;
    // Skaler dizi (id listesi, kod listesi) tek satırda okunur — her elemanı
    // ayrı satıra açmak 200 toplu bir işlemde çekmeceyi kullanılmaz yapar.
    if (value.every((v) => v === null || typeof v !== "object")) {
      const shown = value.slice(0, MAX_ITEMS).map((v) => formatAuditValue(v)).join(", ");
      const rest = value.length - MAX_ITEMS;
      return (
        <span className="break-words font-mono" title={`${value.length} kayıt`}>
          {shown}
          {rest > 0 ? ` … +${rest}` : ""}
        </span>
      );
    }
    return (
      <div className="space-y-1">
        {value.slice(0, MAX_ITEMS).map((item, i) => (
          <div key={i} className="border-l pl-2">
            <div className="text-[10px] text-muted-foreground">{i + 1}.</div>
            <NestedValue value={item} depth={depth + 1} />
          </div>
        ))}
        {value.length > MAX_ITEMS && (
          <div className="text-[10px] text-muted-foreground">… +{value.length - MAX_ITEMS} kayıt daha</div>
        )}
      </div>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="font-mono text-muted-foreground">(boş)</span>;
  return (
    <div className="space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="shrink-0 text-muted-foreground">{fieldLabel(k)}</span>
          <NestedValue value={v} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

function InlineJson({ data }: { data: unknown }) {
  return (
    <pre className="min-w-0 overflow-x-auto whitespace-pre-wrap break-words font-mono">
      {JSON.stringify(data)}
    </pre>
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
