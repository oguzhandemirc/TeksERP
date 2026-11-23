import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoPopover } from "@/components/ui/info-popover";
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
        <div className={cn("truncate text-sm", !v.visible && "text-muted-foreground")}>
          {row.label}{!v.visible && <span className="ml-1.5 text-[11px]">· basılmaz</span>}
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
  // B11: bölüm katlanır — tablo üç ekran boyu açık durmasın; başlık satırı neyin içinde olduğunu söyler.
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className={cn(GRID, "bg-muted/40 px-3 py-1.5", open && "border-b")}>
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
        <button
          type="button"
          className="col-span-3 flex min-w-0 items-center gap-1.5 text-left"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {group.title}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {group.rows.length} alan{group.toggle && !sectionOn ? " · bölüm basılmaz" : ""}
              </span>
            </span>
            {group.desc && <span className="block truncate text-[11px] text-muted-foreground">{group.desc}</span>}
          </span>
        </button>
      </div>
      {open && (
        <div className={cn(GRID, "border-b px-3 py-1 text-[11px] text-muted-foreground")}>
          <span />
          <span>Alan</span>
          <span>Punto</span>
          <span>Kalınlık</span>
        </div>
      )}
      <div className={cn(!open && "hidden", !sectionOn && "pointer-events-none opacity-40")}>
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
      <div className="flex items-center gap-1.5 text-sm font-medium">
        Kart Alanları
        <InfoPopover
          label="Kart alanları"
          desc={`Her alan tek tek: basılsın mı, puntosu (${FIELD_SIZE_MIN}–${FIELD_SIZE_MAX} px) ve kalınlığı. Boş bırakılan punto varsayılanda kalır — varsayılan sayfa boyutuna göre değişir (A4/A5). Yukarıdaki genel "Yazı" ölçeği bunların üstüne biner. Bölüm başlığındaki kutu o bölümün tamamını kapatır; başlığa tıklayınca bölüm açılır.`}
        />
      </div>
      <div className="mt-2 space-y-3">
        {FIELD_GROUPS.map((g) => (
          <Group key={g.key} group={g} cfg={cfg} disabled={disabled} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}
