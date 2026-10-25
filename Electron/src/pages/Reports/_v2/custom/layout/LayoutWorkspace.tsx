import type { ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import type { UseQueryResult } from "@tanstack/react-query";
import type { CatalogCube } from "../custom-api";
import { DataTree } from "../data/DataTree";
import { FilterBuilder } from "../data/FilterBuilder";
import { Wells } from "../data/Wells";
import { useDataPanel } from "../data/useDataPanel";
import { BlockProperties } from "./BlockProperties";
import { removeBlock, resizeBlock, setPageBreak, updateBlock, type DefinitionBlock, type DefinitionBody, type LayoutItem } from "./layout-model";

type Apply = (fn: (b: DefinitionBody) => DefinitionBody | null) => boolean;

interface Props {
  draft: DefinitionBody;
  current: { block: DefinitionBlock; item: LayoutItem } | null;
  catalog: UseQueryResult<CatalogCube[]>;
  editable: boolean;
  fallbackCube: string | null;
  apply: Apply;
  onDeselect: () => void;
  /** Blok paleti (sol sütunda ağacın altında). */
  palette: ReactNode;
  /** Düzen tuvali (orta sütun). */
  canvas: ReactNode;
}

/**
 * Düzen çalışma alanı: VERİ (ağaç + palet) · DÜZEN (tuval) · ÖZELLİKLER (kuyular + bölüm ayarları).
 * Ağaçtan kuyulara sürükleme dış `DndContext`te; tuvalin kendi sıralama bağlamı içte ayrı kalır.
 */
export function LayoutWorkspace({ draft, current, catalog, editable, fallbackCube, apply, onDeselect, palette, canvas }: Props) {
  const panel = useDataPanel({ draft, catalog: catalog.data, selected: current?.block ?? null, editable, apply });
  const q = current?.block.sorgu;
  return (
    <DndContext sensors={panel.sensors} onDragEnd={panel.onDragEnd}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,20rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          <DataTree cubes={catalog.data} loading={catalog.isLoading} failed={catalog.isError} activeCube={q?.kup ?? fallbackCube} targetsFor={panel.targetsFor} onAdd={panel.onAdd} />
          {palette}
        </div>
        <div className="min-w-0">{canvas}</div>
        <aside className="flex min-w-0 flex-col gap-4 rounded-lg border p-3">
          {current ? (
            <>
              <Wells
                block={current.block}
                cube={panel.cube}
                issues={panel.issues}
                warning={panel.warning}
                check={panel.verdict}
                onRemove={panel.remove}
                onRemoveFilter={panel.removeFilter}
                onOpenFilter={panel.openFilter}
                onChart={panel.setChart}
              />
              <BlockProperties
                key={current.block.id}
                block={current.block}
                item={current.item}
                canRemove={draft.bloklar.length > 1}
                onChange={(patch) => apply((b) => updateBlock(b, current.block.id, patch))}
                onWidth={(w) => apply((b) => resizeBlock(b, current.block.id, w))}
                onPageBreak={(on) => apply((b) => setPageBreak(b, current.block.id, on))}
                onRemove={() => apply((b) => removeBlock(b, current.block.id)) && onDeselect()}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Ayarlarını ve verisini görmek için bir bölümün başlığına tıklayın.</p>
          )}
        </aside>
      </div>
      {panel.cube && q ? (
        <FilterBuilder
          open={panel.filterFor !== null}
          cube={panel.cube}
          measure={q.olculer[0]}
          dimensions={panel.filterDims}
          initial={q.suzgec}
          seedField={panel.filterFor?.seed ?? null}
          onApply={panel.setFilter}
          onClose={panel.closeFilter}
        />
      ) : null}
    </DndContext>
  );
}
