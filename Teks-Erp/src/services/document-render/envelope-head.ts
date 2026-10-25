import { NUMBER_ROUNDING_HALF_UP } from "./fmt-num";

/** Her yeni zarfın başı — damganın TEK yazıldığı yer (sözleşme senaryoları da buradan alır).
 *  Yaprak modül: sözleşme senaryoları printed-document.service'i çekerse basım bağı üzerinden değer döngüsü doğar. */
export const envelopeHead = () =>
  ({ schemaVersion: 1, frozenAt: new Date().toISOString(), numberRounding: NUMBER_ROUNDING_HALF_UP }) as const;
