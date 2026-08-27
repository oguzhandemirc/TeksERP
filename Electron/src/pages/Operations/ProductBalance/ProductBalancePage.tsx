import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import type { ExportColumn } from "@/lib/list-export";
import { safeFormat } from "@/lib/format";
import { workOrderStatusLabels, type WorkOrderStatus } from "@/types/enums";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { productBalanceService } from "./service";
import { ProductBalanceRow } from "./ProductBalanceRow";
import { ProductBalanceWoDialog } from "./ProductBalanceWoDialog";
import type { BalanceGroup, BalanceSpecRow, WoTarget } from "./types";
import { foldSearchText } from "@/lib/search-fold";

const QUERY_KEY = "product-balance";

/**
 * Dışa aktarım satırı — ekran (kumaş+renk) grubu + açılır EN kırılımı; dosya bunun
 * DÜZLEŞTİRİLMİŞİ: bir satır = bir (kumaş, renk, en) alt-satırı, yani ekranın en
 * ince kırılımı. Grup sütunları (Ham / Ham Açığı) tekrarlanır.
 */
interface BalanceExportRow {
  group: BalanceGroup;
  spec: BalanceSpecRow;
}

/**
 * ⚠️ `summable` YALNIZ en (spec) düzeyinde eklenebilir miktarlara verilir.
 * Ham ve Ham Açığı (kumaş+renk havuzu, en'lere BÖLÜNMEZ) her satırda tekrarlandığı
 * için toplanabilir DEĞİL — TOPLAM satırı onları grup içindeki en sayısı kadar
 * sayardı ve dosya, ekranın söylediğinden fazla ham stok gösterirdi.
 */
const BALANCE_EXPORT_COLUMNS: ExportColumn<BalanceExportRow>[] = [
  { label: "Kumaş", value: (r) => r.spec.itemName },
  { label: "Renk", value: (r) => r.spec.colorName ?? "—" },
  { label: "En (cm)", value: (r) => r.spec.width ?? "" },
  { label: "Talep (m)", value: (r) => r.spec.talep, summable: true },
  { label: "Depo (m)", value: (r) => r.spec.depo, summable: true },
  { label: "Üretimde (m)", value: (r) => r.spec.uretimde, summable: true },
  { label: "Üretilecek (m)", value: (r) => r.spec.uretilecek, summable: true },
  { label: "Durum", value: (r) => (r.spec.uretilecek > 0 ? "Üretilecek" : "Karşılanıyor") },
  { label: "Ham (m, kumaş+renk)", value: (r) => r.group.ham },
  { label: "Yarı Mamul (m, kumaş+renk)", value: (r) => r.group.yariMamul },
  { label: "Ham Açığı (m, kumaş+renk)", value: (r) => r.group.malzemeAcigi },
  { label: "Sipariş Sayısı", value: (r) => r.spec.lines.length, summable: true },
  // İstenen − Sevk = Talep (yukarıdaki sütun). Ayrı bir "Kalan" sütunu EKLENMEDİ:
  // Talep'in birebir aynısı olurdu ve iki farklı isim aynı sayıyı gösterirdi.
  { label: "İstenen (m)", value: (r) => sum(r.spec.lines, (l) => l.quantity), summable: true },
  { label: "Sevk Edilen (m)", value: (r) => sum(r.spec.lines, (l) => l.shipped), summable: true },
  { label: "Siparişler", value: (r) => uniq(r.spec.lines.map((l) => l.orderNumber)).join(", ") },
  { label: "Müşteriler", value: (r) => uniq(r.spec.lines.map((l) => l.customerName)).join(", ") },
  { label: "En Yakın Termin", value: (r) => earliestDeadline(r.spec) },
  { label: "Canlı İş Emri Sayısı", value: (r) => r.spec.wos.length, summable: true },
  {
    label: "İş Emirleri",
    value: (r) =>
      r.spec.wos
        .map(
          (w) =>
            `${w.batchNumber} (${workOrderStatusLabels[w.status as WorkOrderStatus] ?? w.status})`,
        )
        .join(", "),
  },
];

const sum = <T,>(rows: T[], pick: (row: T) => number): number =>
  rows.reduce((acc, row) => acc + pick(row), 0);

const uniq = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

/** En erken termin (ekrandaki drill-down sıralamasıyla aynı ölçüt). */
function earliestDeadline(spec: BalanceSpecRow): string {
  const stamps = spec.lines
    .map((l) => l.deadline)
    .filter((d): d is string => Boolean(d))
    .sort();
  return stamps.length > 0 ? safeFormat(stamps[0], "dd.MM.yyyy") : "";
}

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

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  // Perf: ProductBalanceRow React.memo'lu — aramaya yazarken filtre dışı kalmayan
  // satırlar re-render olmasın diye handler'lar kararlı referans (useCallback).
  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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

  return (
    <PageShell>
      <PageHeader
        title="Kumaş Dengesi"
        actions={
          <>
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
                "Sipariş / iş emri sütunları o en alt-satırına bağlı kayıtlardır; iş emirleri yalnız CANLI (iptal edilmemiş) olanlardır.",
              ]}
            />
            <RefreshButton queryKey={QUERY_KEY} />
          </>
        }
      />

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kumaş, renk, sipariş no, müşteri, parti ara..."
            className="h-8 pl-8 text-sm"
          />
        </div>
        {!isLoading && (
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} kumaş
          </span>
        )}
      </div>
      <FilterBar filters={FILTERS} />

      <PageBody className="flex flex-col p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Hesaplanıyor…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Açık talep veya üretimde kumaş yok.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Filtreyle eşleşen kumaş yok.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                  <th className="text-left">Kumaş</th>
                  <th className="text-left" title="En (cm)">En</th>
                  <th className="text-right" title="Açık siparişler (istenen − sevk)">
                    Talep
                  </th>
                  <th className="text-right" title="Depoda hazır (sevksiz)">Depo</th>
                  <th className="text-right" title="Canlı iş emirlerinde">Üretimde</th>
                  <th
                    className="text-right"
                    title="İşlenecek ham kumaş — kumaş+renk havuzu (eni önemsiz)"
                  >
                    Ham
                  </th>
                  <th className="text-right" title="Talep − Depo − Üretimde">Üretilecek</th>
                  <th className="text-right" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => (
                  <ProductBalanceRow
                    key={g.key}
                    group={g}
                    isOpen={expanded.has(g.key)}
                    onToggle={toggle}
                    onOpenWo={openWo}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Üretilecek = Talep − Depo − Üretimde. Fabrika kumaş üretmez, işler —
          ham stok yetmiyorsa "ham açığı" kadar kumaş tedariki gerekir. Ham
          kumaşın eni önemsizdir: ham havuzu kumaş+renk düzeyinde tutulur, en'lere
          bölünmez (renksiz ham boyanacağı için her renge sayılır).
        </p>
      </PageBody>

      <ProductBalanceWoDialog
        spec={woTarget}
        open={woTarget !== null}
        onOpenChange={(o) => !o && setWoTarget(null)}
      />
    </PageShell>
  );
}
