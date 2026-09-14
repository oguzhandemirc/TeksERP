import { CrudPage } from "@/components/layout/CrudPage";
import { warpSpecColumns } from "./columns";
import { warpSpecService } from "./service";
import { WarpSpecFormDialog } from "./WarpSpecFormDialog";
import type { WarpSpec } from "./types";
import type { WarpSpecFormValues } from "./schema";

/** Form METİN taşır (boş bırakılabilsin diye), backend SAYI bekler. Boş dize
 *  `null`a döner — "0" ile "girilmedi" aynı şey değildir. */
const sayi = (v: string | undefined): number | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : Number(t);
};

const buildPayload = (v: WarpSpecFormValues): Partial<WarpSpec> => ({
  code: v.code.trim(),
  name: v.name.trim(),
  yarnItemId: v.yarnItemId,
  endsCount: Number(v.endsCount),
  selvedgeEnds: sayi(v.selvedgeEnds),
  // Decimal kolonlar: backend `Prisma.Decimal` bekler, string kabul eder.
  reedNo: (v.reedNo ?? "").trim() || null,
  endsPerDent: sayi(v.endsPerDent),
  reedWidthCm: (v.reedWidthCm ?? "").trim() || null,
  takeUpPct: (v.takeUpPct ?? "").trim() || null,
  notes: (v.notes ?? "").trim() || null,
  isActive: v.isActive,
});

export function WarpSpecsPage() {
  return (
    <CrudPage<WarpSpec>
      title="Çözgü Kartları"
      description="Çözgü tanımı: tel adedi · iplik · tarak. Bir çözgü kartı birden çok deseni besler; levent bu karta göre sarılır."
      entityName="Çözgü kartı"
      queryKey="warp-specs"
      service={warpSpecService}
      columns={warpSpecColumns}
      writePermission="warpspec:write"
      searchPlaceholder="Kod veya ad ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <WarpSpecFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildPayload(values))}
        />
      )}
    />
  );
}
