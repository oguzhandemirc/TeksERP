// URL bayrak süzgeci onay kutusu (`filter[x]=true`); liste ve özet şeridi aynı URL'i okur, süzme sunucuda.
import { useSearchParams } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";

export function UrlFlagToggle({ param, label }: { param: string; label: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const checked = searchParams.get(param) === "true";
  const toggle = (next: boolean) => {
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set(param, "true");
    else sp.delete(param);
    setSearchParams(sp, { replace: true });
  };
  return (
    <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
      <Checkbox checked={checked} onCheckedChange={(v) => toggle(v === true)} />
      {label}
    </label>
  );
}
