// Cariler — sıkı liste tablosu: avatar + ad/kod, pastel rol rozetleri, şehir, telefon, vergi no, durum;
// satır tıkı yan paneli açar (seçili satır vurgulu), satır içi hızlı eylemler üzerine gelince görünür.
import { useEffect, useRef } from "react";
import { Maximize2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { toneForKey } from "@/components/ui/icon-tile";
import { RecordAvatar, ToneChip } from "@/components/record/RecordBits";
import { partnerRoleLabels } from "@/lib/partnerRoles";
import { cn } from "@/lib/utils";
import { ROLE_KEYS, ROLE_TONE, roleOn, rowKey, type CariRowItem } from "./cari-row";

interface Props {
  rows: CariRowItem[];
  selectedKey: string | null;
  onSelect: (row: CariRowItem) => void;
  onEdit: (row: CariRowItem) => void;
  onOpenFull: (row: CariRowItem) => void;
  /** Panel açıkken ikincil kolonlar gizlenir (liste daralır, ad kırpılmasın). */
  compact: boolean;
}

const TH = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const dash = <span className="text-muted-foreground">—</span>;

export function CariListTable({ rows, selectedKey, onSelect, onEdit, onOpenFull, compact }: Props) {
  const ref = useRef<HTMLTableElement>(null);
  // Klavyeyle (↑/↓) değişen seçim görünür kalsın.
  useEffect(() => {
    if (selectedKey) ref.current?.querySelector(`[data-row-key="${selectedKey}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedKey]);
  return (
    <table ref={ref} className="w-full text-sm">
      <thead>
        <tr>
          <th className={cn(TH, "pl-4")}>Cari</th>
          <th className={TH}>Rol</th>
          {!compact && <th className={TH}>Şehir</th>}
          {!compact && <th className={TH}>Telefon</th>}
          {!compact && <th className={TH}>Vergi no</th>}
          <th className={TH}>Durum</th>
          <th className={cn(TH, "w-24")}><span className="sr-only">Eylemler</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <CariRow key={rowKey(r)} row={r} selected={selectedKey === rowKey(r)} compact={compact} onSelect={onSelect} onEdit={onEdit} onOpenFull={onOpenFull} />
        ))}
      </tbody>
    </table>
  );
}

function CariRow({ row: r, selected, compact, onSelect, onEdit, onOpenFull }: { row: CariRowItem; selected: boolean } & Omit<Props, "rows" | "selectedKey">) {
  return (
    <tr
      data-record-row=""
      data-row-key={rowKey(r)}
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(r)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onSelect(r);
      }}
      className={cn(
        "group cursor-pointer border-t border-border/60 transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none",
        selected && "bg-primary-soft hover:bg-primary-soft",
        !r.isActive && "text-muted-foreground",
      )}
    >
      <td className="py-1.5 pl-4 pr-3">
        <span className="flex min-w-0 items-center gap-3">
          <RecordAvatar name={r.name} tone={toneForKey(r.id)} size="sm" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-semibold">{r.name}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{r.code}</span>
          </span>
        </span>
      </td>
      <td className="px-3 py-1.5">
        <span className="flex flex-nowrap gap-1 whitespace-nowrap">
          {ROLE_KEYS.filter((k) => roleOn(r.roles, k)).map((k) => (
            <ToneChip key={k} tone={ROLE_TONE[k]}>{partnerRoleLabels[k]}</ToneChip>
          ))}
          {r.kind === "SUBCONTRACTOR" && <ToneChip tone="rose" title="Cari kartına bağlı olmayan eski fason kaydı">Kartsız</ToneChip>}
        </span>
      </td>
      {!compact && <td className="px-3 py-1.5">{r.city ?? dash}</td>}
      {!compact && <td className="px-3 py-1.5 tabular-nums">{r.phone ?? dash}</td>}
      {!compact && <td className="px-3 py-1.5 font-mono text-xs tabular-nums">{r.taxNumber ?? dash}</td>}
      <td className="px-3 py-1.5">{r.isActive ? <ToneChip tone="green">Aktif</ToneChip> : <ToneChip tone="rose">Pasif</ToneChip>}</td>
      <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
        <span className="inline-flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-aria-selected:opacity-100">
          {r.kind === "CUSTOMER" && (
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`${r.name} — tam sayfa aç`} title="Tam sayfa aç" onClick={() => onOpenFull(r)}>
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <PermissionGate permission={r.kind === "CUSTOMER" ? "customer:write" : "subcontractor:write"}>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`${r.name} — düzenle`} title="Düzenle" onClick={() => onEdit(r)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </PermissionGate>
        </span>
      </td>
    </tr>
  );
}
