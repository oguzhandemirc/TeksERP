import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { LICENSE_DETAIL_KEY, LICENSE_STATUS_KEY } from "@/hooks/useLicenseStatus";
import { apiErrorText } from "@/lib/api-error";
import { copyText } from "@/lib/clipboard";
import { TEMP_CODE_GROUPS, checkTempGroups, tempGroupOfPosition } from "@/lib/license/temp-code";
import { licenseService } from "@/services/licenseService";
import { LicenseCard, day } from "./LicenseParts";
import { TempCodeInput } from "./TempCodeInput";

export const TEMP_REQUEST_KEY = ["license", "gecici-istek"] as const;
const emptyGroups = () => Array.from({ length: TEMP_CODE_GROUPS }, () => "");

/** Backend reddinin karakter konumu (`details.konum`, yalnız KARAKTER nedeninde). */
function rejectedPosition(err: unknown): number | null {
  const k = (err as { response?: { data?: { details?: { konum?: unknown } } } } | null)?.response?.data
    ?.details?.konum;
  return typeof k === "number" ? k : null;
}

/** Kod girişi + gönderme: yerel denetim, backend reddinin grubu ve iletisi tek yerde. */
function useTempCodeSubmit(onAccepted: () => Promise<unknown>) {
  const [groups, setGroups] = useState<string[]>(emptyGroups);
  const [serverGroup, setServerGroup] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = checkTempGroups(groups);
  // Eksik grup yazım sürerken kırmızı çizilmez (yalnız ileti); geçersiz karakter ve backend'in konumu çizilir.
  const localBad = !check.ok && check.kind === "KARAKTER" ? check.group : null;
  const errorGroups = new Set([localBad, serverGroup].filter((g): g is number => g !== null));

  const change = (g: string[]) => {
    setGroups(g);
    setServerGroup(null);
    setError(null);
  };

  const submit = async () => {
    if (!check.ok) return;
    setBusy(true);
    setError(null);
    setServerGroup(null);
    try {
      const v = await licenseService.submitTempCode(check.kod);
      setGroups(emptyGroups());
      toast.success(
        v.gecici
          ? `Program geçici olarak açıldı: ${day(v.gecici.bitis)} tarihine kadar.`
          : "Kod kabul edildi.",
      );
      await onAccepted();
    } catch (err) {
      const pos = rejectedPosition(err);
      setServerGroup(pos === null ? null : tempGroupOfPosition(pos));
      setError(apiErrorText(err, "Kod doğrulanamadı."));
    } finally {
      setBusy(false);
    }
  };

  return {
    groups,
    change,
    submit,
    busy,
    error,
    errorGroups,
    localBad,
    ok: check.ok,
    hint: check.ok ? null : check.message,
  };
}

/**
 * YAZARAK ETKİNLEŞTİRME: internet ve karekod yolu yokken. Ekrandaki istek kodu satıcıya okunur; verilen geçici açılış
 * kodu (23 grup) buraya yazılır. Geçici etkinlik süreyle sınırlıdır; tam etkinleştirme karekod/internet yolundan.
 */
export function TempCodeCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: TEMP_REQUEST_KEY, queryFn: licenseService.tempRequest, retry: false });
  const r = q.data;

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: TEMP_REQUEST_KEY }),
      qc.invalidateQueries({ queryKey: LICENSE_STATUS_KEY }),
      qc.invalidateQueries({ queryKey: LICENSE_DETAIL_KEY }),
    ]);
  const { groups, change, submit, busy, error, errorGroups, localBad, ok, hint } = useTempCodeSubmit(refresh);

  return (
    <LicenseCard title="Yazarak etkinleştir (internet ve karekod yoksa)">
      <p className="text-xs text-muted-foreground">
        Aşağıdaki istek kodunu satıcınıza ya da bayinize okuyun; verdikleri 23 gruplu geçici açılış kodunu
        yazın ya da yapıştırın. Program kodun süresi boyunca açılır; tam etkinleştirme yine karekod ya da
        internetle yapılır.
      </p>
      {q.isError && (
        <p className="text-xs text-destructive">{apiErrorText(q.error, "İstek kodu okunamadı.")}</p>
      )}
      {r && <TempRequestRow istekKodu={r.istekKodu} disabled={busy} onRenewed={refresh} />}
      {r?.gecici && (
        <p className="text-xs" data-testid="gecici-etkin-ozet">
          Şu an geçici açık: {day(r.gecici.bitis)} tarihine kadar ({r.gecici.kalanGun} gün, kod …
          {r.gecici.kodSonu}).
        </p>
      )}
      <TempCodeInput groups={groups} onChange={change} errorGroups={errorGroups} disabled={busy} />
      {(error ?? hint) && (
        <p
          className={
            error || localBad !== null ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
          role={error ? "alert" : undefined}
          data-testid="gecici-kod-hata"
        >
          {error ?? hint}
        </p>
      )}
      <div className="flex justify-end">
        <Button disabled={!ok || busy} onClick={() => void submit()}>
          Kodu gir
        </Button>
      </div>
    </LicenseCard>
  );
}

/** İstek kodu satırı: büyük punto, kopyala, onaylı yenile (eski koda verilen açılış kodu artık geçmez). */
function TempRequestRow({
  istekKodu,
  disabled,
  onRenewed,
}: {
  istekKodu: string;
  disabled: boolean;
  onRenewed: () => Promise<unknown>;
}) {
  const [confirmRenew, setConfirmRenew] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const renew = async () => {
    setRenewing(true);
    try {
      await licenseService.renewTempRequest();
      toast.success("İstek kodu yenilendi; eski koda verilen açılış kodu artık geçmez.");
      await onRenewed();
    } catch (err) {
      toast.error(apiErrorText(err, "İstek kodu yenilenemedi."));
    } finally {
      setRenewing(false);
      setConfirmRenew(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" data-testid="gecici-istek-kodu">
        <span className="select-all font-mono text-lg font-semibold tracking-wider">{istekKodu}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="İstek kodunu kopyala"
          onClick={() => void copyText(istekKodu).then(() => toast.success("İstek kodu kopyalandı."))}
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || renewing}
          onClick={() => setConfirmRenew(true)}
        >
          <RefreshCw className="mr-1 h-4 w-4" /> Yenile
        </Button>
      </div>
      <ConfirmDialog
        open={confirmRenew}
        onOpenChange={setConfirmRenew}
        title="İstek kodu yenilensin mi?"
        description="Eski istek koduna verilmiş açılış kodu artık geçmez; satıcıya yeni kodu okumanız gerekir."
        confirmLabel="Yenile"
        onConfirm={renew}
        isPending={renewing}
      />
    </>
  );
}
