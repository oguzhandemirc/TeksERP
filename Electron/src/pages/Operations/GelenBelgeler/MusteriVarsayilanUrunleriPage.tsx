// MÜŞTERİ VARSAYILAN ÜRÜNLERİ (Gülkesim OCR E4b) — ürünü seçilmemiş satır onayda sahibin bu ürünüyle girer; müşteri
// varsayılanı fabrika ayarını ezer, kaldırılınca fabrika ayarı geçerli olur. Kullanılamaz hâle gelen ürün onayı 409 ile
// durdurur (fabrikaya düşmez) — liste bunu "sorun" olarak gösterir. İzin `gelen-belge:template` (şablon yönetimiyle aynı kişi).
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, PackageSearch } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { formatFactory } from "@/lib/factory-time";
import { INCOMING_DOCUMENT_QUERY_KEY, listCustomerDefaults, removeCustomerDefault, setCustomerDefault } from "./service";
import type { CustomerDefaultView } from "./types";

export { CUSTOMER_DEFAULTS_PATH } from "./paths";
const QUERY_KEY = [INCOMING_DOCUMENT_QUERY_KEY, "varsayilan-urunler"] as const;

function DefaultCard({ row, busy, onChange, onRemove }: { row: CustomerDefaultView; busy: boolean; onChange: () => void; onRemove: () => void }) {
  return (
    <div className="rounded-lg border bg-card p-4" data-testid={`customer-default-${row.customerId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words font-medium">
            {row.customer.name} <span className="text-xs text-muted-foreground">{row.customer.code}</span>
          </div>
          <div className="break-words text-sm">
            Ürün: {row.item.name} <span className="text-xs text-muted-foreground">{row.item.code}</span>
          </div>
          <div className="text-xs text-muted-foreground">Son güncelleme: {formatFactory(row.updatedAt, "dd.MM.yyyy HH:mm")}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onChange}>
            Değiştir
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={onRemove}>
            Kaldır
          </Button>
        </div>
      </div>
      {!row.customer.isActive && (
        <Badge variant="outline" className="mt-2">
          Müşteri pasif
        </Badge>
      )}
      {row.problem && (
        <p className="mt-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" data-testid="customer-default-problem">
          Onay bu ürünle yapılamaz: {row.problem} Ürünü değiştirin ya da kaldırın.
        </p>
      )}
    </div>
  );
}

/** Yeni atama: müşteri seçici + ürün seçici (ikisi de doğrudan modal); müşterinin varsayılanı varsa kaydetmek değiştirir. */
function CustomerDefaultForm({ rows, pending, onSave }: { rows: readonly CustomerDefaultView[]; pending: boolean; onSave: (customerId: string, itemId: string) => Promise<unknown> }) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const existing = customerId ? rows.find((r) => r.customerId === customerId) : undefined;
  const submit = () => {
    if (!customerId || !item) return;
    // Başarıda form boşalır; hata toast'u apiClient'ta, seçim yerinde kalır.
    onSave(customerId, item.id).then(() => { setCustomerId(null); setItem(null); }, () => undefined);
  };
  return (
    <div className="rounded-lg border bg-card p-4" data-testid="customer-default-form">
      <div className="mb-2 text-sm font-medium">Müşteriye varsayılan ürün ata</div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Müşteri (belgenin sahibi)</div>
          <CustomerPickerField value={customerId} onChange={setCustomerId} placeholder="Müşteri seç" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Varsayılan ürün (kumaş)</div>
          <Button type="button" variant="outline" className="w-full justify-start truncate" onClick={() => setPicking(true)} data-testid="customer-default-item">
            <PackageSearch className="mr-1 h-4 w-4 shrink-0" />
            <span className="truncate">{item?.label ?? "Ürün seç"}</span>
          </Button>
        </div>
        <Button disabled={!customerId || !item || pending} onClick={submit}>
          {existing ? "Değiştir" : "Kaydet"}
        </Button>
      </div>
      {existing && <p className="mt-2 text-xs text-muted-foreground">Bu müşterinin varsayılanı var ({existing.item.name}); kaydetmek değiştirir.</p>}
      <FabricPicker open={picking} onOpenChange={setPicking} onPick={(r) => setItem({ id: r.id, label: `${r.name} — ${r.code}` })} />
    </div>
  );
}

/** Yalnız top doğurabilen kumaş: tür FABRIC + yaşam döngüsü ACTIVE (backend kapısı yine `itemProblem`). */
function FabricPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (r: { id: string; name: string; code: string }) => void }) {
  return (
    <ItemPickerModal open={open} onOpenChange={onOpenChange} allowedTypes={["FABRIC"]} lifecycle="ACTIVE" onPick={(r) => { onPick(r); onOpenChange(false); }} />
  );
}

function ListState({ list, children }: { list: { isLoading: boolean; isError: boolean; refetch: () => unknown; data?: readonly unknown[] }; children: ReactNode }) {
  if (list.isLoading) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  if (list.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
        <p className="font-medium text-destructive">Müşteri varsayılanları yüklenemedi.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void list.refetch()}>
          Tekrar dene
        </Button>
      </div>
    );
  }
  if (!list.data?.length) return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Müşteriye özel varsayılan ürün yok; ürünsüz satırlar fabrika ayarıyla girer.</div>;
  return <>{children}</>;
}

export function CustomerDefaultsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: QUERY_KEY, queryFn: listCustomerDefaults });
  const [changeFor, setChangeFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CustomerDefaultView | null>(null);
  // Hata toast'u apiClient'ta; liste her durumda sunucudan tazelenir (409 sonrası güncel hâl görünsün).
  // Açık belgelerin eşleşme yanıtı (etkin varsayılan + kaynak ipucu) da tazelenir.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: QUERY_KEY });
    void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "eslestirme"] });
  };
  const save = useMutation({ mutationFn: (v: { customerId: string; itemId: string }) => setCustomerDefault(v.customerId, v.itemId), onSettled: refresh });
  const remove = useMutation({ mutationFn: (id: string) => removeCustomerDefault(id), onSettled: refresh });
  const rows = list.data ?? [];
  const busy = (id: string) => (save.isPending && save.variables?.customerId === id) || (remove.isPending && remove.variables === id);
  return (
    <PageShell>
      <PageHeader
        title="Müşteri Varsayılan Ürünleri"
        description="Gelen belgede ürünü seçilmemiş satır, onayda belgenin sahibi olan müşterinin buradaki ürünüyle girer. Müşteri varsayılanı yoksa fabrika ayarındaki varsayılan ürün kullanılır."
        actions={
          <Button variant="outline" asChild>
            <Link to="/operations/gelen-belgeler">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Gelen Belgeler
            </Link>
          </Button>
        }
      />
      <PageBody className="min-h-0 space-y-3 p-4 sm:p-6">
        <CustomerDefaultForm rows={rows} pending={save.isPending} onSave={(customerId, itemId) => save.mutateAsync({ customerId, itemId })} />
        <ListState list={list}>
          {rows.map((row) => (
            <DefaultCard key={row.customerId} row={row} busy={busy(row.customerId)} onChange={() => setChangeFor(row.customerId)} onRemove={() => setRemoving(row)} />
          ))}
        </ListState>
      </PageBody>
      <FabricPicker open={changeFor !== null} onOpenChange={(o) => !o && setChangeFor(null)} onPick={(r) => changeFor && save.mutate({ customerId: changeFor, itemId: r.id })} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        title="Müşteri varsayılanı kaldırılsın mı?"
        description={removing ? `${removing.customer.name} için varsayılan ürün (${removing.item.name}) kaldırılır; bu müşterinin ürünsüz satırları bundan sonra fabrika ayarıyla girer.` : undefined}
        confirmLabel="Kaldır"
        onConfirm={() => {
          if (removing) remove.mutate(removing.customerId);
          setRemoving(null);
        }}
      />
    </PageShell>
  );
}
