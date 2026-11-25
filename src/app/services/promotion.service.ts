import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiService } from '../core/services/api.service';
import type {
  EnrollmentCheck,
  Promotion,
  PromotionChange,
  PromotionPreview,
  PromotionRules,
} from '../models/promotion';

@Injectable({ providedIn: 'root' })
export class PromotionService {
  private readonly api = inject(ApiService);
  private readonly path = '/studio/promotions';

  list(offset: number, limit: number) {
    return this.api.execute<{ data: Promotion[] }>({
      method: 'GET',
      path: this.path,
      params: new HttpParams().set('offset', offset).set('limit', limit),
    });
  }

  get(id: string) {
    return this.api.execute<Promotion>({ method: 'GET', path: this.promotionPath(id) });
  }

  create(body: PromotionRules) {
    return this.api.execute<Promotion>({ method: 'POST', path: this.path, body });
  }

  change(id: string, body: PromotionChange) {
    return this.api.execute<Promotion>({ method: 'PATCH', path: this.promotionPath(id), body });
  }

  preview(id: string) {
    return this.api.execute<PromotionPreview>({
      method: 'GET',
      path: this.promotionPath(id) + '/preview',
    });
  }

  checkEnrollment(id: string, beatIds: string[]) {
    return this.api.execute<EnrollmentCheck>({
      method: 'POST',
      path: this.promotionPath(id) + '/enrollment-check',
      body: { beat_ids: beatIds },
    });
  }

  private promotionPath(id: string) {
    return this.path + '/' + encodeURIComponent(id);
  }
}
