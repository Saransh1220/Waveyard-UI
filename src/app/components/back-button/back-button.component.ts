import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { PageNavigationService } from '../../services/page-navigation.service';

@Component({
  selector: 'app-back-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" aria-label="Back" title="Back" (click)="navigation.back(fallbackUrl())">
      <i class="fas fa-arrow-left" aria-hidden="true"></i>
    </button>
  `,
  styleUrl: './back-button.component.scss',
})
export class BackButtonComponent {
  readonly fallbackUrl = input('/explore');
  protected readonly navigation = inject(PageNavigationService);
}
