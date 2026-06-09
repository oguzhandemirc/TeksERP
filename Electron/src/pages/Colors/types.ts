export interface Color {
  id: string;
  code: string;
  name: string;
  hex: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** findById + create/update yanıtında dolu gelir: rengin atandığı müşteriler. */
  customerIds?: string[];
  /** findById'de dolu gelir: atanmış müşterilerin "müşterideki ad"ı (customerId → alias). */
  customerAliases?: Record<string, string>;
}
