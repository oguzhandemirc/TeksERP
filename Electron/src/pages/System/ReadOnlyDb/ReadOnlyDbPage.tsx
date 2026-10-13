import { useState } from "react";
import axios from "axios";
import { Copy, DatabaseZap, KeyRound, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";
import { safeFormat } from "@/lib/format";
import { useReadOnlyDb, useRotateReadOnlyDbPassword, type ReadOnlyDbStatus } from "./service";

/**
 * G5 — müşterinin BI aracı için yalnız-okuma veritabanı girişi (YALNIZ en yetkili hesap).
 * Parola hiçbir yerde saklanmaz: "göster" = yenile-ve-göster; yeni parola yalnız sonuç
 * penceresinin ömrü boyunca bellekte durur. Her yenileme audit'e (parolasız) yazılır.
 */
export function ReadOnlyDbPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useReadOnlyDb();
  const rotate = useRotateReadOnlyDbPassword();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [shown, setShown] = useState<{ role: string; password: string } | null>(null);
  const forbidden = axios.isAxiosError(error) && error.response?.status === 403;
  const rotateError = axios.isAxiosError(rotate.error)
    ? (rotate.error.response?.data as { message?: string } | undefined)?.message
    : undefined;

  const doRotate = () => {
    rotate.mutate(undefined, {
      onSuccess: (r) => {
        setConfirmOpen(false);
        setShown({ role: r.status.role ?? "", password: r.password });
      },
      // İstek suppressErrorToast taşır; hata toast'la değil sayfa şeridinde gösterilir.
      onError: () => setConfirmOpen(false),
    });
  };

  return (
    <PageShell>
      <PageHeader
        title="Veritabanı Okuma Erişimi"
        actions={
          <Button variant="ghost" size="icon" onClick={() => void refetch()} title="Yenile">
            <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        }
      />
      <PageBody className="space-y-5 p-6">
        <Callout tone="info" title="Kendi raporlama aracınız için">
          Power BI, Metabase, Excel gibi araçlar bu kullanıcıyla veritabanını <b>yalnız okuyabilir</b>; kayıt
          ekleyemez, değiştiremez, silemez. Parolalar, PIN/kart özetleri, iki adımlı giriş sırları ve sistem
          ayarları bu kullanıcıya kapalıdır. Kapalı kolon taşıyan tablolarda (ör. <code>users</code>){" "}
          <code>SELECT *</code> reddedilir; raporlama aracınızda kolonları tek tek seçin. Veritabanına elle yazma
          garanti kapsamı dışındadır.
        </Callout>
        {isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
        {forbidden && <Callout tone="warning">Bu ekran yalnız en yetkili hesaba (sistem yöneticisi) açıktır.</Callout>}
        {isError && !forbidden && <Callout tone="danger">Durum alınamadı.</Callout>}
        {rotate.isError && (
          <Callout tone="danger" title="Parola yenilenemedi">
            {rotateError ?? "Bağlantı koptuysa yeniden deneyin; eski parola geçersiz olmuş olabilir."}
          </Callout>
        )}
        {data && <StatusView status={data} onRotate={() => setConfirmOpen(true)} pending={rotate.isPending} />}
      </PageBody>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Parola yenilensin mi?"
        description={`Eski parola hemen geçersiz olur; raporlama aracınızdaki kayıtlı parolayı güncellemeniz gerekir${
          data ? ` (şu an açık bağlantı: ${data.activeConnections})` : ""
        }. Yeni parola yalnız bir kez gösterilir ve bu işlem kayda geçer.`}
        confirmLabel="Yenile ve göster"
        destructive
        onConfirm={doRotate}
        isPending={rotate.isPending}
      />
      <PasswordDialog shown={shown} onClose={() => setShown(null)} />
    </PageShell>
  );
}

function StatusView({ status, onRotate, pending }: { status: ReadOnlyDbStatus; onRotate: () => void; pending: boolean }) {
  if (status.state === "KURULUMDA_YOK") {
    return (
      <Callout tone="muted" title="Bu kurulumda kullanılamaz">
        Yalnız-okuma kullanıcısı, sunucu açılışındaki veritabanı rol ayrımıyla kurulur; bu adım şimdilik yalnız
        Docker kurulumunda var (Windows kurulumu için henüz yok). Bu kurulumda okuma kullanıcısı bulunmuyor.
      </Callout>
    );
  }
  if (status.state === "KAPALI") {
    return (
      <Callout tone="danger" title="Okuma kullanıcısı girişe kapalı">
        Açılıştaki denetim okuma kullanıcısının yetkilerini doğrulayamadı ve girişi güvenlik için kapattı. Sunucu
        yeniden başlatıldığında onarım yeniden denenir; sürerse destekle görüşün.
      </Callout>
    );
  }
  const rows: Array<[string, string]> = [
    ["Sunucu", status.host ?? "—"],
    ["Port", status.port !== null ? String(status.port) : "—"],
    ["Veritabanı", status.database],
    ["Kullanıcı", status.role ?? "—"],
    ["Parola", "Gösterilmez — yenilediğinizde bir kez gösterilir"],
    ["Son parola yenileme", status.passwordRotatedAt ? safeFormat(status.passwordRotatedAt, "dd.MM.yyyy HH:mm") : "Hiç (henüz bağlanılamaz)"],
    ["Açık bağlantı", `${status.activeConnections} / ${status.connectionLimit}`],
  ];
  return (
    <div className="space-y-4" data-testid="okuma-baglanti">
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b last:border-b-0">
                <td className="w-56 px-3 py-2 text-muted-foreground">{k}</td>
                <td className="px-3 py-2 font-mono">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Callout tone="warning" title="Ağ erişimi">
        {status.container
          ? "Bu kurulum Docker'da çalışıyor: veritabanı portu varsayılan olarak dışarı açık değildir ve bu ekran port açmaz. Yukarıdaki sunucu adı yalnız konteyner ağında geçerlidir; raporlama aracınızın bağlanması için BT ekibinizin güvenli bir yol (sunucu üzerinde yerel bağlantı ya da SSH tüneli) kurması gerekir."
          : "Yukarıdaki adres, sunucunun veritabanına bağlandığı adrestir. Başka bir bilgisayardan erişim BT ekibinizin ağ ayarına bağlıdır; bu ekran port açmaz."}
      </Callout>
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer">Bu kullanıcının okuyamadığı tablo ve kolonlar</summary>
        <ul className="mt-2 list-disc pl-5 font-mono text-xs">
          {status.hiddenTables.map((t) => (
            <li key={t}>{t} (tamamı)</li>
          ))}
          {Object.entries(status.hiddenColumns).map(([t, cols]) => (
            <li key={t}>
              {t}: {cols.join(", ")}
            </li>
          ))}
        </ul>
      </details>
      <Button onClick={onRotate} disabled={pending}>
        <KeyRound className="mr-2 h-4 w-4" /> Parolayı yenile ve göster
      </Button>
    </div>
  );
}

/** Tek seferlik sonuç: pencere kapanınca parola bellekten atılır. */
function PasswordDialog({ shown, onClose }: { shown: { role: string; password: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const close = () => {
    setCopied(false);
    onClose();
  };
  return (
    <Dialog open={shown !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DatabaseZap className="h-5 w-5" /> Yeni okuma parolası
          </DialogTitle>
          <DialogDescription>
            Parola yalnız şimdi gösterilir; bu pencere kapanınca bir daha gösterilemez. Raporlama aracınıza kaydedin.
          </DialogDescription>
        </DialogHeader>
        {shown && (
          <div className="space-y-3" data-testid="okuma-parola-sonuc">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="text-muted-foreground">Kullanıcı</div>
              <div className="font-mono">{shown.role}</div>
              <div className="mt-2 text-muted-foreground">Parola</div>
              <div className="break-all font-mono text-base" data-testid="okuma-parola">
                {shown.password}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copyText(shown.password).then(() => setCopied(true))}
            >
              <Copy className="mr-2 h-4 w-4" /> {copied ? "Kopyalandı" : "Parolayı kopyala"}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button type="button" onClick={close}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
