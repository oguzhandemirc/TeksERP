import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CloudCog, Lock } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { SettingsPasswordCancelled } from "@/lib/settings-password";
import { patronCloudService, type CloudAccount, type PatronCloudStatus } from "./service";
import { ACCOUNT_STATE_LABELS, INELIGIBLE_LABELS, URL_SOURCE_LABELS, runOutcomeLabel, stamp } from "./labels";

const QUERY_KEY = ["patron-cloud-status"];

/**
 * Patron Bulutu — fabrika tarafı yüzey: bulut yazmalarının (sipariş + cari) aktörü olan TEKNİK KULLANICI
 * burada doğar; bulut hesapları listelenir ve AKTIF hesap buradan KİLİTLENEBİLİR (istek buluta imzalı gider;
 * hesap açma/kilit açma bulutta, fabrikanın bulut yöneticisinde).
 */
export function PatronCloudPage() {
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: patronCloudService.status, staleTime: 0, refetchOnMount: "always" });
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const s = q.data;

  const activate = async () => {
    setBusy(true);
    try {
      const r = await patronCloudService.activate();
      toast.success(r.message ?? "Patron bulutu etkinleştirildi.");
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (err) {
      if (!(err instanceof SettingsPasswordCancelled)) toast.error(apiErrorText(err, "Patron bulutu etkinleştirilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Patron Bulutu"
        description="Patronun uygulamasından gelen sipariş ve cari kayıtları bu fabrikada normal yoldan işlenir."
        actions={<RefreshButton queryKey={QUERY_KEY} successMessage="Patron bulutu durumu yenilendi" />}
      />
      <PageBody className="space-y-4 p-6">
        {q.isError && (
          <Callout tone="danger" icon={AlertTriangle} title="Durum alınamadı">
            {apiErrorText(q.error, "Sunucuya ulaşılamıyor. \"Yenile\" ile tekrar deneyin.")}
          </Callout>
        )}
        {s && <StatusSection s={s} busy={busy} onActivate={activate} />}
        {s && <AccountsSection s={s} onLocked={() => qc.invalidateQueries({ queryKey: QUERY_KEY })} />}
      </PageBody>
    </PageShell>
  );
}

function StatusSection({ s, busy, onActivate }: { s: PatronCloudStatus; busy: boolean; onActivate: () => void }) {
  const tk = s.teknikKullanici;
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <CloudCog className="h-4 w-4" /> Bulut yazma kullanıcısı
            <Badge variant={s.etkin ? "default" : "secondary"}>{s.etkin ? "Etkin" : "Etkin değil"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {tk
              ? `${tk.fullName} (${tk.username}) — giriş yöntemi yok; yalnız sipariş ve cari yazabilir.`
              : "Henüz yok. Etkinleştirince giriş yöntemi olmayan, yalnız sipariş ve cari yazabilen bir teknik kullanıcı oluşturulur."}
          </p>
        </div>
        {!s.etkin && (
          <Button onClick={onActivate} disabled={busy}>
            {busy ? "Etkinleştiriliyor…" : "Patron bulutunu etkinleştir"}
          </Button>
        )}
      </div>
      <ul className="space-y-1 text-sm">
        <li>
          <strong>Lisans ön koşulu:</strong>{" "}
          {s.uygunluk.ok ? "Sağlanıyor." : INELIGIBLE_LABELS[s.uygunluk.neden ?? "HAZIR_DEGIL"]}
        </li>
        <li>
          <strong>Bulut adresi:</strong> {URL_SOURCE_LABELS[s.adres]}
        </li>
        <li>
          <strong>Son gelen kutusu turu:</strong>{" "}
          {s.sonTur
            ? `${stamp(s.sonTur.at)} · ${runOutcomeLabel(s.sonTur.outcome)} · ${s.sonTur.processed} işlendi, ${s.sonTur.rejected} reddedildi${s.sonTur.uncertain ? `, ${s.sonTur.uncertain} yeniden denenecek` : ""}`
            : "Sunucu açıldığından beri tur yok."}
        </li>
      </ul>
    </section>
  );
}

function AccountsSection({ s, onLocked }: { s: PatronCloudStatus; onLocked: () => void }) {
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

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">Bulut hesapları</h2>
        <span className="text-xs text-muted-foreground">Son alınma: {stamp(s.hesaplarAlinma)}</span>
      </div>
      {s.hesaplar.length === 0 ? (
        <EmptyState
          title="Bulut hesabı yok"
          description="Liste bulutla eşitlemeden gelir; hesapları fabrikanın bulut yöneticisi bulutta açar."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ad</TableHead>
              <TableHead>E-posta</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Son giriş</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.hesaplar.map((h) => (
              <TableRow key={h.id}>
                <TableCell>{h.ad}</TableCell>
                <TableCell>{h.eposta ?? "—"}</TableCell>
                <TableCell>{ACCOUNT_STATE_LABELS[h.durum]}</TableCell>
                <TableCell>{stamp(h.sonGiris)}</TableCell>
                <TableCell className="text-right">
                  {h.durum === "AKTIF" && (
                    <Button size="sm" variant="outline" onClick={() => setTarget(h)} disabled={busy}>
                      <Lock className="mr-1 h-3.5 w-3.5" /> Kilitle
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) setTarget(null);
        }}
        title="Bulut hesabı kilitlensin mi?"
        description={
          target
            ? `${target.ad}${target.eposta ? ` (${target.eposta})` : ""} patron bulutunda kilitlenecek ve açık oturumları kapanacak. ` +
              "Kilidi yalnız fabrikanın bulut yöneticisi bulutta açabilir."
            : undefined
        }
        confirmLabel="Kilitle"
        cancelLabel="Vazgeç"
        destructive
        isPending={busy}
        onConfirm={() => (target ? lock(target) : undefined)}
      />
    </section>
  );
}
