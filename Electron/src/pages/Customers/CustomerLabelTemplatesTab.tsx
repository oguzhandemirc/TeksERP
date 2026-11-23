// Cari kartı → Etiket Şablonları sekmesi (kompakt düzen 2026-11-24): her bölüm başlıklı kart, açıklamalar başlık
// yanındaki ⓘ balonunda; top setleri (Ham | Bitmiş) yan yana, diğer bölümler genişte iki sütun.
import type { ReactNode } from "react";
import { InfoPopover } from "@/components/ui/info-popover";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { CustomerTemplateRoutesPanel } from "./CustomerTemplateRoutesPanel";
import { CustomerTamburLabelSettings } from "./CustomerTamburLabelSettings";
import { CustomerStandaloneLabelsPanel } from "./CustomerStandaloneLabelsPanel";
import { CustomerConsigneesPanel } from "./consignees/CustomerConsigneesPanel";
import type { Customer } from "./types";

export function CustomerLabelTemplatesTab({ customer }: { customer: Customer }) {
  const emanetEnabled = useFeatureFlags().data?.data?.emanetEnabled ?? false;
  return (
    <div className="space-y-4">
      <LabelCard
        title="Rulo / kartela şablonları"
        info="Bu müşteri için basılan etiketlerde kullanılacak şablonlar. Atama; cihaz yönlendirmesinin ve genel varsayılanın önüne geçer. Boş bırakılan bağlamda genel varsayılan kullanılır. Top etiketinde Ham ya da Bitmiş şablonu topun aşamasına göre seçilir (yarı mamul top Ham etiketi basar)."
      >
        <CustomerTemplateRoutesPanel customerId={customer.id} />
      </LabelCard>
      <div className="grid gap-4 xl:grid-cols-2">
        <LabelCard title="Tambur / etiket">
          <CustomerTamburLabelSettings customer={customer} />
        </LabelCard>
        <LabelCard
          title="Serbest etiketler"
          info="İşaretlenmeyen serbest etiket genel kalır (tüm müşterilerde görünür). İşaretli etiketler Serbest Baskı ekranında bu müşteri seçilince — genel etiketlerle birlikte — listelenir."
        >
          <CustomerStandaloneLabelsPanel customerId={customer.id} />
        </LabelCard>
        {emanetEnabled && (
          <LabelCard
            title="Etiket alıcıları (emanet)"
            info="Emanet topun etiketinde “kimin için” basılan adlar. Tablette yazılınca burada belirir. Bir alıcıya şablon bağlarsan o alıcının etiketleri bu şablonla basılır (ör. İngilizce/ABD birimli şablon)."
          >
            <CustomerConsigneesPanel customerId={customer.id} />
          </LabelCard>
        )}
      </div>
    </div>
  );
}

/** Başlık şeridi (başlık + ⓘ) + gövde; Bilgiler sekmesindeki kartlarla aynı yüzey. */
export function LabelCard({ title, info, aside, children }: { title: string; info?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-card-border bg-card shadow-card" aria-label={title}>
      <header className="flex min-h-10 flex-wrap items-center gap-1.5 border-b px-4 py-1.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {info ? <InfoPopover label={`${title}: açıklama`} desc={info} /> : null}
        {aside ? <div className="ml-auto flex items-center gap-3">{aside}</div> : null}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}
