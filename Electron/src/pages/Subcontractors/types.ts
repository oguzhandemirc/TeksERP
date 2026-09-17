export interface SubcontractorCategoryLink {
  categoryId: string;
  category?: { id: string; code: string; name: string };
}

export interface Subcontractor {
  id: string;
  code: string;
  name: string;
  taxNumber: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  /** İş emri fason adımında firma seçicide default gelir (kategori bazında). */
  isFavorite: boolean;
  /** Belge şablon profili — null = genel Belge Şablonları ayarı. */
  documentProfileId?: string | null;
  /** Fason = carinin rolü: bağlı cari kartı (null = bağsız fason, bugünkü davranış). */
  customerId?: string | null;
  customer?: { id: string; code: string; name: string } | null;
  categories: SubcontractorCategoryLink[];
  createdAt: string;
  updatedAt: string;
}
