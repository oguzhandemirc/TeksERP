// Faz 1: COM port / kantar simülasyonu — gerçek donanım bağlantısı yok

export const hardwareService = {
  // Kantar simülasyonu: 50–500 kg arası rastgele ağırlık döner
  readWeight: async (): Promise<number> => {
    await new Promise((r) => setTimeout(r, 800));
    return Math.round((50 + Math.random() * 450) * 100) / 100;
  },

  // Metraj simülasyonu
  readMeterage: async (): Promise<number> => {
    await new Promise((r) => setTimeout(r, 600));
    return Math.round((100 + Math.random() * 400) * 10) / 10;
  },
};
