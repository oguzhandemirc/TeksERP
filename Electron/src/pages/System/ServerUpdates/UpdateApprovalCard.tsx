import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { serverUpdateService } from "@/services/serverUpdateService";
import type { UpdateApprovalChoice, UpdateInterval, UpdatePolicyMode, UpdateStatus } from "@/types/server-update";
import { InfoRow, LicenseCard as UpdateCard, when } from "../License/LicenseParts";
import { SERVER_UPDATE_KEY } from "./hooks";

const TIMING_TEXT = { HEMEN: "Şimdi kur", PENCERE: "Bu gece kur" } as const;

interface ActionText {
  readonly button: string;
  readonly title: string;
  readonly description: string;
  readonly done: string;
}

/** Düğme + onay penceresi metinleri. Geri alma OTOMATİK kipte "pencereye bırak"tır, ONAYLI kipte onayı kaldırır. */
export function actionText(kind: UpdateApprovalChoice, surum: string, mode: UpdatePolicyMode | null, window: UpdateInterval | null): ActionText {
  if (kind === "HEMEN") {
    return {
      button: "Şimdi kur",
      title: `${surum} şimdi kurulsun mu?`,
      description:
        "Güncelleyici önce yedek alır, yeni sürümü kurar ve sağlığını denetler; sorun olursa eski sürüme kendiliğinden döner. " +
        "Kurulum sürerken panel ve tabletler sunucuya birkaç dakika bağlanamaz.",
      done: `Onay verildi: ${surum} bir dakika içinde kurulmaya başlar.`,
    };
  }
  if (kind === "PENCERE") {
    const at = window ? `${when(window.baslangic)} – ${when(window.bitis)}` : "sıradaki güncelleme penceresi";
    return {
      button: "Bu gece kur",
      title: `${surum} güncelleme penceresinde kurulsun mu?`,
      description: `Kurulum ${at} arasında kendiliğinden başlar; sorun olursa eski sürüme döner.`,
      done: `Onay verildi: ${surum} güncelleme penceresinde kurulacak.`,
    };
  }
  const auto = mode === "OTOMATIK";
  return {
    button: auto ? "Pencereye bırak" : "Onayı geri al",
    title: auto ? "Kurulum güncelleme penceresine bırakılsın mı?" : "Onay geri alınsın mı?",
    description: auto ? "Verilen onay kalkar; sürüm otomatik politikayla, güncelleme penceresinde kurulur." : "Verilen onay kalkar; sürüm yeniden onay bekler.",
    done: auto ? "Onay kaldırıldı: kurulum güncelleme penceresine bırakıldı." : "Onay geri alındı.",
  };
}

/** Tek karar düğmesi — kendi deneme token'ıyla (aynı karar ağ hatasından sonra yinelenirse aynı token). */
function ApprovalAction({ kind, surum, mode, window }: { kind: UpdateApprovalChoice; surum: string; mode: UpdatePolicyMode | null; window: UpdateInterval | null }) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [open, setOpen] = useState(false);
  const t = actionText(kind, surum, mode, window);
  const submit = async () => {
    try {
      const r = await serverUpdateService.approve({ clientToken: attempt.token(), surum, zamanlama: kind });
      attempt.onSuccess();
      setOpen(false);
      if (r.niyet.yazildi) toast.success(t.done);
      else toast.warning(`Karar kaydedildi ama güncelleyiciye henüz iletilemedi (${r.niyet.kod ?? "bilinmiyor"}); bir sonraki yoklamada yeniden denenir.`);
    } catch (err) {
      attempt.onFailure(err);
      toast.error(apiErrorText(err, "Güncelleme kararı kaydedilemedi."));
    } finally {
      await qc.invalidateQueries({ queryKey: SERVER_UPDATE_KEY });
    }
  };
  return (
    <>
      <Button size="sm" variant={kind === "GERI_AL" ? "outline" : kind === "HEMEN" ? "default" : "secondary"} onClick={() => setOpen(true)}>
        {t.button}
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={t.title} description={t.description} confirmLabel={t.button} onConfirm={submit} />
    </>
  );
}

/** Panel onayı (yalnız `license:manage`): ONAYLI kipte "Şimdi kur" / "Bu gece kur"; verilen onay geri alınabilir. */
export function UpdateApprovalCard({ s }: { s: UpdateStatus }) {
  const e = s.eylemler;
  const mode = s.politika?.kip ?? null;
  const any = e.hemen || e.pencere || e.geriAl;
  return (
    <UpdateCard title="Onay">
      {s.onay && (
        <InfoRow label="Verilen onay">
          {`${s.onay.surum} · ${TIMING_TEXT[s.onay.zamanlama]} · ${s.onay.onaylayan.ad} · ${when(s.onay.zaman)}${s.onay.kullanildi ? " (uygulandı)" : ""}`}
        </InfoRow>
      )}
      {e.neden && <p className="text-sm text-muted-foreground">{e.neden}</p>}
      {any && (
        <div className="flex flex-wrap gap-2 pt-1">
          {e.hemen && e.hedefSurum && <ApprovalAction kind="HEMEN" surum={e.hedefSurum} mode={mode} window={s.sonrakiPencere} />}
          {e.pencere && e.hedefSurum && <ApprovalAction kind="PENCERE" surum={e.hedefSurum} mode={mode} window={s.sonrakiPencere} />}
          {e.geriAl && s.onay && <ApprovalAction kind="GERI_AL" surum={s.onay.surum} mode={mode} window={s.sonrakiPencere} />}
        </div>
      )}
      {!any && !e.neden && <p className="text-sm text-muted-foreground">Şu an verilecek bir onay yok.</p>}
    </UpdateCard>
  );
}
