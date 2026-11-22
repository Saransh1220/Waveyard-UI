import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

@Component({
  selector: 'app-pagination',
  standalone: true,
  templateUrl: './pagination.component.html',
  styleUrl: './pagination.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaginationComponent {
  currentPage = input.required<number>();
  total = input.required<number>();
  perPage = input.required<number>();
  variant = input<'default' | 'waveyard' | 'studio' | 'admin'>('default');
  showPerPage = input(false);
  perPageOptions = input<number[]>([8, 16, 32, 50]);

  pageChange = output<number>();
  perPageChange = output<number>();

  totalPages = computed(() => Math.ceil(this.total() / this.perPage()));
  protected readonly availablePageSizes = computed(() => {
    const options = this.perPageOptions();
    return options.includes(this.perPage()) ? options : [this.perPage(), ...options];
  });

  startItem = computed(() => {
    if (this.total() === 0) return 0;
    return (this.currentPage() - 1) * this.perPage() + 1;
  });

  endItem = computed(() => Math.min(this.currentPage() * this.perPage(), this.total()));

  visiblePages = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages: number[] = [];

    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);

      if (current > 3) {
        pages.push(-1); // Ellipsis
      }

      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);

      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }

      if (current < total - 2) {
        pages.push(-1); // Ellipsis
      }

      if (!pages.includes(total)) pages.push(total);
    }

    return pages;
  });

  onPageChange(page: number) {
    if (page >= 1 && page <= this.totalPages() && page !== this.currentPage()) {
      this.pageChange.emit(page);
    }
  }

  onPerPageChange(event: Event) {
    const value = parseInt((event.target as HTMLSelectElement).value, 10);
    this.perPageChange.emit(value);
  }
}
