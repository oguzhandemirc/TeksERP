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
const GRID = "grid grid-cols-[1.5rem_minmax(7rem,1fr)_4.5rem_6.5rem_3.5rem] items-center gap-x-3";

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

      {/* Ad KESİLMEZ: "Müşteri stok adı" ile "Müşteri varyant" tek satıra
          sığmayınca ikisi de "Müşteri..." oluyor ve ayırt edilemiyordu. */}
      <div className="min-w-0">
        <div className={cn("text-sm leading-tight", !v.visible && "text-muted-foreground line-through")}>
          {row.label}
        </div>
        {row.hint && <div className="text-[11px] leading-tight text-muted-foreground">{row.hint}</div>}
      </div>

      {v.canLabel ? (
        // KOLON BAŞLIĞI — punto + kalınlık hücrelerinin yerine geçer (kolon
        // satırında ikisi de anlamsız: kolonun puntosu tablo başlığı alanından
        // ayarlanır). Boş bırakmak "varsayılan başlığa dön" demektir; placeholder
        // yerleşik başlığı gösterir ki kullanıcı neye döneceğini bilsin.
        <div className="col-span-2 flex items-center gap-1">
          <input
            type="text"
            maxLength={40}
            value={v.blankLabel ? "" : (v.labelOverride ?? "")}
            disabled={disabled || !v.visible || v.blankLabel}
            placeholder={v.blankLabel ? "(başlıksız)" : row.label}
            title="Kolon başlığı — boş bırakılırsa varsayılan başlık basılır"
            aria-label={`${row.label} — kolon başlığı`}
            onChange={(e) => onPatch({ label: e.target.value })}
            className={cn(NUM_CLS, "flex-1 text-left")}
          />
          {/* BAŞLIK BASMA — kutuyu boşaltmak "varsayılana dön" demek olduğu için
              ayrı bir karar; işaretliyken kutu pasifleşir ki iki niyet ekranda
              da karışmasın. */}
          <input
            type="checkbox"
            checked={v.blankLabel}
            disabled={disabled || !v.visible}
            title="Başlık basma — yalnız hücre değerleri yazılır"
            aria-label={`${row.label} — başlık basma`}
            onChange={(e) => onPatch({ blankLabel: e.target.checked })}
            className="size-4 shrink-0"
          />
        </div>
      ) : v.canStyle ? (
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

      {/* ⚠️ KOLON SATIRINDA BU HÜCRE HİÇ BASILMAZ (2026-09-07). "Kolon başlığı"
          alanı `col-span-2` ile punto+kalınlık hücrelerinin İKİSİNİN yerine
          geçiyor; buraya ayrıca bir `<span>` konunca satır 6 hücreye çıkıyor,
          ızgara 5 kolon olduğu için OKLAR ALT SATIRA düşüyor ve sola
          yaslanıyordu. Ekranda "hizasız oklar" diye görünen şey buydu. */}
      {v.canLabel ? null : v.canStyle ? (
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
        {group.reorderTable ? (
          <span className="col-span-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Kolon başlığı
          </span>
        ) : (
          <>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Punto</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Kalınlık</span>
          </>
        )}
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
        . Grup başlığındaki kutu o bölümün tamamını kapatır. <strong>Kolon</strong>{" "}
        satırlarında punto yerine <strong>kolon başlığı</strong> yazılır — boş bırakılırsa
        belgedeki varsayılan başlık basılır.
      </p>
      <div className="mt-2 space-y-3">
        {groups.map((g) => (
          <Group key={g.key} group={g} cfg={cfg} resolved={resolved} disabled={disabled} patch={patch} />
        ))}
      </div>
    </div>
  );
}
