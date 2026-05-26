import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { deviceService } from "./service";
import type { PairingCode } from "./types";

const schema = z.object({
  machineId: z.string().uuid("Makine seçilmeli"),
  deviceName: z.string().min(1, "Cihaz adı gerekli").max(80),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  /** Optional prefill — "Yeni Kod Üret" row action'ından gelen değerler. */
  defaults?: { machineId?: string; deviceName?: string };
}

export function PairingCodeDialog({ open, onOpenChange, onCreated, defaults }: Props) {
  const [generated, setGenerated] = useState<PairingCode | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { machineId: "", deviceName: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        machineId: defaults?.machineId ?? "",
        deviceName: defaults?.deviceName ?? "",
      });
      setGenerated(null);
      setCopied(false);
    }
  }, [open, form, defaults]);

  const mutation = useMutation({
    mutationFn: deviceService.createPairingCode,
    onSuccess: (res) => {
      setGenerated(res.data);
      onCreated();
    },
  });

  const onSubmit = (values: FormValues) => mutation.mutate(values);

  const copy = async () => {
    if (!generated) return;
    await navigator.clipboard.writeText(generated.code);
    setCopied(true);
    toast.success("Kod kopyalandı");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Yeni Eşleştirme Kodu</DialogTitle>
          <DialogDescription>
            Tablette "Cihaz Eşleştir" ekranına bu kodu girin. Kod 10 dakika geçerlidir.
          </DialogDescription>
        </DialogHeader>

        {!generated ? (
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField label="Makine" error={form.formState.errors.machineId} required>
              <Controller
                control={form.control}
                name="machineId"
                render={({ field }) => (
                  <ReferenceSelect<Machine>
                    value={field.value}
                    onChange={(v) => field.onChange(v ?? "")}
                    service={machineService}
                    queryKey="machines"
                    getLabel={(m) => `${m.code} — ${m.name}`}
                    placeholder="Makine seç..."
                  />
                )}
              />
            </FormField>
            <FormField label="Cihaz Adı" error={form.formState.errors.deviceName} required>
              <Input
                placeholder="örn: Tambur-1 Tablet"
                {...form.register("deviceName")}
              />
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                İptal
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Üretiliyor..." : "Kod Üret"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-6 text-center">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Eşleştirme Kodu
              </div>
              <div className="mt-2 font-mono text-5xl font-bold tracking-widest tabular-nums">
                {generated.code}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {new Date(generated.expiresAt).toLocaleString("tr-TR")} tarihine kadar geçerli
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={copy} className="gap-1.5">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Kopyalandı" : "Kopyala"}
              </Button>
              <Button onClick={() => onOpenChange(false)}>Kapat</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
