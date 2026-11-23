import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListFooter } from "@/components/layout/ListPage";
import { RefreshButton } from "@/components/RefreshButton";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { splitDefFilters } from "@/components/data-table/filter-row/def-row-filters";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { productBalanceService } from "./service";
import { ProductBalanceDetail } from "./ProductBalanceRow";
import { BALANCE_EXPORT_COLUMNS, useProductBalanceTable, type BalanceExportRow } from "./productBalanceColumns";
import { DataTable } from "@/components/data-table/DataTable";
import { ProductBalanceWoDialog } from "./ProductBalanceWoDialog";
import type { BalanceGroup, BalanceSpecRow, WoTarget } from "./types";
import { foldSearchText } from "@/lib/search-fold";
import { TERIM } from "@/lib/terim";

const QUERY_KEY = "product-balance";

// Kumaş → backend (sorguları daraltır). Renk/Durum → client-side (anlık).
// Kumaş + renk ÇOKLU. Durum TEKİL kalır: Açık / Karşılanıyor birbirinin
// tümleyeni (ikisini seçmek "filtre yok" demek) ve Ham açığı onlarla kesişir —
// çoklu seçim burada kullanıcıya anlamsız kombinasyon vaat ederdi.
const FILTERS: FilterDef[] = [
  { kind: "multi-lookup", key: "itemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "multi-lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  {
    kind: "select",
    key: "status",
    label: "Durum",
    options: [
      { value: "OPEN", label: "Açık (üretilecek var)" },
      { value: "COVERED", label: "Karşılanıyor" },
      { value: "MATERIAL_SHORT", label: "Ham açığı var" },
    ],
  },
];
/** Üç filtre de ilk açılışta satırda ("Kumaş: Tümü" · "Renk: Tümü" · "Durum: Tümü"). */
const ROW_FILTERS = splitDefFilters(FILTERS, ["itemId", "colorId", "status"]).primary;

export function ProductBalancePage() {
  const [searchParams] = useSearchParams();
  // itemId server-side (queryKey + ?itemId=...); diğerleri client-side filtre.
  // Kumaş ve renk ÇOKLU (`filter[x]=a,b`): itemId CSV olarak backend'e AYNEN
  // gider (`getBalance` → `readIdCondition` → `in`), renk burada listede süzülür.
  const itemId = searchParams.get("filter[itemId]") ?? undefined;
  const colorIds = useMemo(() => {
    const csv = searchParams.get("filter[colorId]");
    return csv ? csv.split(",").filter(Boolean) : [];
  }, [searchParams]);
  const status = searchParams.get("filter[status]") ?? undefined;

  const [woTarget, setWoTarget] = useState<WoTarget | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: [QUERY_KEY, itemId ?? null],
    queryFn: () => productBalanceService.getBalance({ itemId }),
    staleTime: 15_000,
  });
  const groups = useMemo(() => data?.data ?? [], [data]);

  // Renk + durum + arama: küçük grup listesi üzerinde anlık (ağ isteği yok).
  const filtered = useMemo(() => {
    const q = foldSearchText(search);
    return groups.filter((g) => {
      // Çoklu renk = VEYA. Boş seçim (hiç renk yok) filtre uygulamaz.
      if (colorIds.length > 0 && !(g.colorId && colorIds.includes(g.colorId))) return false;
      if (status === "OPEN" && !(g.uretilecek > 0)) return false;
      if (status === "COVERED" && g.uretilecek > 0) return false;
      if (status === "MATERIAL_SHORT" && !(g.malzemeAcigi > 0)) return false;
      if (!q) return true;
      return (
        foldSearchText(g.itemName).includes(q) ||
        foldSearchText(g.colorName ?? "").includes(q) ||
        g.specs.some(
          (s) =>
            (s.width != null && String(s.width).includes(q)) ||
            s.lines.some(
              (l) =>
                foldSearchText(l.orderNumber).includes(q) ||
                foldSearchText(l.customerName).includes(q),
            ) ||
            s.wos.some((w) => foldSearchText(w.batchNumber).includes(q)),
        )
      );
    });
  }, [groups, colorIds, status, search]);

  // Dışa aktarım: EKRANDA GÖRÜNEN grupların EN kırılımı (ekranın en ince satırı).
  // Filtreler (kumaş/renk/durum/arama) zaten `filtered`'a uygulanmış durumda.
  const exportRows = useMemo<BalanceExportRow[]>(
    () => filtered.flatMap((g) => g.specs.map((s) => ({ group: g, spec: s }))),
    [filtered],
  );

  const openWo = useCallback((g: BalanceGroup, s: BalanceSpecRow) =>
    setWoTarget({
      key: s.key,
      itemId: s.itemId,
      itemName: s.itemName,
      colorId: s.colorId,
      colorName: s.colorName,
      width: s.width,
      talep: s.talep,
      depo: s.depo,
      uretimde: s.uretimde,
      uretilecek: s.uretilecek,
      ham: g.ham,
      yariMamul: g.yariMamul,
      lines: s.lines,
    }), []);
  const table = useProductBalanceTable(filtered, openWo);

  return (
    <PageShell>
      <PageHeader
        title="Kumaş Dengesi"
        description="Üretilecek = Talep − Depo − Üretimde. Fabrika kumaş üretmez, işler — ham stok yetmiyorsa “ham açığı” kadar kumaş tedariki gerekir. Ham kumaşın eni önemsizdir: ham havuzu kumaş+renk düzeyinde tutulur, en'lere bölünmez (renksiz ham boyanacağı için her renge sayılır)."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      <FilterRow
        search={search}
        onSearchChange={setSearch}
        searchHint="Kumaş, renk, sipariş no, müşteri, parti ara"
        primary={ROW_FILTERS}
        tools={{ table, hideExport: true }}
        trailing={
            <ListExportMenu
              name="Kumaş Dengesi"
              rows={exportRows}
              columns={BALANCE_EXPORT_COLUMNS}
              disabled={isLoading}
              // undefined → ListExportMenu kendi "İndirilecek kayıt yok" ipucunu verir.
              title={
                isLoading
                  ? "Denge hesaplanıyor…"
                  : exportRows.length > 0
                    ? "Ekrandaki denge satırlarını indir"
                    : undefined
              }
              notes={[
                `Ekranda görünen ${filtered.length} kumaş+renk grubu (toplam ${groups.length}), ${exportRows.length} en satırı — kumaş / renk / durum filtresi ve arama uygulanmış hâliyle.`,
                "Bir satır = bir (kumaş, renk, en) alt-satırı. Ekranın ana tablosu grubu özetler; dosya en kırılımını verir, grup sütunları tekrarlanır.",
                "Üretilecek = Talep − Depo − Üretimde. Talep = İstenen − Sevk Edilen (açık siparişler).",
                "Ham ve Ham Açığı kumaş+renk düzeyinde ORTAKTIR (en'lere bölünmez) — grubun her satırında aynı sayı yazılıdır ve bu yüzden TOPLAM satırına GİRMEZ.",
                `Sipariş / ${TERIM.terbiyeIsEmri.tekilKucuk} sütunları o en alt-satırına bağlı kayıtlardır; ${TERIM.terbiyeIsEmri.cogulKucuk} yalnız CANLI (iptal edilmemiş) olanlardır.`,
              ]}
            />
        }
      />

      <DataTable
        table={table}
        isLoading={isLoading}
        emptyText={groups.length === 0 ? "Açık talep veya üretimde kumaş yok." : "Filtreye uyan kumaş yok."}
        renderExpanded={(g) => <ProductBalanceDetail group={g} onOpenWo={openWo} />}
        rowTitle={(g) => `${g.itemName}${g.colorName ? ` · ${g.colorName}` : ""} — en kırılımı ve siparişler için aç`}
      />
      {!isLoading && <ListFooter loaded={filtered.length} total={groups.length} />}

      <ProductBalanceWoDialog
        spec={woTarget}
        open={woTarget !== null}
        onOpenChange={(o) => !o && setWoTarget(null)}
      />
    </PageShell>
  );
}
