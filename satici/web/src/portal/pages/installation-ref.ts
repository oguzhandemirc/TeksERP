// Kurulumun portal listelerindeki kısa kimliği (müşteri › tesis › kurulum) — hata raporları vb. ortak.
export interface InstallationRef {
  readonly id: string;
  readonly kurulumId: string;
  readonly ad: string | null;
  readonly tesis: { readonly ad: string; readonly musteri: { readonly id: string; readonly ad: string } };
}

export function installationPath(k: InstallationRef): string {
  return `${k.tesis.musteri.ad} › ${k.tesis.ad} › ${k.ad ?? k.kurulumId.slice(0, 8)}`;
}
