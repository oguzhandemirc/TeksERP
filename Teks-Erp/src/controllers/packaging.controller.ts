// =============================================================================
// TeksERP - Packaging (Paket/Tartı/Etiket) Controller
// =============================================================================
// Paketleme WO'dan bağımsız fulfillment akışı. Eski refakat kartı / barkod
// keşfi endpoint'leri kaldırıldı — operatör artık PackagingQueue üzerinden
// sıradaki ruloyu alır.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { PackagingService } from "../services/packaging.service";
import "../types/express-augment";

export class PackagingController {
  private service: PackagingService;

  constructor() {
    this.service = new PackagingService();
    this.simulateWeigh = this.simulateWeigh.bind(this);
    this.simulateWeighSwatch = this.simulateWeighSwatch.bind(this);
    this.finalize = this.finalize.bind(this);
  }

  /** POST /api/packaging/simulate-weigh/:rollId */
  async simulateWeigh(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await this.service.simulateWeigh(
        req.params.rollId as string
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/packaging/simulate-weigh-swatch/:swatchId */
  async simulateWeighSwatch(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await this.service.simulateWeighSwatch(
        req.params.swatchId as string
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/packaging/finalize — DEPRECATED.
   * Rulo-bazlı paketleme akışı kaldırıldı. Yeni akış: operatör siparişi
   * sevkiyat kuyruğundan alır, çuval açar, rulları çuvala atar (sack ile
   * allocation otomatik kurulur).
   */
  async finalize(
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    res.status(410).json({
      success: false,
      message:
        'Bu endpoint kaldırıldı. Sevkiyat kuyruğundan siparişi alıp çuvala top ekleyin (POST /api/sacks/assign-roll).',
    });
  }
}
