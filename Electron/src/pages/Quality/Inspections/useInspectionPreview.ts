// Önizleme ucu (debounce) — puan/derece tek kaynak backend motorundan; istemcide formül yok.
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { inspectionService, type MeasureInput } from "./service";

export function useInspectionPreview(rollId: string | null, measure: MeasureInput | null) {
  const body = useDebouncedValue(rollId && measure ? JSON.stringify({ rollId, ...measure }) : "");
  return useQuery({
    queryKey: ["quality-inspections", "preview", body],
    queryFn: () => inspectionService.preview(JSON.parse(body)),
    enabled: body !== "",
    retry: false,
  });
}
