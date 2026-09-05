import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { safeFormat } from "@/lib/format";
import { fmtBytes } from "../ServerStatus/serverHealth";
import { useDbCopies, useDropCopy, useVerifyCopy } from "./hooks";
import { StartCopyCard } from "./StartCopyCard";
import { CopyPhaseSteps } from "./CopyPhaseSteps";
import { CopiesTable } from "./CopiesTable";
import { VerificationReportView } from "./VerificationReportView";
import { SwapCommandDialog } from "./SwapCommandDialog";
import type { DbCopy, VerificationReport } from "./types";

/**
 * Veritabanı geri yükleme — kopyaya geri yükle, doğrula, takas et.
 *
 * Yerine-yazma akışından (Sistem → Yedekler) AYRI bir sayfa: orası "dosyalar",
 * burası "veritabanları + canlı bir iş + bakım penceresi". Ayrıca burada iş
 * koşarken 2 saniyede bir yoklama var; aynı sayfada olsa dosya listesini de
 * gereksiz yere tazelerdi.
 */
export function DbRestorePage() {
  const [params] = useSearchParams();
  const { data, isLoading, isError, refetch, isFetching } = useDbCopies();
  const verify = useVerifyCopy();
  const drop = useDropCopy();

  const [swapName, setSwapName] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DbCopy | null>(null);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);

  const job = data?.job ?? null;
  const last = data?.lastResult ?? null;
  const runningCopy = job ? data?.copies.find((c) => c.name === job.copyName) : undefined;

  function handleVerify(name: string) {
    setBusyName(name);
    verify.mutate(name, {
      onSuccess: (r) => {
        setReport(r);
        toast[r.ok ? "success" : "error"](
          r.ok ? "Doğrulama başarılı." : "Doğrulama BAŞARISIZ — ayrıntılar aşağıda.",
        );
      },
      onError: () => toast.error("Doğrulama çalıştırılamadı."),
      onSettled: () => setBusyName(null),
    });
  }

  function confirmDrop() {
    if (!dropTarget) return;
    const name = dropTarget.name;
    setBusyName(name);
    drop.mutate(
      { name, force: true },
      {
        onSuccess: (r) => {
          setDropTarget(null);
          toast[r.success ? "success" : "error"](r.message);
        },
        onError: (e: unknown) => {
          setDropTarget(null);
          const msg =
            (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            "Silinemedi.";
          toast.error(msg);
        },
        onSettled: () => setBusyName(null),
      },
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Veritabanı Geri Yükleme"
        actions={
          <Button variant="ghost" size="icon" onClick={() => void refetch()} title="Yenile">
            <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        }
      />

      <PageBody className="space-y-5 p-6">
        <Callout tone="info" title="Canlı veriye dokunulmaz">
          Yedek, canlı veritabanının <b>üzerine yazılmaz</b>; yeni bir veritabanına geri
          yüklenir ve doğrulanır. Beğenmezseniz kopyayı silersiniz, hiçbir şey kaybolmaz.
          Geçiş ayrı ve saniyeler süren bir adımdır — ve geri alınabilir.
          {data?.liveDatabase && (
            <>
              {" "}
              Canlı: <code className="font-mono text-xs">{data.liveDatabase}</code>
              {data.liveSizeBytes !== null && ` (${fmtBytes(data.liveSizeBytes)})`}
            </>
          )}
        </Callout>

        {isError && <Callout tone="danger">Kopya listesi alınamadı.</Callout>}
        {data?.error && <Callout tone="danger">{data.error}</Callout>}

        <StartCopyCard listing={data} presetBackup={params.get("backup")} />

        {job && (
          <Callout tone="muted" title={`Kopya oluşturuluyor: ${job.copyName}`}>
            <div className="mt-1">
              <CopyPhaseSteps
                job={job}
                copyBytes={runningCopy?.sizeBytes ?? null}
                liveBytes={data?.liveSizeBytes ?? null}
              />
            </div>
          </Callout>
        )}

        {!job && last && (
          <Callout
            tone={last.phase === "ready" ? "muted" : "danger"}
            title={`Son kopya işlemi — ${last.phase === "ready" ? "başarılı" : "BAŞARISIZ"}`}
          >
            <div>{last.message}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {last.finishedAt && safeFormat(last.finishedAt, "dd.MM.yyyy HH:mm")}
              {last.durationMs !== null && ` · ${Math.round(last.durationMs / 1000)} sn`}
            </div>
          </Callout>
        )}

        {report && <VerificationReportView report={report} />}

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
        ) : (
          <CopiesTable
            copies={data?.copies ?? []}
            busyName={busyName}
            onVerify={handleVerify}
            onDrop={setDropTarget}
            onSwap={setSwapName}
          />
        )}

        {data && data.oldDatabases.length > 0 && (
          <Callout tone="warning" title="Takas öncesi veritabanları — GERİ DÖNÜŞ NOKTASI">
            Bunlar geçişten önceki canlı veritabanlarınız. <b>Silmeyin</b> — bir sorun
            çıkarsa geri dönüş yolunuz bunlar. Panelden silinemezler; gerçekten
            gerekiyorsa sunucuda elle silin.
            <ul className="mt-1.5 space-y-0.5 font-mono text-xs">
              {data.oldDatabases.map((o) => (
                <li key={o.name}>
                  {o.name} · {o.sizeBytes === null ? "—" : fmtBytes(o.sizeBytes)}
                </li>
              ))}
            </ul>
          </Callout>
        )}
      </PageBody>

      <SwapCommandDialog
        copyName={swapName}
        liveDatabase={data?.liveDatabase ?? ""}
        onClose={() => setSwapName(null)}
      />

      <ConfirmDialog
        open={dropTarget !== null}
        onOpenChange={(o) => !o && setDropTarget(null)}
        title="Kopya silinsin mi?"
        description={
          `${dropTarget?.name} veritabanı kalıcı olarak silinecek.\n\n` +
          `Bu bir geri yükleme KOPYASIDIR — canlı veritabanınız etkilenmez.`
        }
        confirmLabel="Sil"
        destructive
        onConfirm={confirmDrop}
        isPending={drop.isPending}
      />
    </PageShell>
  );
}
