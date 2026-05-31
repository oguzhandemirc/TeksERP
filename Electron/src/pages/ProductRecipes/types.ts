export interface RecipeProperty {
  id: string;
  propertyId: string;
  property?: { id: string; code: string; name: string };
}

export interface ProductRecipe {
  id: string;
  code: string;
  name: string;
  itemId: string;
  colorId: string | null;
  /** En (cm). Backend Decimal → number serialize edilir. */
  width: number | null;
  foldType: string | null;
  routeId: string | null;
  isActive: boolean;
  item?: { id: string; code: string; name: string } | null;
  color?: { id: string; code: string; name: string; hex: string | null } | null;
  route?: { id: string; code: string | null; name: string } | null;
  properties?: RecipeProperty[];
  createdAt: string;
  updatedAt: string;
}
