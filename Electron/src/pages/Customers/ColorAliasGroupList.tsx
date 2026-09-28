// Cari kartı renk adı listesi: her renkte genel ad, altında "yalnız X kumaşında" satırları.
import { COLOR_LOCKED_HINT, ITEM_LOCKED_HINT, colorAcceptsAlias, itemAcceptsAlias, type ColorAliasGroup } from "./colorAliasChain";
import { AliasEditRow, ColorLabel } from "./AliasEditRow";
import type { CustomerItemColorAlias } from "./aliasService";

interface Props {
  groups: ColorAliasGroup[];
  canWrite: boolean;
  onSaveGeneral: (colorId: string, alias: string) => void;
  onDeleteGeneral: (colorId: string) => void;
  onSaveItem: (row: CustomerItemColorAlias, alias: string) => void;
  onDeleteItem: (row: CustomerItemColorAlias) => void;
}

export function ColorAliasGroupList({ groups, canWrite, onSaveGeneral, onDeleteGeneral, onSaveItem, onDeleteItem }: Props) {
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
        Tanımlı müşteriye özel renk adı yok.
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {groups.map((g) => (
        <li key={g.colorId}>
          <ul className="divide-y">
            {g.general ? (
              <AliasEditRow
                label={<ColorLabel color={g.color} />}
                alias={g.general.alias ?? ""}
                onSave={canWrite && colorAcceptsAlias(g.color) ? (a) => onSaveGeneral(g.colorId, a) : undefined}
                onDelete={canWrite ? () => onDeleteGeneral(g.colorId) : undefined}
                lockedHint={canWrite ? COLOR_LOCKED_HINT : undefined}
              />
            ) : (
              <li className="flex items-center gap-2 p-2 text-sm">
                <ColorLabel color={g.color} />
                <span className="ml-auto text-xs text-muted-foreground">Genel ad yok — bizdeki ad basılır</span>
              </li>
            )}
            {g.items.map((r) => {
              const itemOpen = itemAcceptsAlias(r.item?.lifecycleStatus);
              const writable = canWrite && itemOpen && colorAcceptsAlias(r.color);
              return (
                <AliasEditRow
                  key={r.id}
                  nested
                  label={
                    <span className="truncate text-muted-foreground">
                      yalnız <span className="font-medium text-foreground">{r.item?.name ?? "—"}</span> kumaşında
                    </span>
                  }
                  alias={r.alias}
                  onSave={writable ? (a) => onSaveItem(r, a) : undefined}
                  onDelete={canWrite ? () => onDeleteItem(r) : undefined}
                  lockedHint={canWrite ? (itemOpen ? COLOR_LOCKED_HINT : ITEM_LOCKED_HINT) : undefined}
                />
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
