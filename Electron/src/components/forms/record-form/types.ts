import type { ReactNode } from "react";
import type { ApiResponse } from "@/types/api";

/**
 * Seçicide kayıt formu sözleşmesi (GENEL UI 2026-11-25): Yeni · Düzenle · Örnek al.
 * Örnek al kaynağı DEĞİŞTİREMEZ: taslak kimliksiz doğar ve yalnız `create` çağrılır (bkz. useRecordForm).
 * Kullanım yerinde (seçici) Düzenle yalnız bu yere ait kayıtta (`isExclusive`); paylaşılan kart asıl ekranında düzenlenir.
 */
export type RecordFormMode = "create" | "edit" | "template";

/** Örnek al taslağı: kaynak satırın kimliksiz kopyası (id/createdAt/updatedAt yok). */
export type TemplateDraft<T> = Omit<Partial<T>, "id"> & { id?: never };

export interface RecordFormRenderParams<T extends { id: string }> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RecordFormMode;
  /** Yalnız `edit` kipinde dolu (düzenlenen kayıt). */
  initial: T | null;
  /** Yalnız `template` kipinde dolu (kimliksiz taslak). */
  draft: TemplateDraft<T> | null;
  onSubmit: (values: Partial<T>) => Promise<void>;
  isSubmitting: boolean;
}

export interface RecordFormService<T> {
  create: (data: Partial<T>) => Promise<ApiResponse<T>>;
  update: (id: string, data: Partial<T>) => Promise<ApiResponse<T>>;
}

/** `R`: seçici satırının tipi (varsayılan kaydın kendisi); hafif özet satırında `loadFull` tam kaydı getirir. */
export interface RecordFormSpec<T extends { id: string }, R extends { id: string } = T> {
  /** Toast ve başlıklarda: "Renk", "Hizmet kartı". */
  entityName: string;
  service: RecordFormService<T>;
  /** Yazma izni — tanım ekranının (CrudPage `writePermission`) aynısı; yoksa üç düğme de gizli. */
  writePermission: string;
  /** Kayıttan sonra tazelenecek React Query kökleri (seçici + liste ekranı). */
  invalidateKeys: string[];
  /** Tekil alanlar: örnek alırken boşaltılır (`clear`) ya da "… (kopya)" önerisiyle gelir (`suggestCopy`). */
  templateRule: { clear?: string[]; suggestCopy?: string[] };
  /** Kayıt yalnız bu kullanım yerine mi ait? Bilinmiyorsa/paylaşılıyorsa yerinde düzenleme yok. */
  isExclusive?: (row: R) => boolean;
  /** Seçici satırı hafif bir özetse (ürün seçicisi) örnek almadan önce tam kaydı çeker. */
  loadFull?: (row: R) => Promise<T>;
  /** Tanımın asıl ekranı ("Kart ekranında aç" — yeni sekmede). */
  cardPath: (row: R) => string;
  renderForm: (params: RecordFormRenderParams<T>) => ReactNode;
}
