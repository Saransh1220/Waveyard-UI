import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { BRAND } from '../../core/config/brand';

import type { LicenseOption, Spec } from '../../models';
import type { CheckoutQuote } from '../../models/payment';
import { BuyerCurrencyService } from '../../services/buyer-currency.service';
import { CartService } from '../../services/cart.service';
import { PaymentService } from '../../services/payment.service';
import { PlayerService } from '../../services/player.service';
import { PurchaseDialogService } from '../../services/purchase-dialog.service';
import { ToastService } from '../../services/toast.service';
import {
  OfferPriceComponent,
  SaleBadgeComponent,
} from '../../shared/components/offer-price/offer-price.component';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { licenseTiers, TIER_ICON, TIER_LABEL } from '../../utils/license-tiers';
import { WarpDialogComponent } from '../warp-dialog/warp-dialog';
import { defaultLicense, formatLength, licenseFeatures, licenseSubtitle } from './license-display';

/**
 * The buy flow: opens the warp dialog for the beat in `PurchaseDialogService`, shows its details
 * and license tiers, and lets the buyer add the chosen license to the cart or buy it now.
 */
@Component({
  selector: 'app-purchase-warp',
  imports: [WarpDialogComponent, OfferPriceComponent, SaleBadgeComponent, MoneyPipe],
  templateUrl: './purchase-warp.html',
  styleUrl: './purchase-warp.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PurchaseWarpComponent {
  readonly brand = BRAND;
  private readonly dialog = inject(PurchaseDialogService);
  private readonly cart = inject(CartService);
  private readonly payment = inject(PaymentService);
  private readonly buyerCurrency = inject(BuyerCurrencyService);
  private readonly toast = inject(ToastService);
  private readonly player = inject(PlayerService);

  readonly open = computed(() => !!this.dialog.spec());

  /** The beat on show. Kept after the dialog closes so the content survives the exit animation. */
  readonly spec = signal<Spec | null>(null);
  readonly selectedLicenseId = signal<string | null>(null);
  readonly isSubmitting = signal(false);
  readonly priceChangedNotice = signal<string | null>(null);
  readonly quoteLoading = signal(false);
  readonly quoteError = signal(false);
  readonly hasLegacyCheckout = signal(false);
  private readonly savedCheckout = signal<CheckoutQuote | null>(null);
  private readonly quotedPrice = signal<CheckoutQuote | null>(null);
  private readonly quoteAttempt = signal(0);

  readonly licenses = computed(() => this.spec()?.licenses ?? []);
  private readonly tiers = computed(() => licenseTiers(this.licenses()));
  readonly selectedLicense = computed(() => {
    const spec = this.spec();
    const id = this.selectedLicenseId();
    return spec?.licenses?.find((license) => license.id === id) ?? defaultLicense(spec);
  });
  readonly quote = computed(() => {
    const quote = this.quotedPrice();
    if (
      quote?.spec_id === this.dialog.spec()?.id &&
      quote?.license_option_id === this.selectedLicense()?.id &&
      quote?.requested_currency === this.buyerCurrency.effective()
    ) {
      return quote;
    }
    return null;
  });

  readonly previousQuote = computed(() => {
    const saved = this.savedCheckout();
    return saved?.spec_id === this.dialog.spec()?.id &&
      saved?.license_option_id === this.selectedLicense()?.id
      ? saved
      : null;
  });

  readonly canResumeAtCurrentPrice = computed(() => {
    const previous = this.previousQuote();
    const current = this.quote();
    return (
      !!previous &&
      !!current &&
      previous.offer.currency === current.offer.currency &&
      previous.payable_minor === current.payable_minor
    );
  });

  readonly quoteDiscount = computed(() => {
    const quote = this.quote();
    if (!quote || quote.discount_minor <= 0) return undefined;
    return {
      currency: quote.offer.currency,
      original_minor: quote.offer.amount_minor,
      discount_minor: quote.discount_minor,
      payable_minor: quote.payable_minor,
      percent_bps: quote.discount_percent_bps,
    };
  });
  /** The preview on the cover is playing (this beat is the current track and audio is running). */
  readonly previewing = computed(() => {
    const spec = this.spec();
    return !!spec && this.player.currentTrack()?.id === spec.id && this.player.isPlaying();
  });
  readonly length = computed(() => formatLength(this.spec()?.duration));
  readonly genre = computed(() => {
    const spec = this.spec();
    return spec?.genres?.[0]?.name || spec?.category || 'Beat';
  });

  constructor() {
    effect(() => {
      const spec = this.dialog.spec();
      if (!spec) return;
      const preferred = this.dialog.preferredLicenseId();
      untracked(() => {
        this.spec.set(spec);
        const license = spec.licenses?.find(({ id }) => id === preferred) ?? defaultLicense(spec);
        this.selectedLicenseId.set(license?.id ?? null);
      });
    });
    effect((onCleanup) => {
      const beat = this.dialog.spec();
      const optionId = this.selectedLicense()?.id;
      const currency = this.buyerCurrency.effective();
      this.quoteAttempt();
      this.quotedPrice.set(null);
      this.quoteError.set(false);
      this.savedCheckout.set(null);
      this.hasLegacyCheckout.set(false);
      this.quoteLoading.set(false);
      if (!beat || beat.id !== this.spec()?.id || !optionId) return;

      this.savedCheckout.set(this.payment.resumeQuote(beat.id, optionId) ?? null);
      this.hasLegacyCheckout.set(this.payment.hasLegacyCheckout(beat.id, optionId));
      this.quoteLoading.set(true);
      const request = this.payment.getCheckoutQuote(beat.id, optionId, currency).subscribe({
        next: (quote) => {
          this.quotedPrice.set(quote);
          this.quoteLoading.set(false);
        },
        error: () => {
          this.quoteError.set(true);
          this.quoteLoading.set(false);
        },
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  close(): void {
    this.priceChangedNotice.set(null);
    this.dialog.close();
  }

  togglePreview(): void {
    const spec = this.spec();
    if (!spec) return;
    if (this.player.currentTrack()?.id === spec.id) this.player.togglePlay();
    else this.player.showPlayer(spec);
  }

  select(license: LicenseOption): void {
    this.priceChangedNotice.set(null);
    this.selectedLicenseId.set(license.id);
  }

  refreshQuote(): void {
    this.quotedPrice.set(null);
    this.quoteAttempt.update((attempt) => attempt + 1);
  }

  addToCart(): void {
    const spec = this.spec();
    const license = this.selectedLicense();
    if (!spec || !license) return;
    this.cart.addItem(spec, license);
    this.toast.show(`Added ${spec.title} (${license.name}) to cart`, 'success');
    this.close();
  }

  buyNow(): void {
    if (this.hasLegacyCheckout()) return;
    const saved = this.previousQuote();
    if (saved) {
      if (this.canResumeAtCurrentPrice()) this.resumeCheckout();
      return;
    }
    const current = this.quote();
    if (current) this.startCheckout({ quote: current });
  }

  resumeCheckout(): void {
    const saved = this.previousQuote();
    if (saved) this.startCheckout({ quote: saved, resuming: true });
    else if (this.hasLegacyCheckout()) this.startCheckout({ resumeLegacy: true });
  }

  private startCheckout(evidence: {
    quote?: CheckoutQuote;
    resuming?: boolean;
    resumeLegacy?: boolean;
  }): void {
    const spec = this.spec();
    const license = this.selectedLicense();
    if (!spec || !license || this.isSubmitting()) return;
    this.isSubmitting.set(true);
    this.priceChangedNotice.set(null);
    const call = this.payment.initiatePayment(spec.id, license.id, spec.title, evidence);
    call.subscribe({
      complete: () => {
        this.isSubmitting.set(false);
        if (this.open()) this.refreshQuote();
      },
      next: () => {
        this.isSubmitting.set(false);
        if (this.dialog.spec()?.id === spec.id) this.close();
      },
      error: (err) => {
        this.isSubmitting.set(false);
        if (this.dialog.spec()?.id !== spec.id || this.selectedLicense()?.id !== license.id) return;
        const code = err?.error?.code;
        if (code === 'PRICE_CHANGED' || code === 'PRICE_UNAVAILABLE') {
          this.priceChangedNotice.set(
            'The checkout price changed. Review the updated amount before continuing.',
          );
        }
        this.refreshQuote();
      },
    });
  }

  badge(index: number): string {
    return TIER_LABEL[this.tiers()[index] ?? 'standard'];
  }

  badgeIcon(index: number): string {
    return TIER_ICON[this.tiers()[index] ?? 'standard'];
  }

  subtitle(license: LicenseOption, index: number): string {
    return licenseSubtitle(license, index, this.licenses().length);
  }

  features(license: LicenseOption): string[] {
    return licenseFeatures(license);
  }
}
