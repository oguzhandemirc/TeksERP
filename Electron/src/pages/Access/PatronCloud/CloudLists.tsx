// Patron bulutu alt listeleri: "Bulut hesapları" (Kilitle) · "Buluttan gelenler" (makbuzlar, salt okunur).
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ListBody, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { SettingsPasswordCancelled } from "@/lib/settings-password";
import { useCloudAccountsTable } from "./accountColumns";
import { useInboxReceiptsTable } from "./receiptColumns";
import { patronCloudService, type CloudAccount, type PatronCloudStatus } from "./service";
import { stamp } from "./labels";

type View = "hesaplar" | "gelenler";

export function CloudLists({ s, onLocked }: { s: PatronCloudStatus; onLocked: () => void }) {
  const [view, setView] = useState<View>("hesaplar");
  const switcher = (
    <div className="flex gap-1" role="tablist" aria-label="Liste">
      <Button size="sm" role="tab" aria-selected={view === "hesaplar"} variant={view === "hesaplar" ? "secondary" : "ghost"} onClick={() => setView("hesaplar")}>
        Bulut hesapları
      </Button>
      <Button size="sm" role="tab" aria-selected={view === "gelenler"} variant={view === "gelenler" ? "secondary" : "ghost"} onClick={() => setView("gelenler")}>
        Buluttan gelenler
      </Button>
    </div>
  );
  return view === "hesaplar" ? <AccountsSection s={s} onLocked={onLocked} switcher={switcher} /> : <ReceiptsSection s={s} switcher={switcher} />;
}

function ReceiptsSection({ s, switcher }: { s: PatronCloudStatus; switcher: ReactNode }) {
  const table = useInboxReceiptsTable(s.makbuzlar);
  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-baseline gap-x-3">
        {switcher}
        <span className="text-xs text-muted-foreground">Son {s.makbuzlar.length} kayıt · en yeni önce</span>
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Buluttan gelenler" />
        </div>
      </ListToolbar>
      {s.makbuzlar.length === 0 ? (
        <ListBody>
          <ListMessage>
            <EmptyState title="Buluttan gelen kayıt yok" description="Patron uygulamasından açılan sipariş ve cari kayıtları burada listelenir." />
          </ListMessage>
        </ListBody>
      ) : (
        <DataTable table={table} exportName="Buluttan gelenler" />
      )}
    </>
  );
}

function AccountsSection({ s, onLocked, switcher }: { s: PatronCloudStatus; onLocked: () => void; switcher: ReactNode }) {
  const attempt = useAttemptToken();
  const [target, setTarget] = useState<CloudAccount | null>(null);
  const [busy, setBusy] = useState(false);

  const lock = async (h: CloudAccount) => {
    setBusy(true);
    try {
      const r = await patronCloudService.lock(h.id, attempt.keyed(h.id));
      attempt.onSuccess();
      toast.success(r.message ?? "Bulut hesabı kilitlendi.");
      setTarget(null);
      onLocked();
    } catch (err) {
      if (err instanceof SettingsPasswordCancelled) return;
      attempt.onFailure(err);
      toast.error(apiErrorText(err, "Bulut hesabı kilitlenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const onLock = useCallback((h: CloudAccount) => setTarget(h), []);
  const table = useCloudAccountsTable(s.hesaplar, onLock, busy);

  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-baseline gap-x-3">
        {switcher}
        <span className="text-xs text-muted-foreground">Son alınma: {stamp(s.hesaplarAlinma)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Bulut hesapları" />
        </div>
      </ListToolbar>
      {s.hesaplar.length === 0 ? (
        <ListBody>
          <ListMessage>
            <EmptyState
              title="Bulut hesabı yok"
              description="Liste bulutla eşitlemeden gelir; hesapları fabrikanın bulut yöneticisi bulutta açar."
            />
          </ListMessage>
        </ListBody>
      ) : (
        <DataTable table={table} exportName="Bulut hesapları" />
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) setTarget(null);
        }}
        title="Bulut hesabı kilitlensin mi?"
        description={
          target
            ? `${target.ad}${target.eposta ? ` (${target.eposta})` : ""} yönetim bulutunda kilitlenecek ve açık oturumları kapanacak. ` +
              "Kilidi yalnız fabrikanın bulut yöneticisi bulutta açabilir."
            : undefined
        }
        confirmLabel="Kilitle"
        cancelLabel="Vazgeç"
        destructive
        isPending={busy}
        onConfirm={() => (target ? lock(target) : undefined)}
      />
    </>
  );
}
