import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { RelocatedToolButtons } from "@/components/RelocatedToolButtons";
import { PageShell } from "@/components/layout/PageShell";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { Button } from "@/components/ui/button";
import { TruncatedHint } from "./TruncatedHint";
import { LabeledSelect } from "@/components/forms/LabeledSelect";
import { DIRECTION_OPTIONS, ROLE_FILTER_DEFAULTS, SUBCONTRACTOR_OPTIONS, directionFilters, isRoleFilterDirty, subcontractorFilters, type DirectionFilter, type RoleFilterPair, type SubcontractorFilter } from "@/lib/partnerRoles";
import { listCari, type CariRow } from "./service";
import { StatementDialog } from "./StatementDialog";
import { activityFilters, CARI_ACTIVITY_DEFAULT, CARI_ACTIVITY_OPTIONS, CARI_EMPTY_ACTIVE_HINT, CARI_EMPTY_ALL_HINT, CARI_EMPTY_HELD_HINT, CARI_HOLD_FILTER_OPTIONS, holdFilters, useHoldFilter, type CariActivityFilter, type CariHoldFilter } from "./cariListFilters";
import { CariHoldDialog } from "./CariRowExtras";
import { CariEditDialog } from "./CariEditDialog";
import { CariTable, useFinanceCariTable } from "./CariTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useCariFocus } from "./useCariFocus";
import { RefreshButton } from "@/components/RefreshButton";

export function CariPage() {
  const [search, setSearch] = useState("");
  // Rol modeli (dilim F): süzgeç Cariler şeridinin çifti (Yön × Fason) — hesap, KARTIN bayrağıyla süzülür.
  const [filters, setFilters] = useState<RoleFilterPair>(ROLE_FILTER_DEFAULTS);
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  // Z-B ④: varsayılan Hareketli — hesap kartla doğar, hareketsiz hesap listeyi şişirmesin; Tümü süzgeç göndermez.
  const [activity, setActivity] = useState<CariActivityFilter>(CARI_ACTIVITY_DEFAULT);
  const [statementFor, setStatementFor] = useState<CariRow | null>(null);
  const [editFor, setEditFor] = useState<CariRow | null>(null);
  const [held, setHeld] = useHoldFilter(); // D4-I3: süzgeç sunucuda; menü `?kilit=1` ile açar.
  const [holdFor, setHoldFor] = useState<CariRow | null>(null);
  // Bildirimden `?focus=<hesapId>` → o carinin kartı (ekstre) açılır (D4-KUC3a).
  useCariFocus(setStatementFor);

  const q = useQuery({
    queryKey: ["finance", "cari", search, filters.direction, filters.subcontractor, onlyWithBalance, activity, held],
    queryFn: () =>
      listCari({
        page: 1,
        pageSize: 100,
        search: search || undefined,
        filters: { ...directionFilters(filters.direction), ...subcontractorFilters(filters.subcontractor), ...activityFilters(activity), ...holdFilters(held) },
        onlyWithBalance,
        // "Gecikmiş" kolonu bu sayfanın parçası → daima istenir. Backend bunu
        // yaşlandırma ÇEKİRDEĞİNDEN üretir (tek kaynak); eski backend bayrağı
        // tanımazsa alan hiç gelmez ve kolon "—" basar (aşağıda opsiyonel okuma).
        withOverdue: true,
      }),
  });

  const rows = q.data?.data ?? [];
  const total = q.data?.pagination?.total ?? 0;
  const table = useFinanceCariTable(rows, { onStatement: setStatementFor, onHold: setHoldFor, onEdit: setEditFor });

  return (
    <PageShell>
      <PageHeader
        title="Cari Hesaplar"
        actions={
          <div className="flex items-center gap-2">
            <RelocatedToolButtons host="/finance/cari" />
            <RefreshButton queryKey={["finance", "cari"]} />
          </div>
        }
        description="Bakiye POZİTİF ise cari size borçlu (alacağınız), NEGATİF ise siz ona borçlusunuz."
      />

      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Cari adı ya da kodu ara" />
        <LabeledSelect label="Yön" value={filters.direction} options={DIRECTION_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, direction: v as DirectionFilter }))} title="Ticari yön: müşteri rolü / tedarikçi rolü / ikisi de" />
        <LabeledSelect label="Fason" value={filters.subcontractor} options={SUBCONTRACTOR_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, subcontractor: v as SubcontractorFilter }))} title="Fason iş yapan kartların hesapları" />

        <LabeledSelect label="Durum" value={activity} options={CARI_ACTIVITY_OPTIONS} onChange={(v) => setActivity(v as CariActivityFilter)} title="Hareketli: en az bir cari hareketi olan hesaplar" />
        <LabeledSelect label="Kilit" value={held} options={CARI_HOLD_FILTER_OPTIONS} onChange={(v) => setHeld(v as CariHoldFilter)} title="Kilitli: aktif cari kilidi olan hesaplar" />
        {isRoleFilterDirty(filters) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(ROLE_FILTER_DEFAULTS)}>
            Filtreyi temizle
          </Button>
        )}
        <ToolbarToggle checked={onlyWithBalance} onCheckedChange={setOnlyWithBalance} label="Yalnız bakiyesi olanlar" />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Cari hesaplar" />
        </div>
      </ListToolbar>

      {/* ⚠️ HATA, "HENÜZ CARİ YOK"UN ÖNÜNDE (DataTable.isError): kendinden emin boş-durum cümlesi hata anında basılırsa
          kullanıcı carinin gerçekten yok olduğunu sanıp ikinci kart açtırır. Ticaret rejiminde cariye TEK kapı bu ekrandır. */}
      <CariTable
        table={table}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => void q.refetch()}
        emptyText={held === "held" ? CARI_EMPTY_HELD_HINT : activity === "active" ? CARI_EMPTY_ACTIVE_HINT : CARI_EMPTY_ALL_HINT}
      />
      {/* KIRPMA SESSİZ DEĞİL: kesilen liste "o cari yok" diye okunur ve mükerrer karta yol açar — alt çubukta. */}
      <ListFooter loaded={rows.length} total={q.data ? total : null}>
        {total > rows.length && rows.length > 0 ? <TruncatedHint /> : null}
      </ListFooter>

      {statementFor && (
        <StatementDialog cari={statementFor} open onOpenChange={() => setStatementFor(null)} />
      )}

      {/* KOŞULLU mount — her açılış taze state demektir; kalıcı mount edilseydi
          başka bir cariye geçildiğinde önceki kartın değerleri formda kalırdı. */}
      {holdFor && <CariHoldDialog cariId={holdFor.id} cariName={holdFor.name} onClose={() => setHoldFor(null)} />}
      {editFor && <CariEditDialog cari={editFor} open onOpenChange={() => setEditFor(null)} />}
    </PageShell>
  );
}
