import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import type { Item } from "@/types/models";
import { ItemType, itemTypeLabels } from "@/types/enums";
import { itemService } from "@/services/itemService";

const itemSchema = z.object({
  code: z.string().min(1, "Kod zorunludur"),
  name: z.string().min(1, "İsim zorunludur"),
  itemType: z.nativeEnum(ItemType, { message: "Tür seçiniz" }),
  unit: z.string().min(1, "Birim zorunludur"),
});

type ItemFormValues = z.infer<typeof itemSchema>;

interface VariantEntry {
  id?: string;
  code: string;
  name: string;
}

interface ItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Item | null;
  onSubmit: (data: ItemFormValues) => Promise<{ id: string } | undefined>;
  isLoading: boolean;
}

const itemTypeOptions = Object.entries(itemTypeLabels).map(([value, label]) => ({
  value,
  label,
}));

export default function ItemFormDialog({
  open,
  onOpenChange,
  item,
  onSubmit,
  isLoading,
}: ItemFormDialogProps) {
  const isEdit = !!item;

  const [variants, setVariants] = useState<VariantEntry[]>([]);
  const [newVariantCode, setNewVariantCode] = useState("");
  const [newVariantName, setNewVariantName] = useState("");
  const [savingVariants, setSavingVariants] = useState(false);
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      code: "",
      name: "",
      itemType: ItemType.YARN,
      unit: "MT",
    },
  });

  // Load variants when editing
  useEffect(() => {
    if (open && item) {
      itemService.getVariants(item.id).then((res) => {
        if (res.success && res.data) {
          setVariants(res.data);
        }
      });
    } else if (open && !item) {
      setVariants([]);
    }
  }, [open, item]);

  useEffect(() => {
    if (open) {
      reset(
        item
          ? { code: item.code, name: item.name, itemType: item.itemType, unit: item.unit }
          : { code: "", name: "", itemType: ItemType.YARN, unit: "MT" },
      );
      setNewVariantCode("");
      setNewVariantName("");
      setDeletedVariantIds([]);
    }
  }, [open, item, reset]);

  const addVariant = () => {
    if (!newVariantCode.trim() || !newVariantName.trim()) return;
    setVariants((prev) => [...prev, { code: newVariantCode.trim(), name: newVariantName.trim() }]);
    setNewVariantCode("");
    setNewVariantName("");
  };

  const removeVariant = (index: number) => {
    const variantToRemove = variants[index];
    if (variantToRemove.id) {
      setDeletedVariantIds((prev) => [...prev, variantToRemove.id!]);
    }
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  // Save/Delete variants to API for a given itemId
  const saveVariants = async (itemId: string, pendingVariant?: { code: string; name: string } | null) => {
    let newVariants = variants.filter((v) => !v.id);
    if (pendingVariant) {
      newVariants.push(pendingVariant);
    }
    
    if (newVariants.length === 0 && deletedVariantIds.length === 0) return;

    setSavingVariants(true);
    try {
      for (const v of newVariants) {
        await itemService.createVariant(itemId, { code: v.code, name: v.name });
      }
      // Silme
      for (const vId of deletedVariantIds) {
        await itemService.deleteVariant(itemId, vId);
      }
      toast.success("Varyantlar güncellendi");
    } catch (error) {
      toast.error("Varyantlar güncellenirken hata oluştu");
    } finally {
      setSavingVariants(false);
    }
  };

  const handleFormSubmit = async (data: ItemFormValues) => {
    try {
      // Eğer kullanıcı variant adını/kodunu yazıp '+' tuşuna basmayı unuttuysa otomatik yakala
      let currentNewCode = newVariantCode.trim();
      let currentNewName = newVariantName.trim();
      let pendingVariant = null;

      if (currentNewCode && currentNewName) {
        pendingVariant = { code: currentNewCode, name: currentNewName };
      }

      const result = await onSubmit(data);
      if (result?.id) {
        await saveVariants(result.id, pendingVariant);
        onOpenChange(false);
      }
    } catch (error) {
      // Error handled by parent
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Stok Kartı Düzenle" : "Yeni Stok Kartı"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code" error={!!errors.code}>Kod</Label>
            <Input
              id="code"
              {...register("code")}
              error={!!errors.code}
              placeholder="ör: MAM-010"
              disabled={isEdit}
            />
            {errors.code && (
              <p className="text-sm text-destructive">{errors.code.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name" error={!!errors.name}>İsim</Label>
            <Input
              id="name"
              {...register("name")}
              error={!!errors.name}
              placeholder="ör: Boyalı Saten Kumaş"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="itemType" error={!!errors.itemType}>Tür</Label>
            <Select
              id="itemType"
              {...register("itemType")}
              options={itemTypeOptions}
              disabled={isEdit}
            />
            {errors.itemType && (
              <p className="text-sm text-destructive">{errors.itemType.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit" error={!!errors.unit}>Birim</Label>
            <Input
              id="unit"
              {...register("unit")}
              error={!!errors.unit}
              placeholder="ör: MT, KG, AD"
            />
            {errors.unit && (
              <p className="text-sm text-destructive">{errors.unit.message}</p>
            )}
          </div>

          {/* Variants Section */}
          <div className="space-y-3 pt-3 border-t">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Desen / Varyantlar</Label>
              <Badge variant="outline">{variants.length} adet</Badge>
            </div>

            {/* Existing Variants */}
            {variants.length > 0 && (
              <div className="space-y-2">
                {variants.map((v, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{v.code}</div>
                      <div className="text-xs text-muted-foreground truncate">{v.name}</div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => removeVariant(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add New Variant */}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Input
                  value={newVariantCode}
                  onChange={(e) => setNewVariantCode(e.target.value.toUpperCase())}
                  placeholder="Kod: BALIK_SIRTA"
                  className="text-sm h-9"
                />
              </div>
              <div className="flex-1 space-y-1">
                <Input
                  value={newVariantName}
                  onChange={(e) => setNewVariantName(e.target.value)}
                  placeholder="Ad: Balık Sırta"
                  className="text-sm h-9"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addVariant}
                disabled={!newVariantCode.trim() || !newVariantName.trim()}
                className="h-9"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Varyantlar bu stok kartına ait desen/desenlerdir. KK1 girişinde seçilebilir.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              İptal
            </Button>
            <Button type="submit" isLoading={isLoading || savingVariants}>
              {isEdit ? "Güncelle" : "Oluştur"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
