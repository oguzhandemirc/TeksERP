import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { apiErrorText } from "@/lib/api-error";
import { safeFormat } from "@/lib/format";
import { SettingsPasswordCancelled } from "@/lib/settings-password";
import { errorReportService } from "@/services/errorReportService";
import { ERROR_SOURCE_LABEL, type ErrorReportConsent, type ErrorReportRow } from "./error-report-types";

export const ERROR_REPORTS_KEY = ["hata-raporlari"] as const;
const formatDateTime = (iso: string | null): string => safeFormat(iso, "dd.MM.yyyy HH:mm");

/** Onayın kim/ne zaman satırı. */
export function consentMeta(o: ErrorReportConsent): string {
  if (!o.degisimZamani) return "Henüz karar verilmedi — varsayılan KAPALI.";
  return `${o.acik ? "Açan" : "Kapatan"}: ${o.degistiren?.fullName ?? "—"} · ${formatDateTime(o.degisimZamani)}`;
}

/** Grup satırı: ne gönderildi/gidecek — tür, yer, sürüm, sayı; mesaj metni hiç yoktur. */
export function rowMeta(r: ErrorReportRow): string {
  const parts = [ERROR_SOURCE_LABEL[r.source], r.version, `${r.count} kez`, `son ${formatDateTime(r.lastAt)}`];
  if (!r.sentAt && r.lastErrorCode) parts.push(`son deneme: ${r.lastErrorCode}`);
  return parts.join(" · ");
}

/**
 * HATA RAPORLARI (3.6) — müşteri onayı (ayar şifreli) ve şeffaflık listesi. Onay yoksa hiçbir şey toplanmaz;
 * açıkken kişisel veri içermeyen hata özetleri (tür, yer, sürüm) satıcıya gider. Yalnız `admin:settings`.
 */
export function ErrorReportsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ERROR_REPORTS_KEY, queryFn: errorReportService.overview, refetchInterval: 60_000 });
  const m = useMutation({
    mutationFn: (acik: boolean) => errorReportService.setConsent(acik),
    onSuccess: (r) => {
      if (r.message) toast.success(r.message);
      void qc.invalidateQueries({ queryKey: ERROR_REPORTS_KEY });
    },
    onError: (err) => {
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istek `suppressErrorToast` taşır; ret burada tek tost
      if (!(err instanceof SettingsPasswordCancelled)) toast.error(apiErrorText(err, "Hata raporu onayı değiştirilemedi."));
    },
  });
  const d = q.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>Hata raporları</span>
          {d ? (
            <Switch aria-label="Hata raporlarını gönder" checked={d.onay.acik} disabled={m.isPending} onCheckedChange={(next) => m.mutate(next)} />
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Açıkken programdaki hataların yalnız türü, yeri ve sürümü satıcıya gönderilir. Hata mesajı, kullanıcı adı, müşteri ya da sipariş bilgisi GÖNDERİLMEZ.
        </p>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Yükleniyor…</p> : null}
        {d ? (
          <>
            <p className="text-xs text-muted-foreground">{consentMeta(d.onay)}</p>
            <p className="text-xs text-muted-foreground">
              Bekleyen: {d.bekleyen} · Gönderilen: {d.gonderilen}
            </p>
            {d.kayitlar.map((r) => (
              <div key={r.id} className="rounded border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {r.code} · {r.errorClass} · {r.routeTemplate ?? r.component}
                  </span>
                  <Badge variant={r.sentAt ? "secondary" : "outline"}>{r.sentAt ? "Gönderildi" : "Bekliyor"}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{rowMeta(r)}</div>
              </div>
            ))}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
