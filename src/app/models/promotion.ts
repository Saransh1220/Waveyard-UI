export type PromotionState = 'draft' | 'published' | 'paused' | 'archived';
export interface EnrollmentConflict {
  beat_id: string;
  coupon_id: string;
  coupon_name: string;
}

export interface EnrollmentCheck {
  conflicts: EnrollmentConflict[];
  unavailable_beat_ids: string[];
}
export type PromotionAction = 'publish' | 'pause' | 'archive';

export interface PromotionEnrollment {
  beat_id: string;
  all_paid: boolean;
  option_ids?: string[];
}

export interface PromotionRules {
  name: string;
  percent_bps?: number;
  fixed_minor?: Record<string, number>;
  currencies: string[];
  starts_at?: string;
  ends_at?: string;
  priority: number;
  allow_bundle_stacking: boolean;
  enrollments: PromotionEnrollment[];
}

export interface Promotion {
  id: string;
  producer_id: string;
  revision: number;
  published_revision?: number;
  state: PromotionState;
  rules: PromotionRules;
  updated_at: string;
}

export interface PromotionPreview {
  revision: number;
  eligible: PromotionEnrollment[];
}

export type PromotionChange =
  | { revision: number; action: 'edit'; rules: PromotionRules }
  | { revision: number; action: PromotionAction };
