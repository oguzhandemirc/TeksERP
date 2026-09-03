import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { shouldWarnMultiWarehouseClosed } from "./multiWarehouseWarning";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { warehouseFormDefaults, warehouseFormSchema, type WarehouseFormValues } from "./schema";
import type { Warehouse } from "./types";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Warehouse | null;
  onSubmit: (values: WarehouseFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function WarehouseFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  // ⚠️ 2026-09-02'den beri çok-depoluluk VERİDEN TÜRETİLMİYOR: ikinci depoyu
  // açmak yüzeyleri kendiliğinden getirmez, `depo.multiEnabled` de açılmalıdır.
  // Kullanıcı bunu kaydettikten SONRA "seçici niye çıkmadı" diye aramasın diye
  // kaydetmeden ÖNCE söylüyoruz (varsayılan depo uyarısıyla aynı desen).
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  const warnMultiClosed = shouldWarnMultiWarehouseClosed({
    depoMultiEnabled: multiWarehouse,
    activeWarehouseIds: warehouses.filter((w) => w.isActive).map((w) => w.id),
    editingId: initial?.id ?? null,
    willBeActive: initial ? initial.isActive : true,
  });

  const defaults: WarehouseFormValues = initial
    ? {
        name: initial.name,
        address: initial.address ?? "",
        notes: initial.notes ?? "",
        isActive: initial.isActive,
      }
    : warehouseFormDefaults;

  return (
    <EntityFormDialog<WarehouseFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Depoyu Düzenle" : "Yeni Depo"}
      schema={warehouseFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          {initial?.code && (
            <div className="text-xs text-muted-foreground">
              Kod: <span className="font-mono">{initial.code}</span>
            </div>
          )}
          {warnMultiClosed && (
            // ENGEL DEĞİL BİLGİ: ikinci depo tanımlamak modülden bağımsız
            // olarak meşrudur (depo kartı ve defteri anahtarsız da çalışır).
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <b>Çoklu depo modülü kapalı.</b> İkinci aktif depo tanımlayabilirsiniz ama depo
              seçicileri, listelerdeki depo kolonu ve Depo Transferi ekranı görünmez; transfer
              uçları da 403 verir. Açmak için: Sistem → Sistem Profili (ya da Genel Ayarlar →
              Modüller).
            </div>
          )}
          {initial?.isDefault && (
            // Varsayılan depo pasife alınamaz (backend 409 verir) — kullanıcıya
            // bunu Kaydet'e bastıktan SONRA söylemek yerine burada söylüyoruz.
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Bu depo <b>varsayılan</b> depodur: deposu belirtilmeyen her giriş buraya yazılır.
              Pasife alınamaz — önce başka bir depoyu varsayılan yapın.
            </div>
          )}
          <FormField label="Depo Adı" htmlFor="name" error={form.formState.errors.name} required>
            <Input id="name" autoFocus placeholder="Merkez Depo, Şube Deposu..." {...form.register("name")} />
            {/* Mükerreri REDDETMEK yerine ÖNLEMEK — depo adı DB seddiyle
                tekildir (`warehouses_nameFold_key`), uyarı olmasa kullanıcı
                bunu ancak kaydederken ham hata olarak görürdü. */}
            <SimilarNamesWarning
              entity="warehouses"
              name={form.watch("name") ?? ""}
              excludeId={initial?.id}
            />
          </FormField>
          <FormField label="Adres" htmlFor="address" error={form.formState.errors.address}>
            <Input id="address" placeholder="(opsiyonel)" {...form.register("address")} />
          </FormField>
          <FormField label="Not" htmlFor="notes" error={form.formState.errors.notes}>
            <Textarea id="notes" rows={2} placeholder="(opsiyonel)" {...form.register("notes")} />
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
