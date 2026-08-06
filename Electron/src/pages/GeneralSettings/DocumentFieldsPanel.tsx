import { ArrowDown, ArrowUp } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DOC_FIELD_SIZE_MAX,
  DOC_FIELD_SIZE_MIN,
  DOC_FIELD_WEIGHT_LABELS,
  type DocDef,
  type DocFieldWeight,
  type DocumentConfig,
  type ResolvedDocConfig,
} from "@/services/documentConfig";
import {
  buildDocRowGroups,
  moveColumn,
  orderedColumnRows,
  parseDocSize,
  readDocRow,
  writeDocRow,
  writeGroupToggle,
  type DocRow,
  type DocRowGroup,
  type DocRowPatch,
} from "./docRows";

const SELECT_CLS =
  "h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
const NUM_CLS =
  "h-7 w-full rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
const GRID = "grid grid-cols-[1.5rem_1fr_4.5rem_6.5rem_3.5rem] items-center gap-x-3";

function Row({
  row,
  cfg,
  resolved,
  disabled,
  reorder,
  onPatch,
}: {
  row: DocRow;
  cfg: DocumentConfig | undefined;
  resolved: ResolvedDocConfig;
  disabled: boolean;
  /** Kolon satırlarında yukarı/aşağı; yoksa hücre boş kalır. */
  reorder?: { up: boolean; down: boolean; move: (dir: -1 | 1) => void };
  onPatch: (patch: DocRowPatch) => void;
}) {
  const v = readDocRow(cfg, resolved, row);
  const customized = v.size != null || v.weight != null || !v.visible;
  // Gizli satırda punto/kalınlık anlamsız — girdiler kapanır ama DEĞER SİLİNMEZ:
  // kutu yeniden açıldığında kullanıcının ayarı geri gelir.
  const styleDisabled = disabled || !v.canStyle || !v.visible;
  return (
    <div className={cn(GRID, "border-b px-3 py-1.5 last:border-b-0", customized && "bg-primary/5")}>
      {v.canHide ? (
        <Checkbox
          checked={v.visible}
          disabled={disabled}
          aria-label={`${row.label} — bas`}
          onCheckedChange={(x) => onPatch({ visible: x === true })}
        />
      ) : (
        // Kutu YOK, sönük kilitli kutu da yok: kapatılamayan şey için kutu
        // göstermek "neden tıklayamıyorum" sorusu doğurur.
        <span aria-hidden="true" />
      )}

      <div className="min-w-0">
        <div className={cn("truncate text-sm", !v.visible && "text-muted-foreground line-through")}>
          {row.label}
        </div>
        {row.hint && <div className="truncate text-[11px] text-muted-foreground">{row.hint}</div>}
      </div>

      {v.canStyle ? (
        <input
          type="number"
          min={DOC_FIELD_SIZE_MIN}
          max={DOC_FIELD_SIZE_MAX}
          step={0.5}
          // `?? ""` — kontrollü input; undefined verirsek React uncontrolled'a
          // düşer ve alan temizlendiğinde eski değer ekranda kalır.
          value={v.size ?? ""}
          disabled={styleDisabled}
          placeholder="oto"
          title="Punto (px) — boş bırakılırsa varsayılan"
          onChange={(e) =>
            onPatch({ size: parseDocSize(e.target.value, DOC_FIELD_SIZE_MIN, DOC_FIELD_SIZE_MAX) })
          }
          className={NUM_CLS}
        />
      ) : (
        <span aria-hidden="true" />
      )}

      {v.canStyle ? (
        <select
          value={v.weight ?? ""}
          disabled={styleDisabled}
          title="Kalınlık — Varsayılan, alanın kendi tasarımını korur"
          onChange={(e) => onPatch({ weight: (e.target.value || null) as DocFieldWeight | null })}
          className={SELECT_CLS}
        >
          <option value="">Varsayılan</option>
          {DOC_FIELD_WEIGHT_LABELS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <span aria-hidden="true" />
      )}

      {reorder ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0"
            aria-label={`${row.label} yukarı taşı`}
            disabled={disabled || !reorder.up} onClick={() => reorder.move(-1)}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0"
            aria-label={`${row.label} aşağı taşı`}
            disabled={disabled || !reorder.down} onClick={() => reorder.move(1)}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}

function Group({
  group,
  cfg,
  resolved,
  disabled,
  patch,
}: {
  group: DocRowGroup;
  cfg: DocumentConfig | undefined;
  resolved: ResolvedDocConfig;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  const sectionOn = group.toggleSection ? resolved.sections[group.toggleSection] !== false : true;
  const rows = orderedColumnRows(cfg, group);
  return (
    <div className="overflow-hidden rounded-md border">
      <div className={cn(GRID, "border-b bg-muted/40 px-3 py-1.5")}>
        {group.toggleSection ? (
          <Checkbox
            checked={sectionOn}
            disabled={disabled}
            aria-label={`${group.title} — bas`}
            onCheckedChange={(x) => patch(writeGroupToggle(resolved, group.toggleSection!, x === true))}
          />
        ) : (
          <span aria-hidden="true" />
        )}
        <div className="min-w-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {group.title}
          {group.toggleSection && !sectionOn && " — kapalı"}
        </div>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Punto</span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Kalınlık</span>
        <span aria-hidden="true" />
      </div>
      <div className={cn(!sectionOn && "pointer-events-none opacity-40")}>
        {rows.map((row, i) => (
          <Row
            key={row.id}
            row={row}
            cfg={cfg}
            resolved={resolved}
            disabled={disabled || !sectionOn}
            reorder={
              group.reorderTable
                ? {
                    up: i > 0,
                    down: i < rows.length - 1,
                    move: (dir) => {
                      const next = moveColumn(cfg, group, i, dir);
                      if (next) patch(next);
                    },
                  }
                : undefined
            }
            onPatch={(p) => patch(writeDocRow(cfg, resolved, row, p))}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Belgenin TEK ayar tablosu — görünürlük + punto + kalınlık aynı satırda.
 *
 * Öncesinde üç ayrı panel vardı (bölüm aç/kapa listesi · alan punto listesi ·
 * kolon listesi) ve aynı şey iki farklı adla iki yerde aranıyordu; örneğin araç
 * satırını gizlemek "Araç / sürücü satırı"ndan, puntosunu değiştirmek "Araç /
 * referans satırı"ndan yapılıyordu. Birleştirme kullanıcı kararıdır (2026-08-06)
 * ve **bölüm adı korunur**.
 *
 * Sunum katmanıdır: saklanan veri değişmedi (görünürlük `sections`/`columns`,
 * stil `fields`) — renderer ve backend bekçileri etkilenmez.
 */
export function DocumentFieldsPanel({
  def,
  cfg,
  resolved,
  disabled,
  patch,
}: {
  def: DocDef;
  cfg: DocumentConfig | undefined;
  resolved: ResolvedDocConfig;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  const groups = buildDocRowGroups(def);
  if (!groups.length) return null;
  const styleable = groups.some((g) => g.rows.some((r) => r.field));
  return (
    <div>
      <div className="text-sm font-medium">Belge Alanları</div>
      <p className="text-xs text-muted-foreground">
        Her alan tek tek: <strong>basılsın mı</strong>
        {styleable && (
          <>
            , <strong>puntosu</strong> ({DOC_FIELD_SIZE_MIN}–{DOC_FIELD_SIZE_MAX} px) ve{" "}
            <strong>kalınlığı</strong>. Boş bırakılan punto varsayılanda kalır — varsayılan sayfa
            boyutuna göre değişir. Üstteki genel “Yazı ölçeği” bunların üstüne biner
          </>
        )}
        . Grup başlığındaki kutu o bölümün tamamını kapatır.
      </p>
      <div className="mt-2 space-y-3">
        {groups.map((g) => (
          <Group key={g.key} group={g} cfg={cfg} resolved={resolved} disabled={disabled} patch={patch} />
        ))}
      </div>
    </div>
  );
}
