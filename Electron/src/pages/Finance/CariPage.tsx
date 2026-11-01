import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RelocatedToolStrip } from "@/pages/Reports/_v2/RelocatedTools";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LabeledSelect } from "@/components/forms/LabeledSelect";
import { DIRECTION_OPTIONS, ROLE_FILTER_DEFAULTS, SUBCONTRACTOR_OPTIONS, directionFilters, isRoleFilterDirty, subcontractorFilters, type DirectionFilter, type RoleFilterPair, type SubcontractorFilter } from "@/lib/partnerRoles";
import { listCari, type CariRow } from "./service";
import { StatementDialog } from "./StatementDialog";
import { activityFilters, CARI_ACTIVITY_DEFAULT, CARI_ACTIVITY_OPTIONS, CARI_EMPTY_ACTIVE_HINT, CARI_EMPTY_ALL_HINT, CARI_EMPTY_HELD_HINT, CARI_HOLD_FILTER_OPTIONS, holdFilters, useHoldFilter, type CariActivityFilter, type CariHoldFilter } from "./cariListFilters";
import { CariHoldDialog } from "./CariRowExtras";
import { CariEditDialog } from "./CariEditDialog";
import { CariTable } from "./CariTable";
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

  return (
    <PageShell>
      <PageHeader
        title="Cari Hesaplar"
        actions={<RefreshButton queryKey={["finance", "cari"]} />}
        description="Bakiye POZİTİF ise cari size borçlu (alacağınız), NEGATİF ise siz ona borçlusunuz."
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3 md:px-6">
        <div className="relative w-72">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Cari ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <LabeledSelect label="Yön" value={filters.direction} options={DIRECTION_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, direction: v as DirectionFilter }))} title="Ticari yön: müşteri rolü / tedarikçi rolü / ikisi de" />
        <LabeledSelect label="Fason" value={filters.subcontractor} options={SUBCONTRACTOR_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, subcontractor: v as SubcontractorFilter }))} title="Fason iş yapan kartların hesapları" />

        <LabeledSelect label="Durum" value={activity} options={CARI_ACTIVITY_OPTIONS} onChange={(v) => setActivity(v as CariActivityFilter)} title="Hareketli: en az bir cari hareketi olan hesaplar" />
        <LabeledSelect label="Kilit" value={held} options={CARI_HOLD_FILTER_OPTIONS} onChange={(v) => setHeld(v as CariHoldFilter)} title="Kilitli: aktif cari kilidi olan hesaplar" />
        {isRoleFilterDirty(filters) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(ROLE_FILTER_DEFAULTS)}>
            Süzgeci temizle
          </Button>
        )}
        <Button
          variant={onlyWithBalance ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyWithBalance((v) => !v)}
        >
          Yalnız bakiyesi olanlar
        </Button>
      </div>
      <RelocatedToolStrip host="/finance/cari" />

      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError && rows.length === 0 ? (
          /* ⚠️ HATA, "HENÜZ CARİ YOK"UN ÖNÜNDE. Aşağıdaki boş-durum cümlesi
             AÇIKLAYICI ve kendinden emin ("kendiliğinden açılır") — hata anında
             basılırsa kullanıcı sistemin doğru çalıştığına ikna olur ve carinin
             gerçekten yok olduğunu sanıp elle ikinci bir kart açtırmaya çalışır.
             Ticaret rejiminde cariye TEK kapı bu ekrandır. */
          <ListMessage>
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Cari listesi yüklenemedi.</p>
              <p className="mt-1 text-muted-foreground">
                Bu bir “cari yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi.
                Kayıtlarınız yerinde duruyor; bakiyeye göre karar vermeden önce tekrar deneyin.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
                Tekrar dene
              </Button>
            </div>
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{held === "held" ? CARI_EMPTY_HELD_HINT : activity === "active" ? CARI_EMPTY_ACTIVE_HINT : CARI_EMPTY_ALL_HINT}</div>
          </ListMessage>
        ) : (
          <>
            {/* İKİNCİ KATMAN — bayat satırlar duruyor: liste gizlenmez, uyarılır. */}
            {q.isError && (
              <p className="border-b bg-amber-100 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Liste tazelenemedi — aşağıdaki bakiyeler son başarılı okumaya aittir ve eski
                olabilir.
              </p>
            )}
            <CariTable rows={rows} onStatement={setStatementFor} onHold={setHoldFor} onEdit={setEditFor} />
            {/* KIRPMA SESSİZ DEĞİL (norm: CashTransactionsPage). Kesilen liste bu
                üründe "o cari yok" diye okunur ve mükerrer karta yol açar. */}
            {total > rows.length && (
              <p className="border-t px-4 py-2 text-xs text-amber-700 dark:text-amber-500">
                {total} carinin ilk {rows.length} tanesi gösteriliyor. Aradığınızı bulmak için
                arama kutusunu ya da tür/bakiye süzgecini kullanın.
              </p>
            )}
          </>
        )}
      </ListBody>
      <ListFooter loaded={rows.length} total={q.data ? total : null} />

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
