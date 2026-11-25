import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import {
  EMPTY,
  Observable,
  Subject,
  expand,
  finalize,
  map,
  of,
  reduce,
  switchMap,
  takeUntil,
} from 'rxjs';
import { SpecAdapter } from '../../../adapters/spec.adapter';
import type { SpecDto } from '../../../core/api/spec.requests';
import { Role } from '../../../models/enums';
import { minorToMajorString, parseMajorToMinor } from '../../../models/money';
import type {
  EnrollmentConflict,
  Promotion,
  PromotionAction,
  PromotionEnrollment,
  PromotionRules,
} from '../../../models/promotion';
import type { LicenseOption, Spec } from '../../../models/spec';
import { AuthService } from '../../../services/auth.service';
import { CurrencyService } from '../../../services/currency.service';
import { LabService } from '../../../services/lab';
import { PromotionService } from '../../../services/promotion.service';
import { SpecService } from '../../../services/spec.service';
import { ToastService } from '../../../services/toast.service';

const COUPON_PAGE = 25;
const CATALOG_PAGE = 50;
const PICKER_PAGE = 10;
const PRESETS = [10, 15, 20, 25, 30, 40, 50];

function localDate(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

function scheduleDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  const local = Number.isFinite(date.getTime()) ? localDate(date.toISOString()) : '';
  if (!local || local.slice(0, value.length) !== value)
    throw new Error('Enter a valid local date and time.');
  const nextDayOffset = new Date(date.getTime() + 86_400_000).getTimezoneOffset();
  const repeatedTime = new Date(
    date.getTime() + (nextDayOffset - date.getTimezoneOffset()) * 60_000,
  );
  if (
    nextDayOffset !== date.getTimezoneOffset() &&
    localDate(repeatedTime.toISOString()) === local
  ) {
    throw new Error('That time occurs twice due to a clock change. Choose another time.');
  }
  return date;
}

@Injectable()
export class PromotionWorkspace {
  private readonly promotions = inject(PromotionService);
  private readonly specs = inject(SpecService);
  private readonly adapter = inject(SpecAdapter);
  private readonly auth = inject(AuthService);
  private readonly currency = inject(CurrencyService);
  private readonly lab = inject(LabService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ownerChanged = new Subject<void>();
  private readonly pickerCancelled = new Subject<void>();
  private readonly owner = computed(() => {
    const user = this.auth.currentUser();
    return user?.role === Role.PRODUCER ? user.id : undefined;
  });
  private requestVersion = 0;

  readonly presets = PRESETS;
  readonly maxBeats = 100;
  readonly maxOptions = 32;
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly currencies = this.currency.currencies;
  readonly mode = signal<'list' | 'form' | 'enroll' | 'preview'>('list');
  readonly coupons = signal<Promotion[]>([]);
  readonly offset = signal(0);
  readonly hasNext = signal(false);
  readonly active = signal<Promotion | null>(null);
  readonly busy = signal(false);
  readonly loadFailed = signal(false);
  readonly conflict = signal(false);
  readonly confirmation = signal<PromotionAction | null>(null);
  readonly discard = signal<{ message: string; resolve: (confirmed: boolean) => void } | null>(
    null,
  );

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    type: new FormControl<'percent' | 'fixed'>('percent', { nonNullable: true }),
    preset: new FormControl('25', { nonNullable: true }),
    custom: new FormControl('', { nonNullable: true }),
    currencies: new FormControl<string[]>([], { nonNullable: true }),
    amounts: new FormControl<Record<string, string>>({}, { nonNullable: true }),
    starts: new FormControl('', { nonNullable: true }),
    ends: new FormControl('', { nonNullable: true }),
    priority: new FormControl(0, { nonNullable: true }),
  });
  readonly values = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  readonly catalog = signal<Spec[]>([]);
  readonly catalogReady = signal(false);
  readonly pickerLoading = signal(false);
  readonly pickerTotal = signal(0);
  readonly pickerPageSize = PICKER_PAGE;
  readonly enrollmentConflicts = signal(new Map<string, EnrollmentConflict>());
  private readonly unavailableBeats = signal<string[]>([]);
  readonly search = signal('');
  readonly selectedOnly = signal(false);
  readonly pickerPage = signal(1);
  readonly selected = signal(new Map<string, PromotionEnrollment>());
  readonly enrollmentDirty = signal(false);
  readonly preview = signal<PromotionEnrollment[]>([]);
  readonly visibleBeats = this.catalog.asReadonly();
  readonly missingBeats = computed(() =>
    this.unavailableBeats().filter((id) => this.selected().has(id)),
  );
  readonly blockedSelected = computed(() =>
    [...this.enrollmentConflicts().keys()].filter((id) => this.selected().has(id)),
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.resolveDiscard(false));
    effect(() => {
      const owner = this.owner();
      untracked(() => this.watchOwner(owner));
    });
  }

  private watchOwner(owner?: string) {
    // Reset producer-specific data immediately on an account switch. Request
    // callbacks also check identity so an old response cannot refill the view.
    this.mode.set('list');
    this.requestVersion++;
    this.ownerChanged.next();
    this.pickerCancelled.next();
    this.coupons.set([]);
    this.catalog.set([]);
    this.catalogReady.set(false);
    this.pickerTotal.set(0);
    this.enrollmentConflicts.set(new Map());
    this.unavailableBeats.set([]);
    this.active.set(null);
    this.selected.set(new Map());
    this.preview.set([]);
    this.previewByBeat.set(new Map());
    this.confirmation.set(null);
    this.resolveDiscard(false);
    this.form.reset();
    this.enrollmentDirty.set(false);
    this.loadFailed.set(false);
    this.conflict.set(false);
    this.busy.set(false);
    if (owner) this.loadPage(0);
  }

  loadPage(offset: number) {
    if (offset < 0 || offset > 10000) return;
    this.run(
      this.promotions.list(offset, COUPON_PAGE + 1),
      ({ data }) => {
        this.coupons.set(data.slice(0, COUPON_PAGE));
        this.hasNext.set(data.length > COUPON_PAGE && offset + COUPON_PAGE <= 10000);
        this.offset.set(offset);
      },
      () => this.loadFailed.set(true),
    );
  }

  movePage(direction: number) {
    this.loadPage(this.offset() + direction * COUPON_PAGE);
  }

  openForm(coupon: Promotion | null) {
    if (this.busy()) return;
    this.clearFeedback();
    this.active.set(coupon);
    const rules = coupon?.rules;
    const percent = (rules?.percent_bps ?? 2500) / 100;
    const amounts = Object.fromEntries(
      Object.entries(rules?.fixed_minor ?? {}).map(([code, minor]) => [
        code,
        minorToMajorString(
          minor,
          this.currencies().find((currency) => currency.code === code)?.minor_unit_scale ?? 100,
        ),
      ]),
    );
    this.form.reset({
      name: rules?.name ?? '',
      type: rules?.fixed_minor ? 'fixed' : 'percent',
      preset: PRESETS.includes(percent) ? String(percent) : 'custom',
      custom: String(percent),
      currencies: rules?.currencies ?? this.currencies().map((currency) => currency.code),
      amounts,
      starts: localDate(rules?.starts_at),
      ends: localDate(rules?.ends_at),
      priority: rules?.priority ?? 0,
    });
    this.mode.set('form');
  }

  toggleCurrency(code: string, checked: boolean) {
    const control = this.form.controls.currencies;
    control.setValue(
      checked
        ? [...new Set([...control.value, code])]
        : control.value.filter((item) => item !== code),
    );
    control.markAsDirty();
  }

  setDiscountType(type: 'percent' | 'fixed') {
    const control = this.form.controls.type;
    control.setValue(type);
    control.markAsDirty();
  }

  choosePreset(preset: string) {
    const control = this.form.controls.preset;
    control.setValue(preset);
    control.markAsDirty();
  }

  updateAmount(code: string, value: string) {
    const control = this.form.controls.amounts;
    control.setValue({ ...control.value, [code]: value });
    control.markAsDirty();
  }

  saveForm() {
    if (this.busy() || this.conflict()) return;
    const value = this.form.getRawValue();
    const coupon = this.active();
    const name = value.name.trim();
    if (!name || [...name].length > 100 || /\p{Cc}/u.test(name)) {
      this.toast.error('Enter a coupon name of 1 to 100 printable characters.');
      return;
    }
    if (
      !value.currencies.length ||
      !Number.isInteger(value.priority) ||
      value.priority < 0 ||
      value.priority > 1000
    ) {
      this.toast.error(
        'Select at least one currency and enter a whole-number priority from 0 to 1000.',
      );
      return;
    }
    const rules: PromotionRules = {
      name,
      currencies: value.currencies,
      priority: value.priority,
      allow_bundle_stacking: coupon?.rules.allow_bundle_stacking ?? false,
      enrollments: coupon?.rules.enrollments ?? [],
    };
    try {
      const start = scheduleDate(value.starts);
      const end = scheduleDate(value.ends);
      if (start && end && start >= end) throw new Error('End time must be after start time.');
      rules.starts_at = start?.toISOString();
      rules.ends_at = end?.toISOString();
      if (value.type === 'percent') {
        const bps = parseMajorToMinor(value.preset === 'custom' ? value.custom : value.preset);
        if (!Number.isInteger(bps) || bps <= 0 || bps >= 10_000) {
          throw new Error('Enter a percentage from 0.01 to 99.99 with up to two decimal places.');
        }
        rules.percent_bps = bps;
      } else {
        rules.fixed_minor = Object.fromEntries(
          value.currencies.map((code) => {
            const scale = this.currencies().find(
              (currency) => currency.code === code,
            )?.minor_unit_scale;
            const amount = parseMajorToMinor(value.amounts[code], scale);
            if (!Number.isInteger(amount) || amount <= 0)
              throw new Error(`Enter a valid fixed discount in ${code}.`);
            return [code, amount];
          }),
        );
      }
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'Check the coupon settings.');
      return;
    }
    const save = coupon
      ? this.promotions.change(coupon.id, { revision: coupon.revision, action: 'edit', rules })
      : this.promotions.create(rules);
    this.run(save, (saved) => {
      this.form.markAsPristine();
      if (coupon) this.finish('Coupon draft saved.');
      else {
        this.toast.success('Coupon draft created.');
        this.openEnrollment(saved);
      }
    });
  }

  openEnrollment(coupon: Promotion) {
    this.clearFeedback();
    this.active.set(coupon);
    this.mode.set('enroll');
    this.search.set('');
    this.selectedOnly.set(false);
    this.pickerPage.set(1);
    this.catalog.set([]);
    this.catalogReady.set(false);
    this.enrollmentConflicts.set(new Map());
    this.unavailableBeats.set([]);
    this.selected.set(
      new Map((coupon.rules.enrollments ?? []).map((entry) => [entry.beat_id, entry])),
    );
    this.enrollmentDirty.set(false);
    this.loadCatalog();
  }

  loadCatalog(page = this.pickerPage()) {
    const owner = this.owner();
    const coupon = this.active();
    if (!owner || !coupon || this.busy()) return;
    this.pickerCancelled.next();
    this.pickerLoading.set(true);
    const selectedIds = [...this.selected().keys()];
    const filter = {
      category: 'beat' as const,
      search: this.search().trim(),
      ids: this.selectedOnly() ? selectedIds : undefined,
    };
    const request: Observable<{ data: SpecDto[]; metadata: { total: number } }> =
      this.selectedOnly() && !selectedIds.length
        ? of({ data: [], metadata: { total: 0 } })
        : this.specs.getUserSpecs(owner, page, PICKER_PAGE, filter);
    request
      .pipe(
        switchMap(({ data, metadata }) => {
          const beats = data
            .map((dto) => this.adapter.adapt(dto))
            .filter((beat) => beat.producerId === owner && beat.category === 'beat');
          const ids = [...new Set([...beats.map(({ id }) => id), ...selectedIds])];
          return this.promotions
            .checkEnrollment(coupon.id, ids)
            .pipe(map((check) => ({ beats, total: metadata.total, check })));
        }),
        takeUntil(this.pickerCancelled),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pickerLoading.set(false)),
      )
      .subscribe({
        next: ({ beats, total, check }) => {
          if (this.owner() !== owner) return;
          if (page > 1 && !beats.length) {
            this.loadCatalog(1);
            return;
          }
          this.pickerPage.set(page);
          this.pickerTotal.set(total);
          this.catalog.set(beats);
          this.enrollmentConflicts.set(
            new Map(check.conflicts.map((conflict) => [conflict.beat_id, conflict])),
          );
          this.unavailableBeats.set(check.unavailable_beat_ids);
          this.catalogReady.set(true);
        },
        error: () => {
          if (this.owner() !== owner) return;
          this.catalogReady.set(false);
          this.toast.error('Couldn’t check beat availability. Try loading the catalog again.');
        },
      });
  }

  private previewCatalog(owner: string, ids: string[]) {
    if (!ids.length) return of(new Map<string, Spec>());
    const filter = { category: 'beat' as const, ids };
    return this.specs.getUserSpecs(owner, 1, CATALOG_PAGE, filter).pipe(
      expand(({ data, metadata }) =>
        data.length && metadata.page * metadata.per_page < metadata.total
          ? this.specs.getUserSpecs(owner, metadata.page + 1, CATALOG_PAGE, filter)
          : EMPTY,
      ),
      reduce((items, page) => {
        for (const dto of page.data) {
          const beat = this.adapter.adapt(dto);
          if (beat.producerId === owner && beat.category === 'beat') items.set(beat.id, beat);
        }
        return items;
      }, new Map<string, Spec>()),
    );
  }

  eligibleOptions(beat: Spec, scope = this.active()?.rules.currencies ?? []): LicenseOption[] {
    if (beat.processingStatus !== 'completed') return [];
    return beat.licenses.filter((license) =>
      license.prices?.some(
        (price) => price.is_active && price.amount_minor > 0 && scope.includes(price.currency),
      ),
    );
  }

  setSearch(search: string) {
    this.search.set(search);
    this.loadCatalog(1);
  }

  filterSelection(checked: boolean, clearSearch = false) {
    if (clearSearch) this.search.set('');
    this.selectedOnly.set(checked);
    this.loadCatalog(1);
  }

  selectBeat(id: string, checked: boolean) {
    if (this.pickerLoading() || (checked && this.enrollmentConflicts().has(id))) return;
    if (checked && this.selected().size >= this.maxBeats) {
      this.toast.error(`Select up to ${this.maxBeats} beats per coupon.`);
      return;
    }
    const selected = new Map(this.selected());
    if (checked) selected.set(id, { beat_id: id, all_paid: true });
    else selected.delete(id);
    this.updateSelection(selected);
    if (this.selectedOnly() && !checked) this.loadCatalog();
  }

  setLicenseMode(beat: Spec, allPaid: boolean) {
    if (this.pickerLoading() || this.enrollmentConflicts().has(beat.id)) return;
    const current = this.selected().get(beat.id);
    if (!current || current.all_paid === allPaid) return;
    const selected = new Map(this.selected());
    selected.set(beat.id, {
      beat_id: beat.id,
      all_paid: allPaid,
      option_ids: allPaid ? undefined : [],
    });
    this.updateSelection(selected);
  }

  selectOption(beat: Spec, option: string, checked: boolean) {
    if (this.pickerLoading() || this.enrollmentConflicts().has(beat.id)) return;
    const selected = new Map(this.selected());
    const options = new Set(selected.get(beat.id)?.option_ids);
    if (checked && options.size >= this.maxOptions) {
      this.toast.error(`Select up to ${this.maxOptions} license options per beat.`);
      return;
    }
    if (checked) options.add(option);
    else options.delete(option);
    selected.set(beat.id, { beat_id: beat.id, all_paid: false, option_ids: [...options] });
    this.updateSelection(selected);
  }

  unavailableOptions(beat: Spec, enrollment: PromotionEnrollment): string[] {
    const available = new Set(this.eligibleOptions(beat).map((option) => option.id));
    return (enrollment.option_ids ?? []).filter((id) => !available.has(id));
  }

  removeMissing() {
    if (this.pickerLoading() || this.busy()) return;
    const selected = new Map(this.selected());
    for (const id of this.missingBeats()) selected.delete(id);
    this.updateSelection(selected);
    if (this.selectedOnly()) this.loadCatalog();
  }

  private updateSelection(selected: Map<string, PromotionEnrollment>) {
    this.selected.set(selected);
    this.enrollmentDirty.set(true);
  }

  saveEnrollment() {
    const coupon = this.active();
    if (
      !coupon ||
      this.busy() ||
      this.pickerLoading() ||
      this.conflict() ||
      !this.catalogReady() ||
      this.blockedSelected().length ||
      this.missingBeats().length
    )
      return;
    const enrollments = [...this.selected().values()];
    if (enrollments.some((entry) => !entry.all_paid && !entry.option_ids?.length)) {
      this.toast.error('Choose at least one license for each beat set to specific licenses.');
      return;
    }
    const rules = { ...coupon.rules, enrollments };
    this.run(
      this.promotions.change(coupon.id, { revision: coupon.revision, action: 'edit', rules }),
      () => {
        this.enrollmentDirty.set(false);
        this.finish('Beat enrollment saved.');
      },
    );
  }

  readonly previewByBeat = signal(new Map<string, Spec>());

  openPreview(coupon: Promotion) {
    if (this.busy()) return;
    const owner = this.owner();
    if (!owner) return;
    this.clearFeedback();
    this.active.set(coupon);
    this.mode.set('preview');
    this.preview.set([]);
    this.previewByBeat.set(new Map());
    this.run(
      this.promotions.preview(coupon.id).pipe(
        switchMap((preview) =>
          this.previewCatalog(
            owner,
            preview.eligible.map((entry) => entry.beat_id),
          ).pipe(map((beats) => ({ preview, beats }))),
        ),
      ),
      ({ preview, beats }) => {
        if (preview.revision !== coupon.revision) {
          this.conflict.set(true);
          this.toast.error('This coupon has changed. Reload the latest revision to preview it.');
          return;
        }
        this.preview.set(preview.eligible);
        this.previewByBeat.set(beats);
      },
      () => this.loadFailed.set(true),
    );
  }

  retryPreview() {
    const coupon = this.active();
    if (coupon) this.openPreview(coupon);
  }

  licenseName(beat: Spec | undefined, optionId: string): string {
    const option = beat?.licenses.find((entry) => entry.id === optionId);
    return option
      ? [option.name, option.fileTypes.join(', ')].filter(Boolean).join(' · ')
      : 'Unavailable license';
  }

  askAction(coupon: Promotion, action: PromotionAction) {
    if (this.busy()) return;
    this.clearFeedback();
    this.active.set(coupon);
    this.confirmation.set(action);
  }

  applyAction() {
    const action = this.confirmation();
    const coupon = this.active();
    if (!action || !coupon || this.busy() || this.conflict()) return;
    this.confirmation.set(null);
    this.run(this.promotions.change(coupon.id, { revision: coupon.revision, action }), () => {
      this.lab.notifyRefresh();
      this.finish(
        action === 'publish'
          ? 'Coupon published.'
          : action === 'pause'
            ? 'Coupon paused.'
            : 'Coupon archived.',
      );
    });
  }

  reloadLatest() {
    const current = this.active();
    if (!current) {
      this.finish();
      return;
    }
    this.afterDiscardConfirmation(() => {
      this.run(this.promotions.get(current.id), (coupon) => {
        if (coupon.state === 'archived') {
          this.toast.info('This coupon was archived.');
          this.finish();
          return;
        }
        if (this.mode() === 'form') this.openForm(coupon);
        else if (this.mode() === 'enroll') this.openEnrollment(coupon);
        else if (this.mode() === 'preview') this.openPreview(coupon);
        else this.finish();
        this.toast.info('Latest coupon loaded.');
      });
    });
  }

  back() {
    this.afterDiscardConfirmation(() => this.finish());
  }

  private afterDiscardConfirmation(action: () => void) {
    const leave = this.canLeave();
    if (leave === true) action();
    else
      void leave.then((confirmed) => {
        if (confirmed) action();
      });
  }

  canLeave(): true | Promise<boolean> {
    const dirty =
      (this.mode() === 'form' && this.form.dirty) ||
      (this.mode() === 'enroll' && this.enrollmentDirty());
    if (!dirty) return true;
    this.resolveDiscard(false);
    return new Promise((resolve) => {
      this.discard.set({ message: 'Changes to this coupon will be lost.', resolve });
    });
  }

  resolveDiscard(confirmed: boolean) {
    const request = this.discard();
    this.discard.set(null);
    request?.resolve(confirmed);
  }

  describeDiscount(coupon: Promotion): string {
    const rules = coupon.rules;
    if (rules.percent_bps) return `${rules.percent_bps / 100}% off`;
    return (
      Object.entries(rules.fixed_minor ?? {})
        .map(([currency, amount_minor]) => this.currency.formatMoney({ currency, amount_minor }))
        .join(' / ') + ' off'
    );
  }

  describeState(coupon: Promotion): string {
    if (coupon.state === 'draft' && coupon.published_revision) return 'Draft edits pending';
    if (coupon.state === 'published') {
      const { starts_at, ends_at } = coupon.rules;
      if (ends_at && Date.parse(ends_at) <= Date.now()) return 'Expired';
      if (starts_at && Date.parse(starts_at) > Date.now()) return 'Scheduled';
      return 'Published';
    }
    return coupon.state[0].toUpperCase() + coupon.state.slice(1);
  }

  private finish(successMessage?: string) {
    this.pickerCancelled.next();
    this.mode.set('list');
    this.active.set(null);
    this.clearFeedback();
    if (successMessage) this.toast.success(successMessage);
    this.loadPage(this.offset());
  }

  private clearFeedback() {
    this.loadFailed.set(false);
    this.conflict.set(false);
    this.confirmation.set(null);
  }

  private run<T>(request: Observable<T>, onSuccess: (value: T) => void, onFailure?: () => void) {
    const owner = this.owner();
    if (!owner || this.busy()) return;
    const version = ++this.requestVersion;
    const isCurrent = () => this.requestVersion === version && this.owner() === owner;
    this.busy.set(true);
    this.loadFailed.set(false);
    request
      .pipe(
        takeUntilDestroyed<T>(this.destroyRef),
        takeUntil(this.ownerChanged),
        finalize(() => {
          if (isCurrent()) this.busy.set(false);
        }),
      )
      .subscribe({
        next: (data) => {
          if (!isCurrent()) return;
          this.busy.set(false);
          onSuccess(data);
        },
        error: (error: unknown) => {
          if (!isCurrent()) return;
          onFailure?.();
          if (error instanceof HttpErrorResponse && error.error?.code === 'ENROLLMENT_CONFLICT') {
            const conflicts: EnrollmentConflict[] = error.error.conflicts;
            this.enrollmentConflicts.update(
              (previous) =>
                new Map([
                  ...previous,
                  ...conflicts.map((entry) => [entry.beat_id, entry] as const),
                ]),
            );
            const names = [...new Set(conflicts.map((entry) => entry.coupon_name))];
            this.toast.error(
              `Some beats are already enrolled in ${names.join(', ')} during these dates.`,
            );
          } else if (error instanceof HttpErrorResponse && error.status === 409) {
            this.conflict.set(true);
            this.toast.error(
              'This coupon or session changed. Your entries are still here. Reload the latest revision before editing again.',
            );
          } else if (
            error instanceof HttpErrorResponse &&
            error.status === 400 &&
            typeof error.error?.error === 'string'
          ) {
            this.toast.error(error.error.error);
          } else {
            this.toast.error('Couldn’t complete the request. Check your connection and try again.');
          }
        },
      });
  }
}
