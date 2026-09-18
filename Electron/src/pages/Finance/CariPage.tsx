import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, FileSpreadsheet, Pencil } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { LabeledSelect } from "@/components/forms/LabeledSelect";
import { DIRECTION_OPTIONS, ROLE_FILTER_DEFAULTS, SUBCONTRACTOR_OPTIONS, directionFilters, isRoleFilterDirty, subcontractorFilters, type DirectionFilter, type RoleFilterPair, type SubcontractorFilter } from "@/lib/partnerRoles";
import { cariRoleLabel, listCari, money, type CariRow } from "./service";
import { StatementDialog } from "./StatementDialog";
import { CariEditDialog } from "./CariEditDialog";

/**
 * Para birimi başına AYRI satır — tek sayıya indirmek 1000 USD ile 30.000 TL'yi toplamak olurdu.
 * İşaret bakiyeyle aynı: POZİTİF = cari bize borçlu. Bakiye: yeşil/kırmızı; gecikmiş: alacağımız gecikti kırmızı,
 * borcumuz gecikti amber.
 */
function MoneyStack({ items, tone }: { items: Array<{ currency: CariRow["defaultCurrency"]; amount: number | string }>; tone: "balance" | "overdue" }) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  const cls = (v: number) =>
    tone === "balance"
      ? v > 0 ? "font-medium text-emerald-600" : "font-medium text-destructive"
      : v > 0 ? "font-medium text-destructive" : "font-medium text-amber-600 dark:text-amber-400";
  return (
    <div className="flex flex-col items-end gap-0.5">
      {items.map((it) => (
        <span key={it.currency} className={cls(Number(it.amount))}>
          {money(it.amount, it.currency)}
        </span>
      ))}
    </div>
  );
}

export function CariPage() {
  const [search, setSearch] = useState("");
  // Rol modeli (dilim F): süzgeç Cariler şeridinin çifti (Yön × Fason) — hesap, KARTIN bayrağıyla süzülür.
  const [filters, setFilters] = useState<RoleFilterPair>(ROLE_FILTER_DEFAULTS);
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [statementFor, setStatementFor] = useState<CariRow | null>(null);
  const [editFor, setEditFor] = useState<CariRow | null>(null);

  const q = useQuery({
    queryKey: ["finance", "cari", search, filters.direction, filters.subcontractor, onlyWithBalance],
    queryFn: () =>
      listCari({
        page: 1,
        pageSize: 100,
        search: search || undefined,
        filters: { ...directionFilters(filters.direction), ...subcontractorFilters(filters.subcontractor) },
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
        description="Bakiye POZİTİF ise cari size borçlu (alacağınız), NEGATİF ise siz ona borçlusunuz."
      />

      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-3">
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

      <PageBody className="p-6">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError && rows.length === 0 ? (
          /* ⚠️ HATA, "HENÜZ CARİ YOK"UN ÖNÜNDE. Aşağıdaki boş-durum cümlesi
             AÇIKLAYICI ve kendinden emin ("kendiliğinden açılır") — hata anında
             basılırsa kullanıcı sistemin doğru çalıştığına ikna olur ve carinin
             gerçekten yok olduğunu sanıp elle ikinci bir kart açtırmaya çalışır.
             Ticaret rejiminde cariye TEK kapı bu ekrandır. */
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
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {/* Cari LAZY açılır — boş liste "bozuk" değil "henüz işlem yok" demektir
                ve kullanıcı bunu bilmezse ekranı hatalı sanır. */}
            Henüz cari hesap yok. Cari hesaplar ilk fatura ya da tahsilat kaydedildiğinde
            kendiliğinden açılır.
          </div>
        ) : (
          <div className="space-y-3">
            {/* İKİNCİ KATMAN — bayat satırlar duruyor: liste gizlenmez, uyarılır. */}
            {q.isError && (
              <p className="rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Liste tazelenemedi — aşağıdaki bakiyeler son başarılı okumaya aittir ve eski
                olabilir.
              </p>
            )}
            <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Kod</th>
                  <th className="px-3 py-2 text-left">Ünvan</th>
                  <th className="px-3 py-2 text-left">Tür</th>
                  {/* "Vade" (anlaşılan gün) ile "Gecikmiş" (vadesi geçmiş açık
                      TUTAR) AYRI sorulardır — ikisi de kalır. */}
                  <th className="px-3 py-2 text-left">Vade</th>
                  <th className="px-3 py-2 text-right">Bakiye</th>
                  <th className="px-3 py-2 text-right">Gecikmiş</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                    <td className="px-3 py-2 font-medium">
                      <span className={c.isActive ? undefined : "text-muted-foreground"}>{c.name}</span>
                      {/* Pasifleştirme buradan yapılabildiği için görünür de olmalı:
                          rozetsiz satır "kaydettim ama hiçbir şey değişmedi" hissi
                          verir ve pasif cari yeni fatura/tahsilatı REDDEDER. */}
                      {!c.isActive && (
                        <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">
                          Pasif
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{cariRoleLabel(c)}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {/* `0` = peşin; `|| "—"` yazmak onu "vadesiz" gibi gösterirdi. */}
                      {c.paymentTermDays != null
                        ? c.paymentTermDays === 0
                          ? "Peşin"
                          : `${c.paymentTermDays} gün`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyStack items={c.balances.map((b) => ({ currency: b.currency, amount: b.balance }))} tone="balance" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* Vadesi geçmiş AÇIK tutar — kaynağı yaşlandırma çekirdeğinin `overdueTotal`'ı (efektif vade +
                          sanal FIFO mahsup DAHİL; Yaşlandırma raporuyla BİREBİR aynı rakam). */}
                      <MoneyStack items={c.overdue ?? []} tone="overdue" />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setStatementFor(c)}>
                          <FileSpreadsheet className="mr-1 h-4 w-4" />
                          Ekstre
                        </Button>
                        <PermissionGate permission="finance:write">
                          <Button variant="ghost" size="sm" onClick={() => setEditFor(c)}>
                            <Pencil className="mr-1 h-4 w-4" />
                            Düzenle
                          </Button>
                        </PermissionGate>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {/* KIRPMA SESSİZ DEĞİL (norm: CashTransactionsPage). Kesilen liste bu
                üründe "o cari yok" diye okunur ve mükerrer karta yol açar. */}
            {total > rows.length && (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                {total} carinin ilk {rows.length} tanesi gösteriliyor. Aradığınızı bulmak için
                arama kutusunu ya da tür/bakiye süzgecini kullanın.
              </p>
            )}
          </div>
        )}
      </PageBody>

      {statementFor && (
        <StatementDialog cari={statementFor} open onOpenChange={() => setStatementFor(null)} />
      )}

      {/* KOŞULLU mount — her açılış taze state demektir; kalıcı mount edilseydi
          başka bir cariye geçildiğinde önceki kartın değerleri formda kalırdı. */}
      {editFor && <CariEditDialog cari={editFor} open onOpenChange={() => setEditFor(null)} />}
    </PageShell>
  );
}
