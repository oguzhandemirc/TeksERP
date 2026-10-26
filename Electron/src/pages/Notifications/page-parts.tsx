// Bildirimler sayfasının durum parçaları — kapalı / desteksiz / yükleniyor / boş ve özet şeridi.
import { BellOff, Check, Inbox, Loader2, ServerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SETTINGS_CATEGORIES, settingsCategoryPath } from "@/pages/GeneralSettings/settings-config";
import type { PageTab } from "./NotificationFilters";

// Bayrağın evi (N1-BAYRAK "Bildirimler" kategorisi); adres yüzey eşlemesinden türer, elle yazılmaz.
const INBOX_SETTINGS_CATEGORY = SETTINGS_CATEGORIES.find((c) => c.id === "bildirim");
export const INBOX_SETTINGS_PATH = INBOX_SETTINGS_CATEGORY ? settingsCategoryPath(INBOX_SETTINGS_CATEGORY) : "/system";

export function ClosedState({ yonetici, onAyar }: { yonetici: boolean; onAyar: () => void }) {
  return (
    <EmptyState
      icon={BellOff}
      title="Bildirimler kapalı"
      description="Kişisel bildirim gelen kutusu bu kurulumda kapalı — Genel Ayarlar'dan açılır."
      action={
        yonetici ? (
          <Button variant="outline" size="sm" onClick={onAyar}>
            Genel Ayarlar → Bildirimler
          </Button>
        ) : undefined
      }
    />
  );
}

export const UnsupportedState = () => (
  <EmptyState
    icon={ServerOff}
    title="Bu sunucu sürümü bildirimleri desteklemiyor"
    description="Sunucu güncellendiğinde bildirim gelen kutusu burada görünür."
  />
);

export const LoadingState = () => (
  <div className="flex justify-center py-16 text-muted-foreground">
    <Loader2 className="h-5 w-5 animate-spin" aria-label="Yükleniyor" />
  </div>
);

export const LoadErrorState = () => (
  <EmptyState icon={ServerOff} title="Bildirimler okunamadı" description="Bağlantıyı denetleyip yeniden deneyin." />
);

const EMPTY_TITLE: Record<PageTab, string> = {
  tumu: "Henüz bildirim yok",
  okunmamis: "Okunmamış bildirim yok",
  alarmlar: "Tezgah alarmı yok",
  ertelenen: "Ertelenen bildirim yok",
};
export const EmptyList = ({ sekme }: { sekme: PageTab }) => (
  <EmptyState icon={Inbox} title={EMPTY_TITLE[sekme]} description="Yeni bir şey olduğunda hem zilde hem burada görünür." />
);

/** Özet şeridi — sayı listeyle AYNI where'den (sunucu `sayi`); seçim varsa toplu eylem. */
export function SummaryStrip({ toplam, okunmamis, seciliSayi, topluAcik, onToplu }: {
  toplam: number;
  okunmamis: number;
  seciliSayi: number;
  topluAcik: boolean;
  onToplu: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm">
      <span>
        <span className="font-semibold tabular-nums">{toplam}</span> <span className="text-muted-foreground">kayıt</span>
      </span>
      <span>
        <span className="font-semibold tabular-nums text-primary">{okunmamis}</span>{" "}
        <span className="text-muted-foreground">okunmamış</span>
      </span>
      {seciliSayi > 0 && (
        <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <span className="text-muted-foreground">{seciliSayi} seçili</span>
          <Button size="sm" variant="outline" className="h-7 gap-1" disabled={!topluAcik} onClick={onToplu}>
            <Check className="h-3.5 w-3.5" /> Seçilenleri okundu say
          </Button>
        </span>
      )}
    </div>
  );
}
