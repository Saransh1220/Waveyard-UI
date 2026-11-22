import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterRenderEffect,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { PromotionWorkspace } from './promotion-workspace';
import {
  PromotionListComponent,
  PromotionEditorComponent,
  PromotionEnrollmentComponent,
  PromotionPreviewComponent,
} from './promotion-views';

@Component({
  selector: 'app-studio-promotions',
  host: { class: 'promotion-workspace' },
  imports: [
    PromotionListComponent,
    PromotionEditorComponent,
    PromotionEnrollmentComponent,
    PromotionPreviewComponent,
  ],
  providers: [PromotionWorkspace],
  templateUrl: './studio-promotions.component.html',
  styleUrl: './studio-promotions.component.css',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudioPromotionsComponent {
  readonly w = inject(PromotionWorkspace);
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmationDialog');
  readonly dialogContent = computed(() => {
    const discard = this.w.discard();
    if (discard)
      return {
        title: 'Discard your changes?',
        message: discard.message,
        label: 'Discard changes',
        danger: true,
      };
    const action = this.w.confirmation();
    const coupon = this.w.active();
    if (!action || !coupon) return null;
    const label = { publish: 'Publish', pause: 'Pause', archive: 'Archive' }[action];
    const message = {
      publish: 'Publish the saved coupon settings and beat enrollment.',
      pause: 'Pausing releases these beats for other coupons.',
      archive: 'This coupon can no longer be edited after archiving.',
    }[action];
    return {
      title: `${label} ${coupon.rules.name}?`,
      message,
      label,
      danger: action === 'archive',
    };
  });

  constructor() {
    afterRenderEffect(() => {
      if (this.w.mode() !== 'list') this.heading().nativeElement.focus();
    });
    afterRenderEffect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.dialogContent() && !dialog.open) dialog.showModal();
      else if (!this.dialogContent() && dialog.open) dialog.close();
    });
  }

  cancelConfirmation(event?: Event) {
    event?.preventDefault();
    this.w.resolveDiscard(false);
    this.w.confirmation.set(null);
  }

  confirm() {
    if (this.w.discard()) this.w.resolveDiscard(true);
    else this.w.applyAction();
  }

  canLeave(): boolean | Promise<boolean> {
    return this.w.canLeave();
  }
}
