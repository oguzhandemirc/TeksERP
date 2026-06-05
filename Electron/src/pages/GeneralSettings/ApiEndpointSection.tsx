import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiEndpointDialog } from "@/components/settings/ApiEndpointDialog";
import {
  DEFAULT_API_BASE_URL,
  getActiveApiBaseUrl,
  normalizeApiBaseUrl,
} from "@/lib/api-config";

/**
 * Backend (API) adresini uygulama içinden görüp düzenleme bölümü. Adres yereldir
 * (bu bilgisayara özel); login ekranındaki dişli ile aynı dialog'u kullanır.
 */
export function ApiEndpointSection() {
  const [open, setOpen] = useState(false);
  // Dialog kapanınca güncellenen, ekranda gösterilen aktif adres.
  const [active, setActive] = useState(getActiveApiBaseUrl);

  const isDefault =
    normalizeApiBaseUrl(active) === normalizeApiBaseUrl(DEFAULT_API_BASE_URL);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1 text-sm">
        <div className="font-mono">{active}</div>
        <p className="text-xs text-muted-foreground">
          Uygulamanın bağlandığı backend adresi. Bu bilgisayara özeldir.
          {isDefault ? " (varsayılan)" : " (özel)"}
        </p>
      </div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Düzenle
      </Button>

      <ApiEndpointDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setActive(getActiveApiBaseUrl());
        }}
      />
    </div>
  );
}
