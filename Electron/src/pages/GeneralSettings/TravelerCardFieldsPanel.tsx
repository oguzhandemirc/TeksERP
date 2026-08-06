import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { TravelerCardConfig } from "@/services/featureFlagService";
import {
  FIELD_GROUPS,
  FIELD_SIZE_MAX,
  FIELD_SIZE_MIN,
  PANEL_WEIGHTS,
  parseSize,
  readRow,
  writeRow,
  type FieldGroup,
  type FieldRow,
  type PanelWeight,
  type RowPatch,
} from "./travelerCardFields";

const SELECT_CLS =
  "h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
const NUM_CLS =
  "h-7 w-full rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
const GRID = "grid grid-cols-[1.5rem_1fr_5rem_6.5rem] items-center gap-x-3";

function Row({
  row,
  cfg,
  disabled,
  onPatch,
}: {
  row: FieldRow;
  cfg: TravelerCardConfig;
  disabled: boolean;
  onPatch: (patch: RowPatch) => void;
}) {
  const v = readRow(cfg, row.source);
  const customized = v.size != null || v.weight != null || !v.visible;
  // Gizli satırda punto/kalınlık anlamsız — girdiler kapatılır (backend de o
  // durumda punto CSS'i basmaz). Değerler SİLİNMEZ: kutu yeniden açıldığında
  // kullanıcının ayarı geri gelir.
  const styleDisabled = disabled || !v.visible;
  return (
    <div className={cn(GRID, "border-b px-3 py-1.5 last:border-b-0", customized && "bg-primary/5")}>
      <Checkbox
        checked={v.visible}
        disabled={disabled}
        aria-label={`${row.label} — bas`}
        onCheckedChange={(x) => onPatch({ visible: x === true })}
      />
      <div className="min-w-0">
        <div className={cn("truncate text-sm", !v.visible && "text-muted-foreground line-through")}>
          {row.label}
        </div>
        {row.hint && <div className="truncate text-[11px] text-muted-foreground">{row.hint}</div>}
      </div>
      <input
        type="number"
        min={FIELD_SIZE_MIN}
        max={FIELD_SIZE_MAX}
        step={0.5}
        // `?? ""` — kontrollü input; undefined verirsek React uncontrolled'a
        // düşer ve alan temizlendiğinde eski değer ekranda kalır.
        value={v.size ?? ""}
        disabled={styleDisabled}
        placeholder="oto"
        title="Punto (px) — boş bırakılırsa varsayılan"
        onChange={(e) => onPatch({ size: parseSize(e.target.value) })}
        className={NUM_CLS}
      />
      <select
        value={v.weight ?? ""}
        disabled={styleDisabled}
        title="Kalınlık — Varsayılan, alanın kendi tasarımını korur"
        onChange={(e) => onPatch({ weight: (e.target.value || null) as PanelWeight | null })}
        className={SELECT_CLS}
      >
        <option value="">Varsayılan</option>
        {PANEL_WEIGHTS.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Group({
  group,
  cfg,
  disabled,
  onChange,
}: {
  group: FieldGroup;
  cfg: TravelerCardConfig;
  disabled: boolean;
  onChange: (next: TravelerCardConfig) => void;
}) {
  // Bölüm anahtarı — eskiden ayrı bir "toggle listesi" bölümündeydi; artık
  // kapattığı satırların BAŞINDA duruyor, yani neyi kapattığı görünür.
  const sectionOn = group.toggle ? cfg[group.toggle] !== false : true;
  return (
    <div className="overflow-hidden rounded-md border">
      <div className={cn(GRID, "border-b bg-muted/40 px-3 py-1.5")}>
        {group.toggle ? (
          <Checkbox
            checked={sectionOn}
            disabled={disabled}
            aria-label={`${group.title} bölümü — bas`}
            onCheckedChange={(x) => onChange({ ...cfg, [group.toggle!]: x === true })}
          />
        ) : (
          <span />
        )}
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {group.title}
            {group.toggle && !sectionOn && " — kapalı"}
          </div>
          {group.desc && (
            <div className="truncate text-[11px] font-normal normal-case text-muted-foreground">
              {group.desc}
            </div>
          )}
        </div>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Punto
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Kalınlık
        </span>
      </div>
      <div className={cn(!sectionOn && "pointer-events-none opacity-40")}>
        {group.rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            cfg={cfg}
            disabled={disabled || !sectionOn}
            onPatch={(patch) => onChange(writeRow(cfg, row.source, patch))}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Kartın TEK ayar tablosu — görünürlük + punto + kalınlık, hepsi aynı satırda.
 *
 * Öncesinde üç ayrı "alan tablosu" (göster + sm/md/lg kademesi), ayrı bir bölüm
 * anahtarı listesi ve ayrı bir punto bölümü vardı; aynı alan iki yerden
 * aranıyordu ve boyut kimi satırda kademe, kimi satırda px'ti. Tek tablo + tek
 * birim (px) kullanıcı kararıdır (2026-08-05).
 */
export function TravelerCardFieldsPanel({
  cfg,
  disabled,
  onChange,
}: {
  cfg: TravelerCardConfig;
  disabled: boolean;
  onChange: (next: TravelerCardConfig) => void;
}) {
  return (
    <div>
      <div className="text-sm font-medium">Kart Alanları</div>
      <p className="text-xs text-muted-foreground">
        Her alan tek tek: <strong>basılsın mı</strong>, <strong>puntosu</strong> (
        {FIELD_SIZE_MIN}–{FIELD_SIZE_MAX} px) ve <strong>kalınlığı</strong>. Boş bırakılan punto
        varsayılanda kalır — varsayılan sayfa boyutuna göre değişir (A4/A5). Yukarıdaki genel
        “Yazı” ölçeği bunların üstüne biner. Bölüm başlığındaki kutu o bölümün tamamını kapatır.
      </p>
      <div className="mt-2 space-y-3">
        {FIELD_GROUPS.map((g) => (
          <Group key={g.key} group={g} cfg={cfg} disabled={disabled} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}
