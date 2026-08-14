// =============================================================================
// HATA PANELİ — "veri yok" ile "veri GELMEDİ" ayrı şeylerdir
// =============================================================================
// ⚠️ BU AYRIM PARA EKRANINDA ZORUNLUDUR. İstek düştüğünde `data` `undefined`
// kalır; boş-durum metnini çizen bir sayfa o an "açık bakiyeli cari yok" /
// "hareketi olan hesap yok" der. İkisi de OLUMLU bir iddiadır ve YANLIŞTIR:
// kullanıcı "kimse bize borçlu değil" ya da "kasada hareket olmamış" diye okur,
// ekran ise sebebi hiçbir yerde itiraf etmez. Bu, boş ekrandan kötüdür —
// sessizce yanlış bir cevaptır.
//
// ⚠️ SEBEP TOAST'TAN OKUNAMAZ: `apiClient` 403'te backend gövdesini ATAR ve
// sabit "Bu işlem için yetkiniz bulunmuyor." basar. Oysa fabrika kurulumunda
// gerçek sebep `requireFinanceEnabled`'ın döndüğü "Ön muhasebe modülü bu
// kurulumda kapalı" cümlesidir ve o cümle YALNIZ hata gövdesinde yaşar
// (`reportErrorText` onu oradan çıkarır). Üstelik toast birkaç saniyede kaybolur;
// ekranda kalan tek metin budur.
//
// ⚠️ "Tekrar dene" düğmesi opsiyoneldir ve yalnız çağıran gerçekten yeniden
// deneyebiliyorsa verilir. Hiçbir şey yapmayan bir düğme, hata ekranındaki en
// kötü şeydir.
// =============================================================================

import { AlertOctagon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportErrorText } from "./service";

interface Props {
  error: unknown;
  /** Verilirse "Tekrar dene" çıkar (react-query `refetch`). */
  onRetry?: () => void;
}

export function ReportErrorCard({ error, onRetry }: Props) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-destructive">Rapor yüklenemedi</p>
        {/* Backend'in kendi cümlesi — burada YENİDEN YAZILMAZ. */}
        <p className="mt-1 text-muted-foreground">{reportErrorText(error)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Aşağıda rakam gösterilmiyor çünkü veri gelmedi — bu <strong>“kayıt yok”</strong> anlamına
          GELMEZ.
        </p>
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" className="mt-3 h-7 px-2 text-xs" onClick={onRetry}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Tekrar dene
          </Button>
        ) : null}
      </div>
    </div>
  );
}
