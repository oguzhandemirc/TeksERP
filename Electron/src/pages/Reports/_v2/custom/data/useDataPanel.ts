import { useEffect, useRef, useState } from "react";
import { KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { customReportApi, type CatalogCube } from "../custom-api";
import { allowedDimensions } from "../builder-model";
import { updateBlock, type DefinitionBlock, type DefinitionBody } from "../layout/layout-model";
import { contentKeyOf } from "../layout/useLayoutEditor";
import { fromQueryFilter, type FilterGroup } from "./filter-model";
import type { AddTarget } from "./DataTree";
import { applyDrop, checkDrop, issuesForBlock, patchFor, removeFromWell, wellsFor, type DataField, type WellKind } from "./wells-model";

/** Gövde değişince 500 ms sonra sunucu doğrulaması (kesin hüküm); hata yolu kuyu/çipe bağlanır. */
export const VALIDATE_DELAY_MS = 500;

export function useDefinitionCheck(draft: DefinitionBody | null) {
  const key = contentKeyOf(draft);
  const latest = useRef(draft);
  latest.current = draft;
  const [settled, setSettled] = useState<{ key: string; body: DefinitionBody | null }>({ key: "", body: null });
  useEffect(() => {
    const t = setTimeout(() => setSettled({ key, body: latest.current }), VALIDATE_DELAY_MS);
    return () => clearTimeout(t);
  }, [key]);
  return useQuery({
    queryKey: ["custom-report-validate", settled.key],
    queryFn: () => customReportApi.validate(settled.body),
    enabled: settled.body !== null,
    retry: false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

interface Args {
  draft: DefinitionBody | null;
  catalog: CatalogCube[] | undefined;
  selected: DefinitionBlock | null;
  editable: boolean;
  apply: (fn: (b: DefinitionBody) => DefinitionBody | null) => boolean;
}

/** Veri paneli ↔ taslak: bırakma kuralı, ekle (tık/klavye), kuyudan çıkar, süzgeç kurucu, doğrulama. */
export function useDataPanel({ draft, catalog, selected, editable, apply }: Args) {
  const [warning, setWarning] = useState<string | null>(null);
  const [filterFor, setFilterFor] = useState<{ seed: string | null } | null>(null);
  const check = useDefinitionCheck(draft);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const cube = catalog?.find((c) => c.kimlik === selected?.sorgu?.kup);
  useEffect(() => setWarning(null), [selected?.id]);

  const patch = (p: Partial<DefinitionBlock>) => selected && apply((b) => updateBlock(b, selected.id, p));
  const verdict = (field: DataField, well: WellKind) => (selected ? checkDrop(selected, cube, well, field) : ({ ok: false, message: "Önce düzende bir bölüm seçin." } as const));

  const drop = (field: DataField, well: WellKind) => {
    if (!selected || !editable) return;
    const v = verdict(field, well);
    if (!v.ok) {
      setWarning(v.message);
      return;
    }
    setWarning(null);
    if (well === "suzgec") setFilterFor({ seed: field.kind === "dimension" ? field.dimension.kimlik : null });
    else patch(patchFor(selected, applyDrop(selected, well, field.kind === "measure" ? field.measure.kimlik : field.dimension.kimlik), cube));
  };

  const targetsFor = (field: DataField): AddTarget[] => (selected && editable ? wellsFor(selected).map((well) => ({ well, verdict: verdict(field, well) })) : []);

  const onDragEnd = (e: DragEndEvent) => {
    const field = e.active.data.current?.field as DataField | undefined;
    const well = e.over?.data.current?.well as WellKind | undefined;
    if (field && well) drop(field, well);
  };

  const remove = (well: Exclude<WellKind, "suzgec">, id: string) => {
    if (!selected || !editable) return;
    const next = removeFromWell(selected, well, id);
    if (next) patch(patchFor(selected, next, cube));
  };

  const setFilter = (f: FilterGroup | undefined) => {
    if (!selected?.sorgu || !editable) return;
    const next = { ...selected.sorgu, suzgec: f };
    if (!f) delete next.suzgec;
    patch({ sorgu: next });
  };

  const removeFilter = (index: number) => {
    const g = fromQueryFilter(selected?.sorgu?.suzgec);
    const rules = g.rules.filter((_, i) => i !== index);
    setFilter(rules.length ? { ...g, rules } : undefined);
  };

  const blockIndex = draft && selected ? draft.bloklar.findIndex((b) => b.id === selected.id) : -1;
  const issues = selected && blockIndex >= 0 ? issuesForBlock(check.data?.hatalar ?? [], blockIndex, selected) : [];
  const filterDims = selected?.sorgu ? allowedDimensions(cube, selected.sorgu.olculer).filter((d) => d.tur === "kategori" && d.islecler.length > 0) : [];

  return {
    sensors,
    cube,
    warning,
    issues,
    validation: check,
    verdict,
    targetsFor,
    onAdd: drop,
    onDragEnd,
    remove,
    removeFilter,
    setFilter,
    setChart: (kind: string) => patch({ gorsel: kind }),
    filterDims,
    filterFor,
    openFilter: () => editable && setFilterFor({ seed: null }),
    closeFilter: () => setFilterFor(null),
  };
}
