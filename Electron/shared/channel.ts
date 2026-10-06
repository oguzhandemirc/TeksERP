/**
 * BU PAKETİN DAĞITIM KİMLİĞİ — kimliğin kod içindeki TEK kaynağı.
 *
 * Değerler derleme ANINDA kayıttan gelir (`build-identity.ts` → Vite sanal modülü): varsayılan tek ortak
 * kimlik (dağıtım kaydı), eski kanal yolunda (`TEKSERP_KANAL`) `deploy/kanallar.json`. Bu dosya elle
 * düzenlenecek bir değer taşımaz. Paketleme: `./deploy/electron-paketle.sh [sürüm]` (ortak).
 * Hangi değerin pakete gömüldüğü paketten okunarak doğrulanır (`scripts/panel-kimlik-kapisi.mjs paket`).
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
  groupFeeds as UPDATE_GROUP_FEEDS,
} from "virtual:tekserp-channel";
