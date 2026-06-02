import { useState } from "react";
import { Server } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApiEndpointDialog } from "@/components/settings/ApiEndpointDialog";
import {
  DEFAULT_API_BASE_URL,
  getActiveApiBaseUrl,
  normalizeApiBaseUrl,
} from "@/lib/api-config";

/**
 * Backend (API) adresini uygulama içinden görüp düzenleme kartı.
 * Adres yereldir (bu bilgisayara özel); login ekranındaki dişli ile aynı
 * dialog'u kullanır.
 */
export function ApiEndpointCard() {
  const [open, setOpen] = useState(false);
  // Dialog kapanınca güncellenen, ekranda gösterilen aktif adres.
  const [active, setActive] = useState(getActiveApiBaseUrl);

  const isDefault = normalizeApiBaseUrl(active) === normalizeApiBaseUrl(DEFAULT_API_BASE_URL);

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Server className="h-4 w-4" />
          Sunucu Adresi
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4 p-5">
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
      </CardContent>

      <ApiEndpointDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setActive(getActiveApiBaseUrl());
        }}
      />
    </Card>
  );
}
