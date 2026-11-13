// Patron bulutu alt listeleri: "Bulut hesapları" (Kilitle) · "Buluttan gelenler" (makbuzlar, salt okunur).
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ListBody, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { SettingsPasswordCancelled } from "@/lib/settings-password";
import { foldedIncludes } from "@/lib/search-fold";
import { useCloudAccountsTable } from "./accountColumns";
import { useInboxReceiptsTable } from "./receiptColumns";
import { patronCloudService, type CloudAccount, type PatronCloudStatus } from "./service";
import { RECEIPT_KIND_LABELS, RECEIPT_OUTCOME_LABELS, stamp } from "./labels";

type View = "hesaplar" | "gelenler";

// İki liste de durum yanıtının TAMAMIDIR (hesaplar buluttan gelen ayna, makbuzlar son 50) — cursor'lı liste değil;
// istemci süzmesi eksik sayfa göstermez. Her kelime ayrı aranır (AND), Türkçe katlamalı.
function matchesAll(parts: (string | null | undefined)[], search: string): boolean {
  const words = search.trim().split(/\s+/).filter(Boolean);
  const hay = parts.filter(Boolean).join(" ");
  return words.every((w) => foldedIncludes(hay, w));
}

function NoMatch() {
  return (
    <ListBody>
      <ListMessage>
        <EmptyState title="Eşleşen kayıt yok" description="Aramayı değiştirin ya da temizleyin." />
      </ListMessage>
    </ListBody>
  );
}

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
  const [search, setSearch] = useState("");
  const rows = useMemo(
    () => s.makbuzlar.filter((r) => matchesAll([r.hesapAdi, r.belgeNo, r.mesaj, r.kod, RECEIPT_KIND_LABELS[r.tur], RECEIPT_OUTCOME_LABELS[r.sonuc]], search)),
    [s.makbuzlar, search],
  );
  const table = useInboxReceiptsTable(rows);
  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-baseline gap-x-3">
        {switcher}
        <span className="text-xs text-muted-foreground">Son {s.makbuzlar.length} kayıt · en yeni önce</span>
        <div className="ml-auto flex items-center gap-1.5">
          <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Bulut hesabı, belge no ya da açıklama ara" />
          <DataTableTools table={table} compact exportName="Buluttan gelenler" />
        </div>
      </ListToolbar>
      {s.makbuzlar.length === 0 ? (
        <ListBody>
          <ListMessage>
            <EmptyState title="Buluttan gelen kayıt yok" description="Patron uygulamasından açılan sipariş ve cari kayıtları burada listelenir." />
          </ListMessage>
        </ListBody>
      ) : rows.length === 0 ? (
        <NoMatch />
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
  const [search, setSearch] = useState("");
  const rows = useMemo(() => s.hesaplar.filter((h) => matchesAll([h.ad, h.eposta], search)), [s.hesaplar, search]);
  const table = useCloudAccountsTable(rows, onLock, busy);

  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-baseline gap-x-3">
        {switcher}
        <span className="text-xs text-muted-foreground">Son alınma: {stamp(s.hesaplarAlinma)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Bulut hesabı adı ya da e-posta ara" />
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
      ) : rows.length === 0 ? (
        <NoMatch />
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
