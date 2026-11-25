import { DOCUMENT, Location, ViewportScroller } from '@angular/common';
import { DestroyRef, inject, Injectable, NgZone } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router, Scroll } from '@angular/router';

interface PageHistoryState {
  waveyardHasPreviousPage?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PageNavigationService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);
  private readonly viewport = inject(ViewportScroller);
  private readonly zone = inject(NgZone);

  private leavingPath = '';
  private leavingState: PageHistoryState | null = null;
  private stopRestoring?: () => void;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopRestoring?.());
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.stopRestoring?.();
        this.leavingPath = this.location.path(true);
        this.leavingState = this.location.getState() as PageHistoryState | null;
      } else if (event instanceof NavigationEnd) {
        this.recordHistoryEntry();
      } else if (event instanceof Scroll && event.scrollBehavior !== 'manual') {
        const position = event.position;
        const navigation =
          this.router.currentNavigation() ?? this.router.lastSuccessfulNavigation();
        if (position && event.routerEvent.id === navigation?.id) {
          this.zone.runOutsideAngular(() => this.restoreAfterResize(position));
        }
      }
    });
  }

  back(fallbackUrl: string): void {
    const state = this.location.getState() as PageHistoryState | null;
    if (state?.waveyardHasPreviousPage) {
      this.location.back();
    } else {
      void this.router.navigateByUrl(fallbackUrl, { replaceUrl: true });
    }
  }

  private recordHistoryEntry(): void {
    const navigation = this.router.currentNavigation();
    if (!navigation || navigation.extras.skipLocationChange) return;

    const path = this.location.path(true);
    const state = this.location.getState() as PageHistoryState | null;
    // A replace or a browser history traversal keeps the destination entry's own flag.
    const pushed =
      navigation.trigger === 'imperative' &&
      !!navigation.previousNavigation &&
      !navigation.extras.replaceUrl &&
      path !== this.leavingPath;
    if ((pushed || this.leavingState?.waveyardHasPreviousPage) && !state?.waveyardHasPreviousPage) {
      this.location.replaceState(path, '', { ...state, waveyardHasPreviousPage: true });
    }
  }

  private restoreAfterResize(position: [number, number]): void {
    const window = this.document.defaultView;
    if (!window || typeof ResizeObserver === 'undefined') return;

    const reachedPosition = () => {
      const [x, y] = this.viewport.getScrollPosition();
      return Math.abs(x - position[0]) < 1 && Math.abs(y - position[1]) < 1;
    };
    // The router tries first. A page that is still loading may be too short to reach the offset.
    if (reachedPosition()) return;

    this.stopRestoring?.();
    const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    const observer = new ResizeObserver(() => {
      this.viewport.scrollToPosition(position, { behavior: 'instant' });
      if (reachedPosition()) stop();
    });
    const stop = () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      for (const event of inputEvents) window.removeEventListener(event, stop);
      this.stopRestoring = undefined;
    };
    const timeout = window.setTimeout(stop, 5000);
    this.stopRestoring = stop;
    for (const event of inputEvents) window.addEventListener(event, stop, { passive: true });
    observer.observe(this.document.body);
  }
}
