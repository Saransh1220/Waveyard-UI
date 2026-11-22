import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { SpecAdapter } from '../../../adapters/spec.adapter';
import type { ProducerSpecFilter } from '../../../core/api/spec.requests';
import { Role } from '../../../models/enums';
import { FALLBACK_CURRENCIES } from '../../../models/money';
import type { EnrollmentCheck, Promotion } from '../../../models/promotion';
import { AuthService } from '../../../services/auth.service';
import { CurrencyService } from '../../../services/currency.service';
import { LabService } from '../../../services/lab';
import { PromotionService } from '../../../services/promotion.service';
import { SpecService } from '../../../services/spec.service';
import { ToastService } from '../../../services/toast.service';
import { StudioPromotionsComponent } from './studio-promotions.component';

const producer = { id: 'producer', role: Role.PRODUCER };
const coupon: Promotion = {
  id: 'coupon',
  producer_id: producer.id,
  revision: 4,
  state: 'draft',
  updated_at: '2026-11-16T00:00:00Z',
  rules: {
    name: 'Weekend sale',
    percent_bps: 2500,
    currencies: ['USD'],
    priority: 0,
    allow_bundle_stacking: false,
    enrollments: [{ beat_id: 'beat-1', all_paid: true }],
  },
};

function beat(id: number, owner = producer.id) {
  return {
    id: `beat-${id}`,
    producerId: owner,
    title: `Beat ${id}`,
    category: 'beat',
    processingStatus: 'completed',
    key: 'C',
    genres: [],
    licenses: [
      {
        id: `wav-${id}`,
        name: 'Premium',
        fileTypes: ['WAV'],
        prices: [{ currency: 'USD', is_active: true, amount_minor: 3000 }],
      },
    ],
  };
}

function setup() {
  const user = signal<{ id: string; role: Role } | null>(producer);
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const api = {
    list: vi.fn(() => of({ data: [coupon] })),
    create: vi.fn(() => of(coupon)),
    change: vi.fn(() => of(coupon)),
    get: vi.fn(() => of(coupon)),
    checkEnrollment: vi.fn(() => of<EnrollmentCheck>({ conflicts: [], unavailable_beat_ids: [] })),
    preview: vi.fn(() =>
      of({ revision: 4, eligible: [{ beat_id: 'beat-1', option_ids: ['wav-1'] }] }),
    ),
  };
  const specs = {
    getUserSpecs: vi.fn(
      (_owner: string, page: number, limit: number, filter?: ProducerSpecFilter) => {
        const catalog = [
          ...Array.from({ length: 11 }, (_, index) => beat(index + 1)),
          beat(12, 'other'),
        ];
        const matches = catalog.filter(
          (item) =>
            (!filter?.ids || filter.ids.includes(item.id)) &&
            (!filter?.search || item.title.toLowerCase().includes(filter.search.toLowerCase())),
        );
        return of({
          data: matches.slice((page - 1) * limit, page * limit),
          metadata: { page, per_page: limit, total: matches.length },
        });
      },
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { currentUser: user } },
      { provide: PromotionService, useValue: api },
      { provide: SpecService, useValue: specs },
      { provide: LabService, useValue: { notifyRefresh: vi.fn() } },
      { provide: ToastService, useValue: toast },
      { provide: CurrencyService, useValue: { currencies: signal(FALLBACK_CURRENCIES) } },
      { provide: SpecAdapter, useValue: { adapt: (value: unknown) => value } },
    ],
  });
  const fixture = TestBed.createComponent(StudioPromotionsComponent);
  fixture.detectChanges();
  const dialog: HTMLDialogElement = fixture.nativeElement.querySelector('dialog');
  if (!dialog.showModal)
    dialog.showModal = () => {
      dialog.open = true;
    };
  if (!dialog.close)
    dialog.close = () => {
      dialog.open = false;
    };
  return { page: fixture.componentInstance.w, fixture, user, api, specs, dialog, toast };
}

describe('Producer Studio Coupons', () => {
  it('creates a fixed-amount draft with native minor units and opens enrollment', () => {
    const { page, fixture, api, toast } = setup();
    expect(fixture.nativeElement.textContent).toContain('Weekend sale');
    page.openForm(null);
    fixture.detectChanges();
    const editor: HTMLFormElement = fixture.nativeElement.querySelector('form');
    const fixed = [...editor.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Fixed amount',
    );
    expect(fixed).toBeDefined();
    expect(editor.querySelector('input[type="checkbox"]')).toBeNull();
    fixed?.click();
    fixture.detectChanges();
    expect(fixed?.getAttribute('aria-pressed')).toBe('true');
    expect(page.form.dirty).toBe(true);
    page.form.patchValue({
      name: '   Fixed discount  ',
      currencies: ['INR', 'USD'],
      amounts: { INR: '250', USD: '5.40' },
    });
    page.saveForm();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Fixed discount',
        fixed_minor: { INR: 25000, USD: 540 },
      }),
    );
    expect(page.mode()).toBe('enroll');
    expect(toast.success).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith('Coupon draft created.');
  });

  it('preserves selections across pages and searches and submits exact license IDs', () => {
    const { page, fixture, api, specs, toast } = setup();
    page.openEnrollment(coupon);
    expect(specs.getUserSpecs).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-pagination')).not.toBeNull();
    page.loadCatalog(2);
    expect(specs.getUserSpecs).toHaveBeenNthCalledWith(2, producer.id, 2, 10, {
      category: 'beat',
      search: '',
      ids: undefined,
    });
    expect(page.catalog().some((item) => item.id === 'beat-12')).toBe(false);
    const secondPageBeat = page.visibleBeats()[0];
    expect(secondPageBeat.id).toBe('beat-11');
    fixture.detectChanges();
    const enrollment: HTMLElement = fixture.nativeElement.querySelector('app-promotion-enrollment');
    expect(enrollment.querySelector('input[type="checkbox"]')).toBeNull();
    const beatButton = enrollment.querySelector<HTMLButtonElement>('.pw-beat-label');
    expect(beatButton?.getAttribute('aria-pressed')).toBe('false');
    beatButton?.click();
    fixture.detectChanges();
    expect(beatButton?.getAttribute('aria-pressed')).toBe('true');
    const licenseMenu = enrollment.querySelector<HTMLDetailsElement>('.pw-license-mode');
    expect(licenseMenu).not.toBeNull();
    licenseMenu!.open = true;
    const specific = licenseMenu!.querySelectorAll('button')[1];
    specific.click();
    fixture.detectChanges();
    expect(licenseMenu!.open).toBe(false);
    expect(specific.getAttribute('aria-pressed')).toBe('true');
    page.selectOption(secondPageBeat, 'wav-11', true);
    specific.click();
    expect(page.selected().get('beat-11')?.option_ids).toEqual(['wav-11']);
    page.setSearch('Beat 2');
    expect(page.visibleBeats().map((item) => item.id)).toEqual(['beat-2']);
    page.saveEnrollment();
    expect(api.change).toHaveBeenCalledWith('coupon', {
      revision: 4,
      action: 'edit',
      rules: {
        ...coupon.rules,
        enrollments: [
          { beat_id: 'beat-1', all_paid: true },
          { beat_id: 'beat-11', all_paid: false, option_ids: ['wav-11'] },
        ],
      },
    });
    expect(toast.success).toHaveBeenCalledWith('Beat enrollment saved.');
  });

  it('names the conflicting coupon and prevents adding its beat', () => {
    const { page, fixture, api } = setup();
    api.checkEnrollment.mockReturnValue(
      of({
        conflicts: [{ beat_id: 'beat-2', coupon_id: 'other-coupon', coupon_name: 'Winter sale' }],
        unavailable_beat_ids: [],
      }),
    );
    page.openEnrollment(coupon);
    fixture.detectChanges();
    const blocked: HTMLButtonElement =
      fixture.nativeElement.querySelector('.pw-beat-blocked button');
    expect(blocked.disabled).toBe(true);
    expect(blocked.textContent).toContain('Winter sale');
    page.selectBeat('beat-2', true);
    expect(page.selected().has('beat-2')).toBe(false);
  });

  it('keeps an unsaved selection after a conflict and prevents a stale write', () => {
    const { page, api, fixture, toast } = setup();
    api.change.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    page.openEnrollment(coupon);
    page.selectBeat('beat-2', true);
    page.saveEnrollment();
    expect(page.conflict()).toBe(true);
    expect(page.selected().has('beat-2')).toBe(true);
    expect(page.enrollmentDirty()).toBe(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Reload latest');
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Your entries are still here'),
    );
    page.saveEnrollment();
    expect(api.change).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['publish', 'Coupon published.'],
    ['pause', 'Coupon paused.'],
    ['archive', 'Coupon archived.'],
  ] as const)('reports a successful %s through the toast only', (action, message) => {
    const { page, fixture, api, toast } = setup();
    page.askAction(coupon, action);
    page.applyAction();
    fixture.detectChanges();
    expect(api.change).toHaveBeenCalledWith(coupon.id, { revision: coupon.revision, action });
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(message);
    expect(fixture.nativeElement.textContent).not.toContain(message);
  });

  it('toasts rejection and lets the producer retry a failed list load', () => {
    const { page, fixture, api, toast } = setup();
    api.change.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    page.askAction(coupon, 'publish');
    page.applyAction();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();

    api.list.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    page.loadPage(0);
    fixture.detectChanges();
    const retry = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Retry loading coupons',
    );
    expect(retry).toBeDefined();
    expect(toast.error).toHaveBeenCalledTimes(2);
    retry.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Retry loading coupons');
  });

  it('lets a producer cancel leaving an unsaved coupon from the confirmation dialog', async () => {
    const { page, fixture, dialog } = setup();
    page.openForm(coupon);
    page.form.markAsDirty();
    const leave = page.canLeave();
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Discard your changes?');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await leave).toBe(false);
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
    expect(page.form.dirty).toBe(true);
  });

  it('uses the eligibility preview and ignores responses after an account switch', () => {
    const { page, fixture, user, api, dialog, toast } = setup();
    page.openPreview(coupon);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toMatch(/Premium\s*·\s*WAV/);
    const delayed = new Subject<Promotion>();
    api.change.mockReturnValue(delayed);
    page.back();
    fixture.detectChanges();
    const screen: HTMLElement = fixture.nativeElement;
    expect(screen.querySelector('.pw-status-cell')?.textContent?.trim()).toBe('Draft');
    const publish = screen.querySelector<HTMLButtonElement>('.pw-publish-action');
    expect(publish?.textContent?.trim()).toBe('Publish');
    expect(publish?.closest('.pw-popup')).toBeNull();
    publish?.click();
    expect(page.confirmation()).toBe('publish');
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Publish Weekend sale?');
    dialog.querySelector<HTMLButtonElement>('.pw-primary')?.click();
    user.set({ id: 'artist', role: Role.ARTIST });
    fixture.detectChanges();
    delayed.next(coupon);
    expect(page.coupons()).toEqual([]);
    expect(page.active()).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
