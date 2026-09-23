// =============================================================================
// CARİLER — BİRLEŞİK GÖRÜNÜM (2026-08-14, kullanıcı kararı)
// =============================================================================
// Müşteri/tedarikçi (Customer) + fason (Subcontractor) kartları TEK listede,
// rol rozetiyle. Bu bir GÖRÜNÜM birleştirmesidir, tablo birleştirmesi DEĞİL:
// kartlar kendi tablolarında ve kendi form diyaloglarında yaşamaya devam eder
// (fason yetenekleri/kategorileri fason kartında). Tablo birleştirme (SAP
// Business Partner deseni) İLERİYE not edildi — bkz. bellek notu
// cari-kart-birlestirme-karari.
//
// ⚠️ Payload eşlemesi KOPYALANMAZ: düzenleme, sahiplerinin export ettiği
// buildCustomerPayload / buildSubcontractorPayload ile yapılır. Kopya, "forma
// alan eklendi ama bu ekranın eşlemesi düşürdü" sınıfı sessiz kayıp demekti
// (allowlist tuzağı — bu hafta iki kez ısırdı).
//
// OLUŞTURMA DA BURADA (2026-08-14 rejim kararı): ticaret kurulumunda Müşteriler
// ve Fason karoları gizlendiği için tek giriş kapısı bu ekran. Formlar yine
// SAHİPLERİNİN diyalogları (müşteri oluşturma satır-içi şube editörüyle) —
// davranış eski sayfalarla birebir.
//
// ⚠️ ARAMA + SAYFALAMA SUNUCUDA (2026-08-15). Önceki hâli iki kaynağı da
// `loadAllForPicker` ile çekiyordu; o yardımcı toplam > 500 olunca **throw**
// eder ve sayfa `isError`'ı hiç okumadığı için ekran "Kart bulunamadı." basardı
// — yani 500+ carisi olan alım-satım müşterisinde TÜM cari kartları silinmiş
// gibi görünürdü ve ticaret rejiminde başka giriş kapısı da yoktur. Arama da
// istemcideydi: sunucuya hiç gitmiyor, yalnız çekilen kümeyi süzüyordu.
// Sorgu planı + birleştirme + sayfa bilgisi saf katmanda (`carilerPaging`).
// =============================================================================
import { useEffect, useMemo, useState } from "react";
import { useCustomerFinanceAccess } from "@/pages/Customers/CustomerFinanceSection";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateDestinationLock } from "@/pages/Operations/SackContentEdit/destinationDefault";
import { toast } from "sonner";
import { Search, Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/PermissionGate";
import { apiErrorText } from "@/lib/api-error";
import { UNLINKED_SUBCONTRACTOR_FILTER } from "@/components/forms/supplierPicker";
import { LabeledSelect } from "@/components/forms/LabeledSelect";
import { DIRECTION_OPTIONS, SUBCONTRACTOR_OPTIONS, partnerRoleLabels, type DirectionFilter, type PartnerRoleFlags, type PartnerRoleKey, type SubcontractorFilter } from "@/lib/partnerRoles";
import { CARI_FILTER_DEFAULTS, cariPageInfo, cariQueryPlan, isCariFilterDirty, mergeCariRows, type CariFilters } from "./carilerPaging";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { CustomerFormDialog } from "@/pages/Customers/CustomerFormDialog";
import { SubcontractorFormDialog } from "@/pages/Subcontractors/SubcontractorFormDialog";
import { buildCustomerPayload } from "@/pages/Customers/CustomersPage";
import { buildSubcontractorPayload } from "@/pages/Subcontractors/SubcontractorsPage";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";

type Row =
  | { kind: "CUSTOMER"; id: string; code: string; name: string; taxNumber: string | null; phone: string | null; isActive: boolean; roles: PartnerRoleFlags; record: Customer }
  | { kind: "SUBCONTRACTOR"; id: string; code: string; name: string; taxNumber: string | null; phone: string | null; isActive: boolean; roles: PartnerRoleFlags; record: Subcontractor };

/** Rozet rengi ROL anahtarıyla — etiket `partnerRoleLabels`tan çizilir, burada metin yok; rol başına bir rozet. */
const ROLE_BADGE: Record<PartnerRoleKey, string> = {
  customer: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  supplier: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  subcontractor: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};
const ROLE_KEYS: readonly PartnerRoleKey[] = ["customer", "supplier", "subcontractor"];
const roleOn = (r: PartnerRoleFlags, k: PartnerRoleKey) => (k === "customer" ? r.isCustomerRole : k === "supplier" ? r.isSupplierRole : r.isSubcontractorRole);

/** Sayfa başına kart — iki kaynak da AYNI sayfayı çeker (bkz. `carilerPaging`). */
const PAGE_SIZE = 50;
/** Arama, her tuşta istek atmasın diye geciktirilir. */
const SEARCH_DEBOUNCE_MS = 300;

export function CarilerPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<CariFilters>(CARI_FILTER_DEFAULTS);
  const [page, setPage] = useState(1);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [editSub, setEditSub] = useState<Subcontractor | null>(null);
  // Rol modeli (kullanıcı 15:50): TEK giriş "Yeni Cari" — fason profili kartın "Fason iş yapar" kutusuyla doğar;
  // bağsız fason üretecek "Yeni Fason" yolu KALKTI. Fason formu burada yalnız DÜZENLEME için açılır.
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // ⚠️ Süzgeç değişince SAYFA BAŞA döner: 7. sayfadayken arama yazan kullanıcı,
  // 3 sonuçlu bir kümenin 7. sayfasında boş ekran görürdü ("kayıt yok" sanır).
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters]);

  const plan = cariQueryPlan(filters);

  // filters: {} → pasifler DAHİL tüm kartlar (varsayılan isActive süzgeci
  // bilinçle ezilir: yönetim görünümü pasif kartı da bulabilmeli).
  const customersQ = useQuery({
    queryKey: ["customers", "cariler", page, debouncedSearch, plan.customerFilters],
    queryFn: () =>
      customerService.getAll({
        page,
        pageSize: PAGE_SIZE,
        sortBy: "name",
        sortOrder: "asc",
        search: debouncedSearch || undefined,
        // Rol modeli: Yön × Fason süzgeçleri bayrak/`filter[role]` olarak SUNUCUYA gider (tek kaynak partnerRoles).
        filters: { ...plan.customerFilters },
      }),
    enabled: plan.customers,
  });
  const subsQ = useQuery({
    queryKey: ["subcontractors", "cariler", page, debouncedSearch],
    queryFn: () =>
      subcontractorService.getAll({
        page,
        pageSize: PAGE_SIZE,
        sortBy: "name",
        sortOrder: "asc",
        search: debouncedSearch || undefined,
        // Fason = carinin rolü: bağlı fason cari satırında görünür, bu bacak yalnız BAĞSIZ profilleri ister.
        filters: { ...UNLINKED_SUBCONTRACTOR_FILTER },
      }),
    enabled: plan.subcontractors,
  });

  const rows = useMemo<Row[]>(() => {
    const cs = plan.customers
      ? (customersQ.data?.data ?? []).map(
          (c): Row => ({
            kind: "CUSTOMER",
            id: c.id,
            code: c.code,
            name: c.name,
            taxNumber: c.taxNumber ?? null,
            phone: (c as { phone?: string | null }).phone ?? null,
            isActive: c.isActive,
            roles: { isCustomerRole: c.isCustomerRole, isSupplierRole: c.isSupplierRole, isSubcontractorRole: c.isSubcontractorRole },
            record: c,
          }),
        )
      : [];
    const ss = plan.subcontractors
      ? (subsQ.data?.data ?? []).map(
          (s): Row => ({
            kind: "SUBCONTRACTOR",
            id: s.id,
            code: s.code,
            name: s.name,
            taxNumber: (s as { taxNumber?: string | null }).taxNumber ?? null,
            phone: (s as { phone?: string | null }).phone ?? null,
            isActive: s.isActive,
            roles: { isCustomerRole: false, isSupplierRole: false, isSubcontractorRole: true },
            record: s,
          }),
        )
      : [];
    return mergeCariRows(cs, ss);
  }, [customersQ.data, subsQ.data, plan.customers, plan.subcontractors]);

  const pageInfo = cariPageInfo({
    page,
    pageSize: PAGE_SIZE,
    customerTotal: customersQ.data?.pagination?.total ?? 0,
    subTotal: subsQ.data?.pagination?.total ?? 0,
    plan,
  });
  // ⚠️ HATA "KAYIT YOK" DEĞİLDİR: tek kaynak düşse bile liste EKSİKTİR ve
  // kullanıcı eksik cariyi "yok" sanıp MÜKERRER KART açar (ticaret rejiminde
  // cari kartının tek giriş kapısı bu ekran).
  const isError = (plan.customers && customersQ.isError) || (plan.subcontractors && subsQ.isError);

  const financeAccess = useCustomerFinanceAccess();

  const createCustomerM = useMutation({
    mutationFn: (payload: Partial<Customer>) => customerService.create(payload),
    onSuccess: () => {
      toast.success("Kart oluşturuldu.");
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  const updateCustomerM = useMutation({
    mutationFn: (vars: { id: string; payload: Partial<Customer> }) => customerService.update(vars.id, vars.payload),
    onSuccess: () => {
      toast.success("Kart güncellendi.");
      setEditCustomer(null);
      void qc.invalidateQueries({ queryKey: ["customers"] });
      invalidateDestinationLock(qc);
    },
  });
  const updateSubM = useMutation({
    mutationFn: (vars: { id: string; payload: Partial<Subcontractor> }) => subcontractorService.update(vars.id, vars.payload),
    onSuccess: () => {
      toast.success("Kart güncellendi.");
      setEditSub(null);
      void qc.invalidateQueries({ queryKey: ["subcontractors"] });
    },
  });

  const loading =
    (plan.customers && customersQ.isLoading) || (plan.subcontractors && subsQ.isLoading);

  return (
    <PageShell>
      <PageHeader
        title="Cariler"
        description="Müşteri, tedarikçi ve fason kartları tek listede. Bakiyeler için Muhasebe → Cari Hesaplar."
        actions={
          <div className="flex gap-2">
            <PermissionGate permission="customer:write">
              <Button size="sm" onClick={() => setCreateOpen(true)} title="Fason firma da buradan: kartta Fason iş yapar kutusu">
                <Plus className="mr-1 h-4 w-4" />
                Yeni Cari
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-3">
        <div className="relative w-72">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Ad / kod / vergi no ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {/* Rol modeli: iki süzgeç, tetik metni adını taşır ("Yön: Tümü" · "Fason: Tümü"); süzme sunucuda. */}
        <LabeledSelect label="Yön" value={filters.direction} options={DIRECTION_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, direction: v as DirectionFilter }))} title="Ticari yön: müşteri rolü / tedarikçi rolü / ikisi de" />
        <LabeledSelect label="Fason" value={filters.subcontractor} options={SUBCONTRACTOR_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, subcontractor: v as SubcontractorFilter }))} title="Fason iş yapan kartlar (aktif fason profili)" />
        {isCariFilterDirty(filters) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(CARI_FILTER_DEFAULTS)}>
            Süzgeci temizle
          </Button>
        )}
        {/* Sayaç TOPLAMI söyler, ekrandaki satır sayısını değil: "12 kart"
            yazan bir ekranda 812 kart olması, kullanıcıya listenin tamamına
            baktığını düşündürürdü. */}
        <span className="text-xs text-muted-foreground">
          {pageInfo.total} kart
          {pageInfo.total > rows.length && ` · ${rows.length} tanesi bu sayfada`}
        </span>
      </div>

      <PageBody className="p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : isError ? (
          /* ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLAR. Bu ekranda fark daha da
             pahalı: ticaret rejiminde cari kartının TEK giriş kapısı burasıdır
             ve "Kart bulunamadı." gören kullanıcı, aslında var olan carinin
             MÜKERRER kartını açar (sonraki tüm bakiyeler ikiye bölünür). */
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">Cari kartları yüklenemedi.</p>
            {/* Backend'in KENDİ cümlesi (ortak çıkarıcı) — yeniden yazılmaz. */}
            <p className="mt-1 text-muted-foreground">
              {apiErrorText(
                customersQ.error ?? subsQ.error,
                "İstek sunucuya ulaşamadı ya da reddedildi.",
              )}
            </p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “kart yok” cevabı DEĞİLDİR. Kartlarınız yerinde duruyor; <b>yeni kart
              açmadan önce</b> tekrar deneyin — aynı firmanın ikinci kartı bakiyeyi ikiye böler.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                if (plan.customers) void customersQ.refetch();
                if (plan.subcontractors) void subsQ.refetch();
              }}
            >
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {debouncedSearch || isCariFilterDirty(filters)
              ? "Bu filtreyle kart yok. Aramayı ya da rol filtresini değiştirin."
              : "Henüz cari kartı yok. Sağ üstten müşteri/tedarikçi ya da fason kartı ekleyebilirsiniz."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Kod</th>
                  <th className="px-3 py-2 text-left">Ünvan</th>
                  <th className="px-3 py-2 text-left">Rol</th>
                  <th className="px-3 py-2 text-left">Vergi No</th>
                  <th className="px-3 py-2 text-left">Telefon</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className={`border-t ${r.isActive ? "" : "opacity-50"}`}>
                    <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-2 font-medium">
                      {r.name}
                      {!r.isActive && <span className="ml-2 text-xs text-muted-foreground">(pasif)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-1">
                        {ROLE_KEYS.filter((k) => roleOn(r.roles, k)).map((k) => (
                          <Badge key={k} className={ROLE_BADGE[k]}>
                            {partnerRoleLabels[k]}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.taxNumber ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.phone ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <PermissionGate
                        permission={r.kind === "CUSTOMER" ? "customer:write" : "subcontractor:write"}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            r.kind === "CUSTOMER" ? setEditCustomer(r.record) : setEditSub(r.record)
                          }
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Kartı aç
                        </Button>
                      </PermissionGate>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* SAYFALAMA — iki kaynak bağımsız sayfalanır; sıralama SAYFA
                İÇİdir (gerekçe: `carilerPaging` başlığı). Sayfa numarası
                yazılır ki kullanıcı nerede olduğunu bilsin. */}
            {(pageInfo.hasPrev || pageInfo.hasNext) && (
              <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
                <span className="text-muted-foreground">Sayfa {page}</span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pageInfo.hasPrev}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Önceki
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pageInfo.hasNext}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Sonraki
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </PageBody>

      {/* Sahiplerinin form diyalogları — davranış eski sayfalarla BİREBİR;
          oluşturma initial=null (müşteri formu satır-içi şube editörünü açar). */}
      <CustomerFormDialog
        open={Boolean(editCustomer) || createOpen}
        onOpenChange={(v) => {
          if (!v) {
            setEditCustomer(null);
            setCreateOpen(false);
          }
        }}
        initial={editCustomer}
        isSubmitting={updateCustomerM.isPending || createCustomerM.isPending}
        onSubmit={(values) => {
          if (editCustomer) {
            updateCustomerM.mutate({ id: editCustomer.id, payload: buildCustomerPayload(values, editCustomer, financeAccess) as Partial<Customer> });
          } else {
            createCustomerM.mutate(buildCustomerPayload(values, null, financeAccess) as Partial<Customer>);
          }
        }}
      />
      <SubcontractorFormDialog
        open={Boolean(editSub)}
        onOpenChange={(v) => {
          if (!v) setEditSub(null);
        }}
        initial={editSub}
        isSubmitting={updateSubM.isPending}
        onSubmit={(values) => {
          if (!editSub) return;
          updateSubM.mutate({
            id: editSub.id,
            payload: buildSubcontractorPayload(values, editSub) as unknown as Partial<Subcontractor>,
          });
        }}
      />
    </PageShell>
  );
}
