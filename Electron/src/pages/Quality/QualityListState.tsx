// Kalite listelerinde tablo yokken gövde: yükleniyor / hata ("kayıt yok" sanılmaz) / boş süzgeç metni.
import { Button } from "@/components/ui/button";
import { ListMessage } from "@/components/layout/ListPage";

interface Props {
  isLoading: boolean;
  isError: boolean;
  /** Hata başlığı, ör. "Lab testleri yüklenemedi." */
  errorTitle: string;
  /** Hata açıklamasındaki "… yok" ifadesi, ör. "test yok". */
  noneText: string;
  emptyText: string;
  onRetry: () => void;
}

export function QualityListState({ isLoading, isError, errorTitle, noneText, emptyText, onRetry }: Props) {
  if (isLoading) return <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>;
  if (isError) {
    return (
      <ListMessage>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
          <p className="font-medium text-destructive">{errorTitle}</p>
          <p className="mt-1 text-muted-foreground">Bu bir “{noneText}” cevabı değildir — istek sunucuya ulaşamadı ya da reddedildi.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Tekrar dene</Button>
        </div>
      </ListMessage>
    );
  }
  return (
    <ListMessage>
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{emptyText}</div>
    </ListMessage>
  );
}
