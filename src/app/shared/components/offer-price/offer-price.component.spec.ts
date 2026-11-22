import { TestBed } from '@angular/core/testing';
import type { Spec } from '../../../models/spec';
import { BeatPriceComponent } from './offer-price.component';

describe('BeatPriceComponent', () => {
  const discount = {
    currency: 'USD',
    original_minor: 10000,
    discount_minor: 2500,
    payable_minor: 7500,
    percent_bps: 2500,
  };

  function render(startingPrice: boolean) {
    const fixture = TestBed.createComponent(BeatPriceComponent);
    fixture.componentRef.setInput('spec', {
      price: 80,
      displayPriceMoney: { currency: 'USD', amount_minor: 8000 },
      promotion: { discount, starting_price: startingPrice, select_licenses: true },
    } as Spec);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the original and discounted starting prices for a qualifying tier', () => {
    const element = render(true);
    expect(element.querySelector('s')?.textContent).toContain('$100');
    expect(element.querySelector('strong')?.textContent).toContain('$75');
    expect(element.querySelector('.sale')?.textContent).toMatch(/25% off\s+Select licenses/);
  });

  it('keeps a cheaper regular tier as the starting price and still indicates the coupon', () => {
    const element = render(false);
    expect(element.querySelector('.amount')?.textContent).toContain('$80');
    expect(element.querySelector('s')).toBeNull();
    expect(element.querySelector('.sale')?.textContent).toContain('25% off');
  });
});
