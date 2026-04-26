import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, BookOpen, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { itemService } from "@/services/itemService";
import {
  customerVariantAliasService,
  type CustomerVariantAliasDto,
} from "@/services/customerVariantAliasService";

interface CustomerVariantAliasManagerProps {
  customerId: string;
}

export default function CustomerVariantAliasManager({
  customerId,
}: CustomerVariantAliasManagerProps) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [customerCode, setCustomerCode] = useState("");

  const listKey = ["customer", customerId, "variant-aliases"];

  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => customerVariantAliasService.list(customerId),
  });

  const { data: itemsData } = useQuery({
    queryKey: ["items", "all-active"],
    queryFn: () =>
      itemService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "code",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: adding,
  });

  const { data: variantsData } = useQuery({
    queryKey: ["items", selectedItemId, "variants"],
    queryFn: () => itemService.getVariants(selectedItemId),
    enabled: adding && !!selectedItemId,
  });

  const itemOptions = useMemo(
    () =>
      itemsData?.data?.map((i) => ({
        value: i.id,
        label: `${i.code} — ${i.name}`,
      })) ?? [],
    [itemsData],
  );

  const variantOptions = useMemo(
    () =>
      variantsData?.data?.map((v) => ({
        value: v.id,
        label: `${v.code} — ${v.name}`,
      })) ?? [],
    [variantsData],
  );

  const aliases = data?.data ?? [];
  const usedVariantIds = new Set(aliases.map((a) => a.variantId));
  const availableVariantOptions = variantOptions.filter(
    (v) => !usedVariantIds.has(v.value),
  );

  const resetForm = () => {
    setSelectedItemId("");
    setSelectedVariantId("");
    setCustomerLabel("");
    setCustomerCode("");
    setAdding(false);
    setEditingId(null);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      customerVariantAliasService.create(customerId, {
        variantId: selectedVariantId,
        customerLabel: customerLabel.trim(),
        customerCode: customerCode.trim() || null,
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Eklendi");
      qc.invalidateQueries({ queryKey: listKey });
      resetForm();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Ekleme başarısız";
      toast.error(msg);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (args: {
      id: string;
      customerLabel: string;
      customerCode: string | null;
    }) =>
      customerVariantAliasService.update(customerId, args.id, {
        customerLabel: args.customerLabel,
        customerCode: args.customerCode,
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Güncellendi");
      qc.invalidateQueries({ queryKey: listKey });
      resetForm();
    },
    onError: () => toast.error("Güncelleme başarısız"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      customerVariantAliasService.delete(customerId, id),
    onSuccess: (res) => {
      toast.success(res.message ?? "Silindi");
      qc.invalidateQueries({ queryKey: listKey });
    },
    onError: () => toast.error("Silme başarısız"),
  });

  const handleCreate = () => {
    if (!selectedVariantId) {
      toast.error("Varyant seçiniz");
      return;
    }
    if (!customerLabel.trim()) {
      toast.error("Müşteri adı zorunludur");
      return;
    }
    createMutation.mutate();
  };

  const startEdit = (a: CustomerVariantAliasDto) => {
    setEditingId(a.id);
    setCustomerLabel(a.customerLabel);
    setCustomerCode(a.customerCode ?? "");
    setAdding(false);
  };

  const handleUpdate = (id: string) => {
    if (!customerLabel.trim()) {
      toast.error("Müşteri adı zorunludur");
      return;
    }
    updateMutation.mutate({
      id,
      customerLabel: customerLabel.trim(),
      customerCode: customerCode.trim() || null,
    });
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          Desen Sözlüğü
          {aliases.length > 0 && (
            <Badge variant="secondary">{aliases.length}</Badge>
          )}
        </div>
        {!adding && !editingId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              setCustomerLabel("");
              setCustomerCode("");
              setSelectedItemId("");
              setSelectedVariantId("");
            }}
          >
            <Plus className="h-3 w-3 mr-1" />
            Ekle
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Bu müşteride farklı adla geçen desenler için karşılıklarını tanımlayın.
        Paket etiketinde bu isim basılır.
      </p>

      {/* Ekleme formu */}
      {adding && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="space-y-1">
            <Label>Ürün</Label>
            <Select
              options={itemOptions}
              value={selectedItemId}
              onChange={(e) => {
                setSelectedItemId(e.target.value);
                setSelectedVariantId("");
              }}
              placeholder="Ürün seçiniz..."
            />
          </div>
          <div className="space-y-1">
            <Label>Varyant (Desen)</Label>
            <Select
              options={availableVariantOptions}
              value={selectedVariantId}
              onChange={(e) => setSelectedVariantId(e.target.value)}
              placeholder={
                !selectedItemId
                  ? "Önce ürün seçiniz..."
                  : availableVariantOptions.length === 0
                    ? "Tüm varyantlar için kayıt var"
                    : "Varyant seçiniz..."
              }
              disabled={!selectedItemId || availableVariantOptions.length === 0}
            />
          </div>
          <div className="space-y-1">
            <Label>Müşterideki Adı *</Label>
            <Input
              value={customerLabel}
              onChange={(e) => setCustomerLabel(e.target.value)}
              placeholder="ör. Selop"
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label>Müşterideki Kod (opsiyonel)</Label>
            <Input
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
              placeholder="ör. SEL-01"
              maxLength={60}
            />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="ghost" onClick={resetForm}>
              İptal
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Ekleniyor..." : "Ekle"}
            </Button>
          </div>
        </div>
      )}

      {/* Liste */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Yükleniyor...
        </div>
      ) : aliases.length === 0 && !adding ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Henüz desen karşılığı tanımlanmamış.
        </div>
      ) : (
        <div className="space-y-1.5">
          {aliases.map((a) => {
            const isEditing = editingId === a.id;
            return (
              <div
                key={a.id}
                className="rounded-md border p-2 text-sm space-y-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground truncate">
                      {a.variant.item.code} · {a.variant.item.name}
                    </div>
                    <div className="font-medium truncate">
                      {a.variant.code} — {a.variant.name}
                    </div>
                  </div>
                  {!isEditing && (
                    <div className="flex gap-0.5 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => startEdit(a)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => {
                          if (
                            confirm(
                              `"${a.variant.code}" için kaydı silmek istediğinize emin misiniz?`,
                            )
                          ) {
                            deleteMutation.mutate(a.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2 pt-1">
                    <Input
                      value={customerLabel}
                      onChange={(e) => setCustomerLabel(e.target.value)}
                      placeholder="Müşterideki adı"
                      maxLength={120}
                    />
                    <Input
                      value={customerCode}
                      onChange={(e) => setCustomerCode(e.target.value)}
                      placeholder="Müşterideki kod (opsiyonel)"
                      maxLength={60}
                    />
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={resetForm}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="default"
                        className="h-7 w-7"
                        onClick={() => handleUpdate(a.id)}
                        disabled={updateMutation.isPending}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Müşteride:</span>
                    <span className="font-semibold">{a.customerLabel}</span>
                    {a.customerCode && (
                      <Badge variant="outline" className="font-mono text-xs">
                        {a.customerCode}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
