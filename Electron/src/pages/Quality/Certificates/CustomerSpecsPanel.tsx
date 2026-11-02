// Müşteri spesifikasyonları — müşteri (× opsiyonel ürün) × lab test türü sınırları. Lab testine müşteri
// seçilince sonuç bu sınırla karşılaştırılır (sıra: elle → müşteri+ürün → müşteri → tür varsayılanı).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { PermissionGate } from "@/components/PermissionGate";
import { labTestTypeService } from "../LabTests/service";
import { customerLabSpecService, type CustomerLabSpec } from "./service";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";

const SELECT = "h-9 rounded-md border bg-background px-2 text-sm";
const num = (v: string | number | null) => (v === null || v === "" ? "—" : String(v).replace(".", ","));
const parseBound = (s: string): number | null | "bad" => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : "bad";
};

export function CustomerSpecsPanel() {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState<CustomerLabSpec | "new" | null>(null);
  const q = useQuery({
    queryKey: ["customer-lab-specs", customerId, showInactive],
    queryFn: () => customerLabSpecService.list({ customerId: customerId ?? undefined, includeInactive: showInactive ? "1" : "0" }),
  });
  const rows = q.data ?? [];
  return (
    <>
      <ListToolbar>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-72"><CustomerPickerField clearable value={customerId} onChange={setCustomerId} placeholder="Tüm müşteriler" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Pasifleri de göster</label>
          <div className="ml-auto">
            <PermissionGate permission="labtest:write">
              <Button size="sm" onClick={() => setEdit("new")}><Plus className="mr-1 h-4 w-4" />Yeni spesifikasyon</Button>
            </PermissionGate>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Lab testine müşteri seçildiğinde sonuç bu sınırlarla karşılaştırılır; ürüne özel satır, müşterinin genel satırından önce gelir.</p>
      </ListToolbar>
      <ListBody>
        {q.isLoading ? <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
          : q.isError ? (
            <ListMessage>
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
                <p className="font-medium text-destructive">Spesifikasyonlar yüklenemedi.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>Tekrar dene</Button>
              </div>
            </ListMessage>
          ) : rows.length === 0 ? (
            <ListMessage>
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                {customerId ? "Bu müşteri için spesifikasyon yok." : "Henüz müşteri spesifikasyonu yok. Müşterinin istediği gramaj, haslık gibi sınırları buradan girin."}
              </div>
            </ListMessage>
          ) : (
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr><th className="p-3 text-left">Müşteri</th><th className="p-3 text-left">Ürün</th><th className="p-3 text-left">Test türü</th><th className="p-3 text-right">Alt sınır</th><th className="p-3 text-right">Üst sınır</th><th className="p-3 text-left">Durum</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setEdit(r)}>
                    <td className="p-3">{r.customer.name}</td>
                    <td className="p-3">{r.item ? r.item.name : <span className="text-muted-foreground">Tüm ürünler</span>}</td>
                    <td className="p-3">{r.testType.name}</td>
                    <td className="p-3 text-right tabular-nums">{num(r.specMin)}{r.testType.unit && r.specMin !== null ? ` ${r.testType.unit}` : ""}</td>
                    <td className="p-3 text-right tabular-nums">{num(r.specMax)}{r.testType.unit && r.specMax !== null ? ` ${r.testType.unit}` : ""}</td>
                    <td className="p-3">{r.isActive ? <Badge variant="outline">Etkin</Badge> : <Badge variant="secondary">Pasif</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </ListBody>
      <ListFooter loaded={rows.length} />
      {edit && <CustomerSpecFormDialog spec={edit === "new" ? null : edit} presetCustomerId={customerId} onClose={() => setEdit(null)} />}
    </>
  );
}

function CustomerSpecFormDialog({ spec, presetCustomerId, onClose }: { spec: CustomerLabSpec | null; presetCustomerId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState<string | null>(spec?.customerId ?? presetCustomerId);
  const [item, setItem] = useState<{ id: string; name: string } | null>(spec?.item ?? null);
  const [itemOpen, setItemOpen] = useState(false);
  const [testTypeId, setTestTypeId] = useState(spec?.testTypeId ?? "");
  const [min, setMin] = useState(spec?.specMin === null || spec?.specMin === undefined ? "" : String(spec.specMin).replace(".", ","));
  const [max, setMax] = useState(spec?.specMax === null || spec?.specMax === undefined ? "" : String(spec.specMax).replace(".", ","));
  const [note, setNote] = useState(spec?.note ?? "");
  const types = useQuery({ queryKey: ["lab-test-types", "active"], queryFn: () => labTestTypeService.list(true), staleTime: 60_000 });
  const lo = parseBound(min), hi = parseBound(max);
  const boundsBad = lo === "bad" || hi === "bad" || (lo !== null && hi !== null && lo > hi) || (lo === null && hi === null);
  const save = useMutation({
    mutationFn: (isActive?: boolean) => {
      const bounds = { specMin: lo as number | null, specMax: hi as number | null, note: note.trim() || null };
      if (spec) return customerLabSpecService.update(spec.id, isActive === undefined ? bounds : { isActive });
      return customerLabSpecService.create({ customerId: customerId!, itemId: item?.id ?? null, testTypeId, ...bounds });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["customer-lab-specs"] }); toast.success("Spesifikasyon kaydedildi."); onClose(); },
  });
  const ready = Boolean(customerId && testTypeId) && !boundsBad && !save.isPending;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{spec ? "Spesifikasyonu düzenle" : "Yeni müşteri spesifikasyonu"}</DialogTitle>
          <DialogDescription>Müşterinin bu test türü için kabul ettiği sınırlar. En az bir sınır girilir.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Müşteri</Label><CustomerPickerField value={customerId} onChange={setCustomerId} disabled={Boolean(spec)} /></div>
          <div className="space-y-1">
            <Label>Ürün (isteğe bağlı)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={Boolean(spec)} onClick={() => setItemOpen(true)}>{item ? "Ürünü değiştir" : "Ürün seç…"}</Button>
              <span className="text-sm">{item ? item.name : <span className="text-muted-foreground">Müşterinin bütün ürünleri</span>}</span>
              {item && !spec && <Button type="button" variant="ghost" size="sm" onClick={() => setItem(null)}>Kaldır</Button>}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="spec-type">Test türü</Label>
            <select id="spec-type" className={`${SELECT} w-full`} disabled={Boolean(spec)} value={testTypeId} onChange={(e) => setTestTypeId(e.target.value)}>
              <option value="">Seçin…</option>
              {(types.data ?? []).filter((t) => t.resultKind !== "PASS_FAIL").map((t) => <option key={t.id} value={t.id}>{t.name}{t.unit ? ` (${t.unit})` : ""}</option>)}
              {spec && !types.data?.some((t) => t.id === spec.testTypeId) && <option value={spec.testTypeId}>{spec.testType.name}</option>}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="spec-min">Alt sınır</Label><Input id="spec-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="spec-max">Üst sınır</Label><Input id="spec-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></div>
          </div>
          {boundsBad && (min || max) && <p className="text-xs text-destructive">Sınırlar sayı olmalı; alt sınır üst sınırı aşamaz.</p>}
          <div className="space-y-1"><Label htmlFor="spec-note">Not</Label><Input id="spec-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {spec && (
            <PermissionGate permission="labtest:write">
              <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(!spec.isActive)}>{spec.isActive ? "Pasife al" : "Etkinleştir"}</Button>
            </PermissionGate>
          )}
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <PermissionGate permission="labtest:write">
            <Button disabled={!ready} onClick={() => save.mutate(undefined)}>{save.isPending ? "Kaydediliyor…" : "Kaydet"}</Button>
          </PermissionGate>
        </DialogFooter>
        <ItemPickerModal open={itemOpen} onOpenChange={setItemOpen} onPick={(r) => { setItem({ id: r.id, name: r.name }); setItemOpen(false); }} />
      </DialogContent>
    </Dialog>
  );
}
