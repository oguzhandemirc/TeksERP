import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { DOCUMENT_TEMPLATE_DESIGN } from "@/lib/permissions";
import { CUSTOMER_INTERNAL_WARNING } from "../binding/contract";

interface Props {
  label: string | null;
  customerFacing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** İç alan/kolon açma onayı — müşteri belgesinde uyarı; yetki yoksa onay pasif. */
export function InternalConfirmDialog({ label, customerFacing, onCancel, onConfirm }: Props) {
  const canDesign = useRoleAccess().hasAnyPermission(DOCUMENT_TEMPLATE_DESIGN);
  return (
    <Dialog open={label !== null} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>İç alanı aç</DialogTitle>
          <DialogDescription>“{label}” iç alandır; açılınca şablonun iç alan listesine eklenir.</DialogDescription>
        </DialogHeader>
        {customerFacing && <Callout tone="warning" title="Müşteri belgesi">{CUSTOMER_INTERNAL_WARNING}</Callout>}
        {!canDesign && <p className="text-sm text-muted-foreground">İç alanı açmak için şablon tasarım yetkisi gerekir.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Vazgeç</Button>
          <Button disabled={!canDesign} onClick={onConfirm}>İç alanı aç</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
