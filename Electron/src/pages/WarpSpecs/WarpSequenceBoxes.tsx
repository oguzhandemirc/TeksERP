// Çözgü kartı "Dizilim" notunun kutu şeridi düzenleyicisi: her kutu bir tel (rapor içinde), harf = iplik satırı
// sırası (A = 1. satır). Not alanıyla iki yönlü — kaydedilen değer yine metin notudur; tel tel açılım ve
// "teller tutuyor mu" uyarısı kayıttan sonra sunucunun `endsSequence`inden (Görünüm paneli) çizilir.
import { useFormContext, useWatch } from "react-hook-form";
import { InfoPopover } from "@/components/ui/info-popover";
import { SequenceBoxEditor } from "@/components/weave/SequenceBoxEditor";
import type { WarpSpecFormValues } from "./schema";

const INFO = "Her kutu çözgü dizimi raporundaki bir teldir; rengi ve harfi iplik satırıdır (A = 1. satır). Kutuya tıklamak ipliği sıradakine çevirir; "
  + "seçili kutu harf düğmeleriyle değişir, önüne/sonrasına eklenir ya da silinir. Kutular yukarıdaki Çözgü dizimi alanını yazar (ör. 2A 1B), "
  + "alan değişince kutular da değişir. Kaydedince Görünüm panelindeki tel düzeni ve tel tutma kontrolü sunucudan yeniden çizilir.";

export function WarpSequenceBoxes() {
  const { control, setValue } = useFormContext<WarpSpecFormValues>();
  const [note, yarns] = useWatch({ control, name: ["sequenceNote", "yarns"] });
  return (
    <section className="space-y-1.5 border-t pt-3" aria-label="Çözgü dizimi kutuları">
      <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Çözgü dizimi — kutularla
        <InfoPopover label="Kutularla çözgü dizimi" desc={INFO} />
      </h4>
      <SequenceBoxEditor value={note ?? ""} letterCount={yarns?.length ?? 0} defaultStyle="digit-first" unit="tel" label="Çözgü dizimi kutuları"
        onChange={(code) => setValue("sequenceNote", code, { shouldDirty: true, shouldValidate: true })} />
    </section>
  );
}
