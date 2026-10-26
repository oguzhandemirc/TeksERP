// =============================================================================
// Ayarlar → Bildirim tercihleri (kişisel; N4-PANEL, plan §6.4)
// =============================================================================
// Liste = sunucunun döndüğü görülebilir türler (istemci görünürlük süzmez). Eski sunucu (uç 404) ya da
// kapalı bayrak → açıklama, çökme yok. Saatler fabrika diliminde.
// =============================================================================
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellOff, RotateCcw, ServerCrash, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { setScope } from "@/lib/bildirim/tercih-taslak";
import { NOTIFICATION_QUERY_KEY } from "@/lib/bildirim/hooks";
import { KindGroupList } from "./KindGroupList";
import { ScopeDialog } from "./ScopeDialog";
import { QuietHoursCard } from "./QuietHoursCard";
import { PreviewStrip } from "./PreviewStrip";
import { ResetDialog } from "./ResetDialog";
import { useNotificationSettingsForm } from "./useNotificationSettingsForm";

export function NotificationSettingsPage() {
  const f = useNotificationSettingsForm();
  const [kapsamKod, setKapsamKod] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const qc = useQueryClient();
  const scopeKind = kapsamKod ? (f.katalog?.turler.find((k) => k.kod === kapsamKod) ?? null) : null;

  let body;
  if (f.status === "kapali") {
    body = <EmptyState icon={BellOff} title="Bildirimler kapalı" description="Bildirim gelen kutusu bu fabrikada açık değil; yöneticiniz Genel Ayarlar'dan açar." />;
  } else if (f.status === "eski") {
    body = <EmptyState icon={ServerCrash} title="Sunucu bu ekranı henüz desteklemiyor" description="Sunucu güncellendiğinde bildirim tercihleri burada açılır." />;
  } else if (f.hata) {
    body = <EmptyState icon={ServerCrash} title="Tercihler okunamadı" description="Bağlantıyı kontrol edip sayfayı yenileyin." />;
  } else if (f.yukleniyor) {
    body = <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  } else {
    body = (
      <>
        <KindGroupList
          turler={f.katalog?.turler ?? []}
          taslak={f.taslak}
          setTaslak={f.setTaslak}
          yetkiDisi={f.katalog?.yetkiDisi ?? 0}
          onScope={setKapsamKod}
          grupToplu={f.grupToplu}
        />
        <PreviewStrip draft={f.taslak} kinds={f.katalog?.turler ?? []} />
        {f.ayarTaslak && <QuietHoursCard deger={f.ayarTaslak} onChange={f.setAyarTaslak} />}
      </>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Bildirim tercihleri"
        description="Hangi bildirimleri, hangi kanaldan alacağınızı seçin."
        actions={
          f.status === null && !f.hata ? (
            <>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setResetOpen(true)}>
                <RotateCcw className="h-4 w-4" /> Varsayılana dön…
              </Button>
              <Button size="sm" className="gap-1.5" disabled={!f.kirli || f.kaydediliyor} onClick={() => void f.kaydet()}>
                <Save className="h-4 w-4" /> Kaydet
              </Button>
            </>
          ) : undefined
        }
      />
      <PageBody className="space-y-4 p-4 md:p-6">{body}</PageBody>
      <ScopeDialog
        katalog={scopeKind}
        deger={kapsamKod ? (f.taslak[kapsamKod]?.kapsam ?? null) : null}
        onKapat={() => setKapsamKod(null)}
        onUygula={(s) => {
          if (kapsamKod) f.setTaslak((d) => setScope(d, kapsamKod, s));
          setKapsamKod(null);
        }}
      />
      <ResetDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onDone={() => {
          setResetOpen(false);
          void qc.invalidateQueries({ queryKey: NOTIFICATION_QUERY_KEY });
        }}
      />
    </PageShell>
  );
}
