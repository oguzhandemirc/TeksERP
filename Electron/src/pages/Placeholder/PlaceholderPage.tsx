import { PageHeader } from "@/components/layout/PageHeader";

interface Props {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: Props) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} description={description ?? "Bu sayfa henüz hazır değil."} />
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Yapım aşamasında.
      </div>
    </div>
  );
}
