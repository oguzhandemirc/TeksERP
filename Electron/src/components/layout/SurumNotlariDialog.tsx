import { useEffect, useState } from "react";
import { ArrowUpCircle, Sparkles, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SURUM_NOTLARI,
  damgalanacakId,
  gosterilecekYayinlar,
  tumYayinlar,
  type NotKapsam,
  type NotTip,
  type SurumNotuYayini,
} from "@/lib/surum-notlari";
import { SON_GORULEN_ANAHTAR, sonGorulenOku, sonGorulenYaz } from "@/lib/surum-notu-isaret";
import { useSurumNotuStore } from "@/store/surum-notu";

const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });

const TIP_GORUNUM: Record<NotTip, { ikon: typeof Sparkles; sinif: string; etiket: string }> = {
  yeni: { ikon: Sparkles, sinif: "text-success", etiket: "Yeni" },
  iyilestirme: { ikon: ArrowUpCircle, sinif: "text-info", etiket: "İyileştirme" },
  duzeltme: { ikon: Wrench, sinif: "text-warning", etiket: "Düzeltme" },
};

const KAPSAM_ETIKET: Record<NotKapsam, string> = {
  panel: "Panel",
  tablet: "Tablet",
  "her-ikisi": "Panel + Tablet",
};

/** Tarih kimliğini ("2026-08-28", "2026-08-28b") okunur başlığa çevirir. */
function tarihBasligi(id: string): string {
  const t = new Date(id.slice(0, 10));
  if (Number.isNaN(t.getTime())) return id;
  return dateFmt.format(t);
}

function YayinKarti({ yayin }: { yayin: SurumNotuYayini }) {
  const surumler = [
    yayin.surumler.panel ? `Panel ${yayin.surumler.panel}` : null,
    yayin.surumler.tablet ? `Tablet ${yayin.surumler.tablet}` : null,
  ].filter(Boolean) as string[];

  return (
    <section className="rounded-lg border border-border/60 bg-muted/20 p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{yayin.baslik}</h3>
          <p className="text-xs text-muted-foreground">{tarihBasligi(yayin.id)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {surumler.map((s) => (
            <Badge key={s} variant="outline" className="font-mono text-[10px]">
              {s}
            </Badge>
          ))}
        </div>
      </header>

      <ul className="space-y-2.5">
        {yayin.maddeler.map((m, i) => {
          const g = TIP_GORUNUM[m.tip];
          const Ikon = g.ikon;
          return (
            <li key={i} className="flex gap-2.5">
              <Ikon className={`mt-0.5 h-4 w-4 shrink-0 ${g.sinif}`} aria-label={g.etiket} />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{m.metin}</p>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {KAPSAM_ETIKET[m.kapsam]}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * "Neler değişti" penceresi — iki kiple çalışır (bkz. `useSurumNotuStore`).
 *
 * ⚠️ Bu bir ROUTE değil, dialog. Sebep: `system/*` route'larının hepsi
 * `admin:settings` istiyor ve `tile-route-permission.test.ts` karo↔route izin
 * hizasını mekanik kilitliyor. Herkese açık bir `system/*` sayfası o kuralı
 * delerdi; dialog izin yüzeyine hiç dokunmadan aynı işi görüyor
 * (`ShortcutsDialog` ile aynı desen).
 *
 * ⚠️ `z-[90]`: güncelleme kapısı (`UpdateGate`) `z-[100]` kullanıyor ve
 * AppShell onu açıkken bu pencereyi zaten render etmiyor — bu sınıf ikinci hat.
 */
export function SurumNotlariDialog({ kuruluSurum }: { kuruluSurum: string | null }) {
  const { acik, kip, kapat } = useSurumNotuStore();
  const [gosterilen, setGosterilen] = useState<{ liste: SurumNotuYayini[]; gizlenen: number }>({
    liste: [],
    gizlenen: 0,
  });

  useEffect(() => {
    if (!acik) return;
    if (kip === "tumu") {
      setGosterilen({ liste: tumYayinlar("panel"), gizlenen: 0 });
      return;
    }
    setGosterilen(gosterilecekYayinlar(SURUM_NOTLARI, sonGorulenOku(), kuruluSurum, "panel"));
  }, [acik, kip, kuruluSurum]);

  // Damga KAPANIŞTA yazılır, açılışta değil: açıkken çöken uygulama notu
  // tekrar göstersin (sessizce yutulmasındansa iki kez görünmesi iyidir).
  const kapatVeDamgala = () => {
    if (kip === "yeni") {
      const id = damgalanacakId(SURUM_NOTLARI, kuruluSurum, "panel");
      if (id) sonGorulenYaz(id);
    }
    kapat();
  };

  const bos = gosterilen.liste.length === 0;

  return (
    <Dialog open={acik} onOpenChange={(o) => !o && kapatVeDamgala()}>
      <DialogContent className="z-[90] flex h-[85vh] max-h-[85vh] max-w-2xl flex-col gap-3">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {kip === "yeni" ? "Bu güncellemede neler değişti" : "Sürüm notları"}
          </DialogTitle>
          <DialogDescription>
            {kip === "yeni"
              ? "Programın yeni sürümü kuruldu. Değişenler aşağıda."
              : `Kurulu sürüm ${kuruluSurum ?? "—"}. Geçmiş güncellemelerin tamamı.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {bos ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Gösterilecek sürüm notu yok.
            </p>
          ) : (
            gosterilen.liste.map((y) => <YayinKarti key={y.id} yayin={y} />)
          )}
          {gosterilen.gizlenen > 0 && (
            <p className="pb-1 text-center text-xs text-muted-foreground">
              …ve {gosterilen.gizlenen} eski not daha — Ayarlar → Sürüm Notları
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end">
          <Button onClick={kapatVeDamgala}>Tamam</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { SON_GORULEN_ANAHTAR };
