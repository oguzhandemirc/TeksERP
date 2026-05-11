import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import { shipmentService } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateShipmentDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [driverName, setDriverName] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  const [plannedDate, setPlannedDate] = useState("");

  const reset = () => {
    setCustomerId(null);
    setBranchId(null);
    setDriverName("");
    setPlateNumber("");
    setCarrier("");
    setPlannedDate("");
  };

  const mutation = useMutation({
    mutationFn: () => {
      const driver = driverName.trim();
      const plate = plateNumber.trim();
      const carrierName = carrier.trim();
      return shipmentService.create({
        customerId: customerId!,
        branchId: branchId,
        ...(driver ? { driverName: driver } : {}),
        ...(plate ? { plateNumber: plate } : {}),
        ...(carrierName ? { carrier: carrierName } : {}),
        plannedDate: plannedDate ? new Date(plannedDate).toISOString() : null,
      });
    },
    onSuccess: (res) => {
      toast.success(`Sevkiyat oluşturuldu: ${res.data.shipmentNumber}`);
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      onOpenChange(false);
      reset();
      navigate(`/operations/shipments/${res.data.id}/edit`);
    },
  });

  const canSubmit = !!customerId && !mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni Sevkiyat</DialogTitle>
          <DialogDescription>
            Müşteri ve nakliye bilgilerini gir; sonraki adımda hazır topları seç ve onayla.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FormField label="Müşteri" required>
            <ReferenceSelect<Customer>
              value={customerId}
              onChange={(v) => {
                setCustomerId(v);
                setBranchId(null);
              }}
              service={customerService}
              queryKey="customers"
              getLabel={(c) => `${c.code} — ${c.name}`}
              placeholder="Müşteri seç..."
            />
          </FormField>

          <FormField label="Şube (opsiyonel)">
            <BranchSelect customerId={customerId} value={branchId} onChange={setBranchId} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Şoför">
              <Input
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Ahmet Yılmaz"
              />
            </FormField>
            <FormField label="Plaka">
              <Input
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder="34 ABC 123"
                className="font-mono"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Nakliyeci">
              <Input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="Hızlı Nakliyat"
              />
            </FormField>
            <FormField label="Planlı Sevk Tarihi">
              <Input
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
              />
            </FormField>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Oluşturuluyor..." : "Oluştur ve Devam Et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
