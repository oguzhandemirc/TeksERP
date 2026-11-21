// "Desen kartını bas" — seçili kumaşın A4 desen kartı (ustaya giden kâğıt). HTML sunucuda üretilir
// (`/api/item-construction/:id/card-html`); basım tek boğazdan (`printTracked`), anlık iç belge (donmaz).
import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printTracked } from "@/lib/print";
import { constructionApi } from "./service";
import type { DesignFabric } from "./types";

export function WeaveCardPrintButton({ fabric }: { fabric: DesignFabric | null }) {
  const [busy, setBusy] = useState(false);
  const print = async () => {
    if (!fabric) return;
    setBusy(true);
    try {
      const html = await constructionApi.cardHtml(fabric.id);
      await printTracked({ subject: { kind: "DESEN_KARTI", no: fabric.code }, html });
    } catch {
      /* hata toast'ını apiClient gösterir */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" className="gap-1" disabled={!fabric || busy} onClick={() => void print()}
      title={fabric ? `${fabric.code} desen kartını A4 bas` : "Önce desene bağlı bir kumaş seçin"}>
      <Printer className="h-4 w-4" /> Desen kartını bas
    </Button>
  );
}
