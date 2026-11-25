import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CheckoutDiscount, Money, SelectedPriceOffer } from '../../../models/money';
import type { Spec } from '../../../models/spec';
import { MoneyPipe } from '../../pipes/money.pipe';

@Component({
  selector: 'app-sale-badge',
  imports: [DecimalPipe, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let deal = discount();
    <span class="label">
      @if (deal.percent_bps; as bps) {
        {{ bps / 100 | number: '1.0-2' }}% off
      } @else {
        {{ { currency: deal.currency, amount_minor: deal.discount_minor } | money }} off
      }
    </span>
    @if (selectLicenses()) {
      <span class="scope">Select licenses</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.2rem 0.4rem;
      inline-size: fit-content;
      padding: var(--sale-padding, 0.24rem 0.45rem);
      border-radius: var(--sale-radius, 0.375rem);
      background: var(--sale-bg, #f8e8df);
      color: var(--sale-ink, #682034);
      font-family: inherit;
      font-size: var(--sale-size, 0.6875rem);
      font-weight: 650;
      line-height: 1.2;
      letter-spacing: 0;
      white-space: normal;
    }
    .label {
      white-space: nowrap;
    }
    .scope {
      font-weight: 500;
    }
  `,
})
export class SaleBadgeComponent {
  readonly discount = input.required<CheckoutDiscount>();
  readonly selectLicenses = input(false);
}

@Component({
  selector: 'app-offer-price',
  imports: [MoneyPipe, SaleBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let deal = discount();
    <span class="amount">
      <span class="current">
        @if (from()) {
          <span class="qualifier">From</span>
        }
        @if (deal && showDiscountedPrice()) {
          <strong>{{
            { currency: deal.currency, amount_minor: deal.payable_minor } | money
          }}</strong>
        } @else {
          {{ base() | money: fallback() : offer() }}
        }
      </span>
      @if (deal && showDiscountedPrice() && showOriginal()) {
        <s aria-label="Original price">{{
          { currency: deal.currency, amount_minor: deal.original_minor } | money
        }}</s>
      }
    </span>
    @if (deal && showBadge()) {
      <app-sale-badge class="sale" [discount]="deal" [selectLicenses]="selectLicenses()" />
    }
  `,
  styles: `
    :host,
    .amount {
      display: inline-flex;
      align-items: baseline;
      flex-wrap: var(--offer-wrap, wrap);
      gap: 0.26em 0.4em;
      min-inline-size: 0;
      justify-content: var(--offer-justify, start);
    }
    :host {
      flex-direction: var(--offer-direction, row);
      align-items: var(--offer-align, baseline);
    }
    .amount {
      font-variant-numeric: tabular-nums;
      flex-direction: var(--offer-amount-direction, row);
    }
    .amount > *,
    .current {
      white-space: nowrap;
    }
    s,
    .qualifier {
      opacity: 0.72;
      font-size: 0.73em;
      font-weight: 500;
    }
    strong {
      font-weight: 700;
    }
    .qualifier {
      margin-inline-end: 0.18em;
    }
  `,
})
export class OfferPriceComponent {
  readonly base = input<Money>();
  readonly fallback = input<number>();
  readonly offer = input<SelectedPriceOffer | null>();
  readonly discount = input<CheckoutDiscount>();
  readonly from = input(false);
  readonly selectLicenses = input(false);
  readonly showDiscountedPrice = input(true);
  readonly showBadge = input(true);
  readonly showOriginal = input(true);
}

@Component({
  selector: 'app-beat-price',
  imports: [OfferPriceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let beat = spec();
    <app-offer-price
      [base]="beat.displayPriceMoney"
      [fallback]="beat.price"
      [offer]="beat.selectedPrice"
      [discount]="beat.promotion?.discount"
      [from]="!!beat.promotion"
      [selectLicenses]="beat.promotion?.select_licenses ?? false"
      [showDiscountedPrice]="beat.promotion?.starting_price ?? false"
      [showBadge]="showBadge()"
      [showOriginal]="showOriginal()"
    />
  `,
})
export class BeatPriceComponent {
  readonly spec = input.required<Spec>();
  readonly showBadge = input(true);
  readonly showOriginal = input(true);
}
