import {
  DOC_FIELD_GROUP_LABELS,
  DOC_FIELD_SIZE_MAX,
  DOC_FIELD_SIZE_MIN,
  DOC_FIELD_WEIGHT_LABELS,
  type DocDef,
  type DocFieldDef,
  type DocFieldGroup,
  type DocFieldStyle,
  type DocFieldWeight,
  type DocumentConfig,
} from "@/services/documentConfig";
import { Button } from "@/components/ui/button";

// =============================================================================
// Alan bazlı yazı ayarları — DocumentConfigSection'ın alt paneli.
// =============================================================================
// "Görünüm" panelindeki Yazı ölçeği/kalınlığı TÜM belgeye uygulanır; bu panel
// TEK BİR ALANI ayarlar (saha isteği: "metre ve cm verilerinin büyüklüğü
// kalınlığı ayrıca belirlenemiyor"). İkisi çakışmaz: buradaki punto TABANDIR,
// genel ölçek onun ÜSTÜNE biner (backend `scaleDocCss`).
//
// Boş punto = alanın kendi varsayılanı (sayfa boyutuna göre değişir, bu yüzden
// placeholder'a sabit bir sayı YAZILMAZ — A4 ve A5 tabanları farklıdır ve burada
// bir sayı göstermek yanlış bir kesinlik vaat ederdi).
//
// Yalnız `DocDef.fields` taşıyan belgelerde çizilir (bugün: fason sevk çeki).
// =============================================================================

export function DocumentFieldStyleControls({
  def,
  cfg,
  disabled,
  patch,
}: {
  def: DocDef;
  cfg: DocumentConfig | undefined;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  if (!def.fields?.length) return null;

  const fields = cfg?.fields ?? {};
  const touched = Object.keys(fields).length;

  const patchField = (key: string, next: DocFieldStyle | null) => {
    const all = { ...fields };
    // Boşalan alanı SİL — `{}` bırakmak kayıt kapısından zaten elenir ve taslak
    // ile kaydedilen arasında görünmez bir fark bırakırdı.
    if (!next || (next.size == null && next.weight == null)) delete all[key];
    else all[key] = next;
    patch({ fields: all });
  };

  const groups = def.fields.reduce<Record<string, DocFieldDef[]>>((acc, f) => {
    (acc[f.group] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between pb-1">
        <span className="text-sm font-medium">Alan Ayarları</span>
        {touched > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={() => patch({ fields: {} })}
          >
            Tümünü sıfırla ({touched})
          </Button>
        )}
      </div>
      <p className="pb-2 text-xs text-muted-foreground">
        Her alanın puntosu ve kalınlığı ayrı ayrı. Boş bırakılan alan varsayılanını
        kullanır; üstteki genel “Yazı ölçeği” buradaki değerlerin de üstüne biner.
      </p>

      <div className="space-y-3">
        {(Object.keys(DOC_FIELD_GROUP_LABELS) as DocFieldGroup[])
          .map((g) => ({ g, rows: groups[g] ?? [] }))
          .filter(({ rows }) => rows.length)
          .map(({ g, rows }) => (
            <div key={g}>
              <div className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {DOC_FIELD_GROUP_LABELS[g]}
              </div>
              <div className="divide-y rounded-md border">
                {rows.map((f) => (
                  <FieldRow
                    key={f.key}
                    field={f}
                    value={fields[f.key]}
                    disabled={disabled}
                    onChange={(next) => patchField(f.key, next)}
                  />
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  value,
  disabled,
  onChange,
}: {
  field: DocFieldDef;
  value: DocFieldStyle | undefined;
  disabled: boolean;
  onChange: (next: DocFieldStyle | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs" title={field.label}>
        {field.label}
      </span>
      <input
        type="number"
        min={DOC_FIELD_SIZE_MIN}
        max={DOC_FIELD_SIZE_MAX}
        step={0.5}
        value={value?.size ?? ""}
        placeholder="punto"
        disabled={disabled}
        aria-label={`${field.label} punto`}
        onChange={(e) => {
          const raw = e.target.value;
          const size =
            raw === ""
              ? undefined
              : Math.min(DOC_FIELD_SIZE_MAX, Math.max(DOC_FIELD_SIZE_MIN, Number(raw)));
          onChange({ ...value, size });
        }}
        className="h-8 w-20 shrink-0 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <select
        value={value?.weight ?? ""}
        disabled={disabled}
        aria-label={`${field.label} kalınlık`}
        onChange={(e) => {
          const w = e.target.value;
          onChange({ ...value, weight: w ? (w as DocFieldWeight) : undefined });
        }}
        className="h-8 w-28 shrink-0 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">varsayılan</option>
        {DOC_FIELD_WEIGHT_LABELS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
