/**
 * BU PAKETİN DAĞITIM KANALI — kimliğin kod içindeki TEK kaynağı.
 *
 * Değerler derleme ANINDA `deploy/kanallar.json`dan gelir (`build-channel.ts` → Vite sanal
 * modülü); bu dosya elle düzenlenecek bir değer taşımaz. Paketleme: `./deploy/electron-paketle.sh <kod>`.
 * Hangi değerin nerede kullanıldığı paketten okunarak doğrulanır (`scripts/kanal-kapisi.mjs panel-yayin`).
 */
export {
  code as CHANNEL_CODE,
  name as CHANNEL_NAME,
  label as CHANNEL_LABEL,
  appId as APP_ID,
  productName as PRODUCT_NAME,
  erpUrl as DEFAULT_ERP_URL,
  updateFeedUrl as UPDATE_FEED_URL,
  windowTitle as WINDOW_TITLE,
} from "virtual:tekserp-channel";
