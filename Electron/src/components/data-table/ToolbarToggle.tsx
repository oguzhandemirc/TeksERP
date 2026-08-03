import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  title?: string;
}

/**
 * Araç çubuğuna gömülen etiketli tik — "Pasifleri göster" / "İptalleri göster"
 * gibi liste kapsamını genişleten anahtarlar için TEK görsel tanım.
 *
 * Neden ayrı bileşen: aynı kutu üç operasyon sayfasında ve tüm master-data
 * sayfalarının ortak kabında (`CrudPage`) tekrarlanıyor. Kopyalandığında yükseklik
 * (`h-8`) araç çubuğundaki diğer kontrollerle hizasını sessizce kaybediyordu.
 */
export function ToolbarToggle({ checked, onCheckedChange, label, title }: Props) {
  return (
    <label
      title={title}
      className="flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border bg-background px-3 text-xs"
    >
      <Checkbox checked={checked} onCheckedChange={(c) => onCheckedChange(Boolean(c))} />
      {label}
    </label>
  );
}
