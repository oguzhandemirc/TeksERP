export interface Warehouse {
  id: string;
  code: string;
  name: string;
  /** Depo söylenmeyen her girişin düştüğü depo — sistemde TAM BİR TANE. */
  isDefault: boolean;
  isActive: boolean;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
