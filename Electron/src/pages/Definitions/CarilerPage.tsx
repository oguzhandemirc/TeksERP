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
// =============================================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/PermissionGate";
import { loadAllForPicker } from "@/lib/picker-loader";
import { companyTypeLabels } from "@/types/enums";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { CustomerFormDialog } from "@/pages/Customers/CustomerFormDialog";
import { SubcontractorFormDialog } from "@/pages/Subcontractors/SubcontractorFormDialog";
import { buildCustomerPayload } from "@/pages/Customers/CustomersPage";
import { buildSubcontractorPayload } from "@/pages/Subcontractors/SubcontractorsPage";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";

type Row =
  | { kind: "CUSTOMER"; id: string; code: string; name: string; taxNumber: string | null; phone: string | null; isActive: boolean; role: string; record: Customer }
  | { kind: "SUBCONTRACTOR"; id: string; code: string; name: string; taxNumber: string | null; phone: string | null; isActive: boolean; role: string; record: Subcontractor };

const ROLE_BADGE: Record<string, string> = {
  Müşteri: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  Tedarikçi: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  "Alıcı + Satıcı": "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  Fason: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

export function CarilerPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [editSub, setEditSub] = useState<Subcontractor | null>(null);
  const [createKind, setCreateKind] = useState<"CUSTOMER" | "SUBCONTRACTOR" | null>(null);

  // filters: {} → pasifler DAHİL tüm kartlar (varsayılan isActive süzgeci
  // bilinçle ezilir: yönetim görünümü pasif kartı da bulabilmeli).
  const customersQ = useQuery({
    queryKey: ["customers", "cariler-all"],
    queryFn: () => loadAllForPicker(customerService, { filters: {} }),
  });
  const subsQ = useQuery({
    queryKey: ["subcontractors", "cariler-all"],
    queryFn: () => loadAllForPicker(subcontractorService, { filters: {} }),
  });

  const rows = useMemo<Row[]>(() => {
    const cs = (customersQ.data?.data ?? []).map(
      (c): Row => ({
        kind: "CUSTOMER",
        id: c.id,
        code: c.code,
        name: c.name,
        taxNumber: c.taxNumber ?? null,
        phone: (c as { phone?: string | null }).phone ?? null,
        isActive: c.isActive,
        role: companyTypeLabels[c.type] ?? c.type,
        record: c,
      }),
    );
    const ss = (subsQ.data?.data ?? []).map(
      (s): Row => ({
        kind: "SUBCONTRACTOR",
        id: s.id,
        code: s.code,
        name: s.name,
        taxNumber: (s as { taxNumber?: string | null }).taxNumber ?? null,
        phone: (s as { phone?: string | null }).phone ?? null,
        isActive: s.isActive,
        role: "Fason",
        record: s,
      }),
    );
    const q = search.trim().toLocaleLowerCase("tr");
    return [...cs, ...ss]
      .filter((r) => !role || r.role === role)
      .filter(
        (r) =>
          !q ||
          r.name.toLocaleLowerCase("tr").includes(q) ||
          r.code.toLocaleLowerCase("tr").includes(q) ||
          (r.taxNumber ?? "").includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [customersQ.data, subsQ.data, search, role]);

  const createCustomerM = useMutation({
    mutationFn: (payload: Partial<Customer>) => customerService.create(payload),
    onSuccess: () => {
      toast.success("Kart oluşturuldu.");
      setCreateKind(null);
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
  const createSubM = useMutation({
    mutationFn: (payload: Partial<Subcontractor>) => subcontractorService.create(payload),
    onSuccess: () => {
      toast.success("Kart oluşturuldu.");
      setCreateKind(null);
      void qc.invalidateQueries({ queryKey: ["subcontractors"] });
    },
  });

  const updateCustomerM = useMutation({
    mutationFn: (vars: { id: string; payload: Partial<Customer> }) => customerService.update(vars.id, vars.payload),
    onSuccess: () => {
      toast.success("Kart güncellendi.");
      setEditCustomer(null);
      void qc.invalidateQueries({ queryKey: ["customers"] });
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

  const loading = customersQ.isLoading || subsQ.isLoading;

  return (
    <PageShell>
      <PageHeader
        title="Cariler"
        description="Müşteri, tedarikçi ve fason kartları tek listede. Bakiyeler için Muhasebe → Cari Hesaplar."
        actions={
          <div className="flex gap-2">
            <PermissionGate permission="customer:write">
              <Button size="sm" onClick={() => setCreateKind("CUSTOMER")}>
                <Plus className="mr-1 h-4 w-4" />
                Yeni Müşteri / Tedarikçi
              </Button>
            </PermissionGate>
            <PermissionGate permission="subcontractor:write">
              <Button variant="outline" size="sm" onClick={() => setCreateKind("SUBCONTRACTOR")}>
                <Plus className="mr-1 h-4 w-4" />
                Yeni Fason
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
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">Tüm roller</option>
          <option value="Müşteri">Müşteri</option>
          <option value="Tedarikçi">Tedarikçi</option>
          <option value="Alıcı + Satıcı">Alıcı + Satıcı</option>
          <option value="Fason">Fason</option>
        </select>
        <span className="text-xs text-muted-foreground">{rows.length} kart</span>
      </div>

      <PageBody className="p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Kart bulunamadı.
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
                      <Badge className={ROLE_BADGE[r.role] ?? ""}>{r.role}</Badge>
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
          </div>
        )}
      </PageBody>

      {/* Sahiplerinin form diyalogları — davranış eski sayfalarla BİREBİR;
          oluşturma initial=null (müşteri formu satır-içi şube editörünü açar). */}
      <CustomerFormDialog
        open={Boolean(editCustomer) || createKind === "CUSTOMER"}
        onOpenChange={(v) => {
          if (!v) {
            setEditCustomer(null);
            setCreateKind((k) => (k === "CUSTOMER" ? null : k));
          }
        }}
        initial={editCustomer}
        isSubmitting={updateCustomerM.isPending || createCustomerM.isPending}
        onSubmit={(values) => {
          if (editCustomer) {
            updateCustomerM.mutate({ id: editCustomer.id, payload: buildCustomerPayload(values, editCustomer) });
          } else {
            createCustomerM.mutate(buildCustomerPayload(values, null));
          }
        }}
      />
      <SubcontractorFormDialog
        open={Boolean(editSub) || createKind === "SUBCONTRACTOR"}
        onOpenChange={(v) => {
          if (!v) {
            setEditSub(null);
            setCreateKind((k) => (k === "SUBCONTRACTOR" ? null : k));
          }
        }}
        initial={editSub}
        isSubmitting={updateSubM.isPending || createSubM.isPending}
        onSubmit={(values) => {
          if (editSub) {
            updateSubM.mutate({
              id: editSub.id,
              payload: buildSubcontractorPayload(values, editSub) as unknown as Partial<Subcontractor>,
            });
          } else {
            createSubM.mutate(buildSubcontractorPayload(values, null) as unknown as Partial<Subcontractor>);
          }
        }}
      />
    </PageShell>
  );
}
