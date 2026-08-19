import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  csvIds,
  normalizeSearch,
  rollMatchesFacets,
  rollMatchesQuery,
  type RollSortField,
} from "../roll-search";
import type { ShipmentDetail, ShipmentDetailRoll, ShipmentDetailSack } from "../types";
import { trCompare } from "@/lib/collate";

export interface RollSort {
  field: RollSortField;
  dir: "asc" | "desc";
}

export type FacetKind = "item" | "color" | "quality" | "width";
export interface FacetOption {
  id: string;
  name: string;
}
export interface ActiveChip {
  kind: FacetKind;
  value: string;
  label: string;
}
export interface FilteredSack {
  sack: ShipmentDetailSack;
  rolls: ShipmentDetailRoll[];
}

const toggleIn = (list: string[], v: string) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
const byName = (a: FacetOption, b: FacetOption) => trCompare(a.name, b.name);

/**
 * Sevkiyat tam-sayfa detayının istemci-içi (load-all) süzgeç + facet + aç/kapa durumu.
 *
 * - Arama (barkod/kumaş/renk/çuval no) + üç bağımsız facet (kumaş/renk/kalite), hepsi
 *   ANINDA (backend'e gitmez; getShipmentById tüm topları döndürür).
 * - Facet seçenekleri YALNIZ bu sevkiyatta var olan değerlerden türetilir (ada göre sıralı).
 * - URL'deki matchItem/matchColor (liste kumaş/renk filtresinden gelen csv id) kumaş/renk
 *   facet'ine BAŞLANGIÇ değeri olarak yüklenir → çip olarak görünür, kaldırılabilir.
 * - Not: liste "tek top = hem kumaş hem renk" bağlamı burada İKİ AYRI facet'e düşer;
 *   kullanıcı serbestçe düzenler (detay-içi arama esnek olmalı — kullanıcı kararı).
 * - Aç/kapa: süzgeç aktifken eşleşen çuvallar varsayılan AÇIK, süzgeç yokken KAPALI;
 *   kullanıcının tek tek açıp/kapaması (override) ve "Tümünü Aç/Kapat" (bulk) bunu ezer;
 *   süzgeç imzası değişince override/bulk sıfırlanır → yeni süzgeç taze varsayılanla gelir.
 */
export function useShipmentDetailFilter(d: ShipmentDetail) {
  const [searchParams] = useSearchParams();
  const [rawQ, setQ] = useState("");
  const [itemFacet, setItemFacet] = useState<string[]>(() => csvIds(searchParams.get("matchItem")));
  const [colorFacet, setColorFacet] = useState<string[]>(() => csvIds(searchParams.get("matchColor")));
  const [qualityFacet, setQualityFacet] = useState<string[]>([]);
  const [widthFacet, setWidthFacet] = useState<string[]>([]);

  const q = normalizeSearch(rawQ);
  const isFiltering =
    q.length > 0 ||
    itemFacet.length > 0 ||
    colorFacet.length > 0 ||
    qualityFacet.length > 0 ||
    widthFacet.length > 0;

  // Facet seçenekleri: bu sevkiyatın topları içinde VAR OLAN benzersiz kumaş/renk/kalite/en.
  const { itemOptions, colorOptions, qualityOptions, widthOptions } = useMemo(() => {
    const items = new Map<string, string>();
    const colors = new Map<string, string>();
    const qualities = new Set<string>();
    const widths = new Set<number>();
    for (const sack of d.sacks) {
      for (const r of sack.rolls) {
        if (r.item) items.set(r.item.id, r.item.name);
        if (r.color) colors.set(r.color.id, r.color.name);
        if (r.qualityGrade) qualities.add(r.qualityGrade);
        if (r.width != null) widths.add(r.width);
      }
    }
    return {
      itemOptions: [...items].map(([id, name]) => ({ id, name })).sort(byName),
      colorOptions: [...colors].map(([id, name]) => ({ id, name })).sort(byName),
      qualityOptions: [...qualities].sort(trCompare),
      // En: sayısal artan sırala; value=String(en) (facet eşleştirmesiyle birebir).
      widthOptions: [...widths].sort((a, b) => a - b).map((w) => ({ id: String(w), name: `${w} cm` })),
    };
  }, [d.sacks]);

  // Aktif facet → çip (id'yi bu sevkiyatın adına çöz; bulunamazsa ham id — kaldırılabilir kalsın).
  const itemName = useMemo(() => new Map(itemOptions.map((o) => [o.id, o.name])), [itemOptions]);
  const colorName = useMemo(() => new Map(colorOptions.map((o) => [o.id, o.name])), [colorOptions]);
  const activeChips = useMemo<ActiveChip[]>(
    () => [
      ...itemFacet.map((v) => ({ kind: "item" as const, value: v, label: itemName.get(v) ?? v })),
      ...colorFacet.map((v) => ({ kind: "color" as const, value: v, label: colorName.get(v) ?? v })),
      ...qualityFacet.map((v) => ({ kind: "quality" as const, value: v, label: v })),
      ...widthFacet.map((v) => ({ kind: "width" as const, value: v, label: `${v} cm` })),
    ],
    [itemFacet, colorFacet, qualityFacet, widthFacet, itemName, colorName],
  );

  // Süzülmüş çuvallar: her çuvalın topları arama + facet'ten geçer; süzgeç aktifken 0 toplu gizli.
  const filteredSacks = useMemo<FilteredSack[]>(() => {
    const result: FilteredSack[] = [];
    for (const sack of d.sacks) {
      const rolls = isFiltering
        ? sack.rolls.filter(
            (r) =>
              rollMatchesQuery(r, q, String(sack.sackNo)) &&
              rollMatchesFacets(r, itemFacet, colorFacet, qualityFacet, widthFacet),
          )
        : sack.rolls;
      if (isFiltering && rolls.length === 0) continue;
      result.push({ sack, rolls });
    }
    return result;
  }, [d.sacks, q, itemFacet, colorFacet, qualityFacet, widthFacet, isFiltering]);

  const matchCount = useMemo(
    () => filteredSacks.reduce((n, x) => n + x.rolls.length, 0),
    [filteredSacks],
  );

  // Aç/kapa: override (tek satır) > bulk (Tümünü Aç/Kapat) > varsayılan (isFiltering).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState<"open" | "closed" | null>(null);
  // JSON.stringify → ayraç çakışması yok (arama '|' içerse bile benzersiz imza).
  const filterKey = JSON.stringify([q, itemFacet, colorFacet, qualityFacet, widthFacet]);
  useEffect(() => {
    setOverrides({});
    setBulk(null);
  }, [filterKey]);

  const baseOpen = bulk ? bulk === "open" : isFiltering;
  // Sanal liste yeniden-ölçüm sinyali: yalnız EKRAN-DIŞI satırların açıklığını
  // değiştiren olaylar (bulk "Tümünü Aç/Kapat" + süzgeç değişimi → varsayılan açıklık).
  // Tek satır aç/kapa hep ekranda olur → ResizeObserver kendi yakalar, buraya girmez
  // (yoksa her tıkta measure() tüm görünür satırları gereksiz yeniden ölçer/titrer).
  const openSignature = `${bulk ?? ""}#${filterKey}`;
  // override (false=elle kapalı da geçerli) ?? bulk/varsayılan. `?? baseOpen` sadece
  // undefined'da (override yok) devreye girer; kullanıcının kapattığı `false` korunur.
  const isOpen = useCallback((id: string) => overrides[id] ?? baseOpen, [overrides, baseOpen]);
  const toggleOpen = useCallback(
    (id: string) => setOverrides((prev) => ({ ...prev, [id]: !(prev[id] ?? baseOpen) })),
    [baseOpen],
  );
  const expandAll = useCallback(() => {
    setOverrides({});
    setBulk("open");
  }, []);
  const collapseAll = useCallback(() => {
    setOverrides({});
    setBulk("closed");
  }, []);

  // Çuval-içi top sıralaması — hook'ta (çuval id'sine göre) tutulur ki sanallaştırma
  // satırı DOM'dan çıkarıp geri getirdiğinde (unmount/remount) sıralama KAYBOLMASIN.
  const [sortById, setSortById] = useState<Record<string, RollSort>>({});
  const sortOf = useCallback((id: string): RollSort | null => sortById[id] ?? null, [sortById]);
  const toggleSort = useCallback((id: string, field: RollSortField) => {
    setSortById((prev) => {
      const cur = prev[id];
      const dir = cur?.field === field && cur.dir === "asc" ? "desc" : "asc";
      return { ...prev, [id]: { field, dir } };
    });
  }, []);

  const removeChip = useCallback((kind: FacetKind, value: string) => {
    const drop = (prev: string[]) => prev.filter((x) => x !== value);
    if (kind === "item") setItemFacet(drop);
    else if (kind === "color") setColorFacet(drop);
    else if (kind === "quality") setQualityFacet(drop);
    else setWidthFacet(drop);
  }, []);
  const clearAll = useCallback(() => {
    setQ("");
    setItemFacet([]);
    setColorFacet([]);
    setQualityFacet([]);
    setWidthFacet([]);
  }, []);

  return {
    q: rawQ,
    setQ,
    itemFacet,
    colorFacet,
    qualityFacet,
    widthFacet,
    toggleItem: useCallback((id: string) => setItemFacet((p) => toggleIn(p, id)), []),
    toggleColor: useCallback((id: string) => setColorFacet((p) => toggleIn(p, id)), []),
    toggleQuality: useCallback((g: string) => setQualityFacet((p) => toggleIn(p, g)), []),
    toggleWidth: useCallback((w: string) => setWidthFacet((p) => toggleIn(p, w)), []),
    clearItem: useCallback(() => setItemFacet([]), []),
    clearColor: useCallback(() => setColorFacet([]), []),
    clearQuality: useCallback(() => setQualityFacet([]), []),
    clearWidth: useCallback(() => setWidthFacet([]), []),
    removeChip,
    clearAll,
    itemOptions,
    colorOptions,
    qualityOptions,
    widthOptions,
    activeChips,
    filteredSacks,
    isFiltering,
    matchCount,
    totalRolls: d.summary.rollCount,
    totalSacks: d.sacks.length,
    isOpen,
    toggleOpen,
    expandAll,
    collapseAll,
    // Gerçek "hepsi açık mı": bulk varsa onu, yoksa varsayılan (süzgeç aktifken açık).
    // Böylece süzgeçliyken düğme doğru "Tümünü Kapat" der ve tek tıkla kapatır.
    allExpanded: baseOpen,
    openSignature,
    sortOf,
    toggleSort,
  };
}

export type ShipmentDetailFilter = ReturnType<typeof useShipmentDetailFilter>;
