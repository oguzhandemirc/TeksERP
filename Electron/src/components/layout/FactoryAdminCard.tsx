import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth";
import { FactoryAdminDialog } from "./FactoryAdminDialog";

/** Kart yalnız destek hesabında ve fabrika yöneticisi yokken görünür (ölçüt sunucuda). */
export function shouldShowFactoryAdminCard(s: {
  isSystemAccount: boolean;
  factoryAdminExists: boolean;
}): boolean {
  return s.isSystemAccount && !s.factoryAdminExists;
}

/**
 * "Fabrika yöneticisini aç" kartı — UYARIR, engellemez: panel kullanılmaya devam eder,
 * kart yönetici açılana dek her ekranın üstünde durur.
 */
export function FactoryAdminCard() {
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const factoryAdminExists = useAuthStore((s) => s.factoryAdminExists);
  const refresh = useAuthStore((s) => s.refreshSystemAccount);
  const [open, setOpen] = useState(false);
  const visible = shouldShowFactoryAdminCard({ isSystemAccount, factoryAdminExists });
  // Pencere açıkken kart kaybolsa bile pencere (ve içindeki tek seferlik parola) yaşar.
  if (!visible && !open) return null;
  return (
    <>
      {visible && (
        <div
          role="status"
          data-testid="fabrika-yoneticisi-karti"
          className="flex shrink-0 items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-foreground"
        >
          <UserPlus className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Fabrikanın kendi yönetici hesabı yok — destek hesabı günlük iş için kullanılmaz.
          </span>
          <Button size="sm" onClick={() => setOpen(true)}>
            Fabrika yöneticisini aç
          </Button>
        </div>
      )}
      <FactoryAdminDialog
        open={open}
        onClose={() => {
          setOpen(false);
          void refresh();
        }}
      />
    </>
  );
}
