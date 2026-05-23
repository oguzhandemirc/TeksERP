export interface SubcontractorCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /** "Renk veren" kategori — true ise bu kategoride yapılan fason kabulde
   * Roll.colorId WO.targetColorId'den otomatik kopyalanır. Örn. Boyahane. */
  appliesColor: boolean;
  /** "Özellik veren" kategori — true ise bu kategoride yapılan fason kabulde
   * Roll'a WO.targetProperties otomatik kopyalanır. Boyahane (renkle birlikte),
   * ileride Zımpara/Kurşun gibi yalnız özellik veren adımlar için. */
  appliesProperty: boolean;
  _count?: { subcontractors: number; workOrderSteps: number };
  createdAt: string;
  updatedAt: string;
}
