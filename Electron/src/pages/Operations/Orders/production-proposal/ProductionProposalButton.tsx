// Sipariş detayındaki "Üretime gönder" düğmesi (SY-M3). Ayar KAPALI / modül kapalı / yazma izni yoksa ÇİZİLMEZ.
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Order } from "../types";
import { useProposalGates } from "./gates";
import { ProductionProposalDialog } from "./ProductionProposalDialog";

export function ProductionProposalButton({ order }: { order: Order }) {
  const { buttonVisible } = useProposalGates();
  const [open, setOpen] = useState(false);
  if (!buttonVisible || (order.status !== "APPROVED" && order.status !== "PARTIAL_SHIPPED")) return null;
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Send className="h-3.5 w-3.5" /> Üretime gönder
      </Button>
      {open && <ProductionProposalDialog open={open} onOpenChange={setOpen} orderId={order.id} orderNumber={order.orderNumber} lines={order.lines} />}
    </>
  );
}
