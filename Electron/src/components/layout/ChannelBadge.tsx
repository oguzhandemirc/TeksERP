import { CHANNEL_LABEL, CHANNEL_NAME } from "@shared/channel";

/**
 * Hazırlık kanalının görünür işareti ("TEST FABRİKA") — pencerenin kendi başlığında
 * (`Topbar` · `LoginPage` · `BossShell`), pencere düğmelerinin yanında.
 *
 * ⚠️ NEDEN VAR: hazırlık kanalı gerçek fabrika verisinin KOPYASINA bağlanır ve ekranları
 * fabrikayla birebir aynıdır; işaret olmadan kullanıcı hangi programda olduğunu ayırt
 * edemez ve gerçek işi kopyaya girer. Etiket GÖSTERİMDİR, davranış değildir.
 *
 * Değer derleme anında kanal kaydından gelir (`deploy/kanallar.json` → `gorunurEtiket`);
 * üretim kanalında `null` → HİÇBİR ŞEY çizilmez, bugünkü görünüm birebir kalır.
 */
export function ChannelBadge() {
  if (!CHANNEL_LABEL) return null;
  return (
    <span
      data-channel-badge=""
      title={`${CHANNEL_NAME} — deneme kanalı. Burada gerçek iş girilmez.`}
      className="flex items-center rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400"
    >
      {CHANNEL_LABEL}
    </span>
  );
}
