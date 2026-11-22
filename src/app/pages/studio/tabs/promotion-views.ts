import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Renderer2,
  inject,
  input,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { PaginationComponent } from '../../../shared/components/pagination/pagination.component';
import { PromotionWorkspace } from './promotion-workspace';

@Directive({
  selector: 'button[promotionToggle]',
  host: { '[attr.aria-pressed]': 'pressed()' },
})
export class PromotionToggleDirective {
  readonly pressed = input.required<boolean>({ alias: 'promotionToggle' });
}

@Directive({
  selector: 'details[promotionDisclosure]',
  exportAs: 'promotionDisclosure',
  host: {
    '(toggle)': 'onToggle()',
    '(keydown.escape)': 'onEscape($event)',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class PromotionDisclosureDirective {
  private readonly details = inject<ElementRef<HTMLDetailsElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);
  private stopListening?: () => void;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopListening?.());
  }

  onToggle() {
    this.stopListening?.();
    this.stopListening = this.details.open
      ? this.renderer.listen('document', 'pointerdown', (event: PointerEvent) => {
          if (!event.composedPath().includes(this.details)) this.close();
        })
      : undefined;
  }

  close(restoreFocus = false) {
    this.details.open = false;
    if (restoreFocus) this.details.querySelector('summary')?.focus();
  }

  onEscape(event: Event) {
    if (!this.details.open) return;
    event.stopPropagation();
    this.close(true);
  }

  onFocusOut(event: FocusEvent) {
    if (event.relatedTarget instanceof Node && !this.details.contains(event.relatedTarget)) {
      this.close();
    }
  }
}

@Component({
  selector: 'app-promotion-list',
  imports: [DatePipe, PromotionDisclosureDirective],
  templateUrl: './promotion-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromotionListComponent {
  readonly w = inject(PromotionWorkspace);
}

@Component({
  selector: 'app-promotion-editor',
  imports: [ReactiveFormsModule, PromotionToggleDirective],
  templateUrl: './promotion-editor.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromotionEditorComponent {
  readonly w = inject(PromotionWorkspace);
}

@Component({
  selector: 'app-promotion-enrollment',
  imports: [PaginationComponent, PromotionToggleDirective, PromotionDisclosureDirective],
  templateUrl: './promotion-enrollment.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromotionEnrollmentComponent {
  readonly w = inject(PromotionWorkspace);
}

@Component({
  selector: 'app-promotion-preview',
  templateUrl: './promotion-preview.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromotionPreviewComponent {
  readonly w = inject(PromotionWorkspace);
}
