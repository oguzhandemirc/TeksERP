// Kumaş türü (K8) ve lif türü (K7) — ürün kartının ayarlanabilir sınıflama listeleri.
export interface FabricType {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  _count?: { items: number };
  createdAt: string;
  updatedAt: string;
}

export interface FiberType {
  id: string;
  name: string;
  /** Kompozisyon metnindeki kısa ad ("%83 PES"); boşsa ad yazılır. */
  abbreviation: string | null;
  sortOrder: number;
  isActive: boolean;
  _count?: { itemFibers: number };
  createdAt: string;
  updatedAt: string;
}

export type ClassTypeRow = FabricType | FiberType;

/** "N yerde kullanılıyor" — kumaş türünde kart, lif türünde iplik satırı sayısı. */
export function usageCount(row: ClassTypeRow): number {
  const c = row._count as { items?: number; itemFibers?: number } | undefined;
  return c?.items ?? c?.itemFibers ?? 0;
}
