import type { SystemLogDomainAction } from "@/types/systemLog";

/** Backend `tableName` → planlamacının anladığı Türkçe modül adı. */
export const tableLabels: Record<string, string> = {
  USER: "Kullanıcı",
  ITEM: "Stok Kalemi",
  CUSTOMER: "Müşteri",
  CUSTOMER_BRANCH: "Müşteri Şubesi",
  CUSTOMER_ITEM_ALIAS: "Müşteri Ürün Kodu",
  CUSTOMER_COLOR_ALIAS: "Müşteri Renk Kodu",
  STATION: "İstasyon",
  MACHINE: "Makine",
  ROUTE: "Rota",
  COLOR: "Renk",
  FABRIC_PROPERTY: "Kumaş Özelliği",
  QUALITY_GRADE: "Kalite Sınıfı",
  DEFECT_TYPE: "Hata Tipi",
  ORDER: "Sipariş",
  ORDER_LINE: "Sipariş Satırı",
  WORK_ORDER: "İş Emri",
  WORK_ORDER_STEP: "İş Emri Adımı",
  ROLL: "Top",
  ROLL_MOVEMENT: "Top Hareketi",
  ROLL_OPERATION: "Top İşlemi",
  ROLL_ERROR: "Top Hatası",
  SHIPMENT: "Sevkiyat",
  SHIPMENT_LINE: "Sevkiyat Satırı",
  TRAVELER_CARD: "Refakat Kartı",
  SUBCONTRACTOR: "Fasoncu",
  SUBCONTRACTOR_CATEGORY: "Fason Kategorisi",
  SUBCONTRACTOR_DISPATCH: "Fason Sevk",
  SUBCONTRACTOR_RECEIPT: "Fason Kabul",
  LABEL_TEMPLATE: "Etiket Şablonu",
  SYSTEM_SETTING: "Sistem Ayarı",
  PERMISSION: "Yetki",
  PERMISSION_TEMPLATE: "Yetki Şablonu",
  USER_PERMISSION: "Kullanıcı Yetkisi",
  STATION_CAPABILITY: "İstasyon Yeteneği",
};

export const actionLabels: Record<SystemLogDomainAction, string> = {
  CREATE: "oluşturdu",
  UPDATE: "düzenledi",
  DELETE: "sildi",
};

export const actionVariants: Record<
  SystemLogDomainAction,
  "default" | "secondary" | "destructive"
> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
};

export function tableLabel(name: string): string {
  return tableLabels[name] ?? name;
}

const DOMAIN_ACTIONS: SystemLogDomainAction[] = ["CREATE", "UPDATE", "DELETE"];

function isDomainAction(action: string): action is SystemLogDomainAction {
  return (DOMAIN_ACTIONS as string[]).includes(action);
}

export function actionLabel(action: string): string {
  return isDomainAction(action) ? actionLabels[action] : action;
}

export function actionVariant(
  action: string,
): "default" | "secondary" | "destructive" {
  return isDomainAction(action) ? actionVariants[action] : "secondary";
}
