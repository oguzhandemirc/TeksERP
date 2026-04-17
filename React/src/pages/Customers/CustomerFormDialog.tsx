import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import type { Customer } from "@/types/models";
import { CompanyType, companyTypeLabels } from "@/types/enums";

const customerSchema = z.object({
  code: z.string().min(1, "Kod zorunludur"),
  name: z.string().min(1, "İsim zorunludur"),
  taxNumber: z.string().optional(),
  type: z.nativeEnum(CompanyType, { message: "Tür seçiniz" }),
});

type CustomerFormValues = z.infer<typeof customerSchema>;

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  onSubmit: (data: CustomerFormValues) => void;
  isLoading: boolean;
}

const companyTypeOptions = Object.entries(companyTypeLabels).map(
  ([value, label]) => ({ value, label }),
);

export default function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
  onSubmit,
  isLoading,
}: CustomerFormDialogProps) {
  const isEdit = !!customer;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      code: "",
      name: "",
      taxNumber: "",
      type: CompanyType.CUSTOMER,
    },
  });

  useEffect(() => {
    if (open) {
      reset(
        customer
          ? {
              code: customer.code,
              name: customer.name,
              taxNumber: customer.taxNumber ?? "",
              type: customer.type,
            }
          : { code: "", name: "", taxNumber: "", type: CompanyType.CUSTOMER },
      );
    }
  }, [open, customer, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Müşteri Düzenle" : "Yeni Müşteri"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code" error={!!errors.code}>Kod</Label>
            <Input
              id="code"
              {...register("code")}
              error={!!errors.code}
              placeholder="ör: MUS-010"
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
              placeholder="ör: Yeni Tekstil Ltd."
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="taxNumber">Vergi No</Label>
            <Input
              id="taxNumber"
              {...register("taxNumber")}
              placeholder="ör: 1234567890"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type" error={!!errors.type}>Tür</Label>
            <Select
              id="type"
              {...register("type")}
              options={companyTypeOptions}
            />
            {errors.type && (
              <p className="text-sm text-destructive">{errors.type.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              İptal
            </Button>
            <Button type="submit" isLoading={isLoading}>
              {isEdit ? "Güncelle" : "Oluştur"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
