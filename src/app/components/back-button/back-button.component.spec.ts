import { Location, ViewportScroller } from '@angular/common';
import { ApplicationRef, Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationEnd,
  provideRouter,
  Router,
  RouterOutlet,
  withDisabledInitialNavigation,
  withInMemoryScrolling,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { PageNavigationService } from '../../services/page-navigation.service';
import { BackButtonComponent } from './back-button.component';

@Component({ imports: [BackButtonComponent], template: '<app-back-button />' })
class DetailPage {}

@Component({ template: '' })
class ListPage {}

@Component({ selector: 'test-app', imports: [RouterOutlet], template: '<router-outlet />' })
class TestApp {
  constructor() {
    inject(PageNavigationService);
  }
}

describe('BackButtonComponent', () => {
  let router: Router;
  let host: HTMLElement;
  let scrollPosition: [number, number];
  let maxScrollY: number;
  const scrollToPosition = vi.fn((position: [number, number]) => {
    scrollPosition = [position[0], Math.min(position[1], maxScrollY)];
  });

  beforeEach(() => {
    scrollPosition = [0, 0];
    maxScrollY = Infinity;
    scrollToPosition.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'explore', component: ListPage },
            { path: 'beats/:id', component: DetailPage },
            { path: 'producer/:handle', component: DetailPage },
          ],
          withDisabledInitialNavigation(),
          withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
        ),
        {
          provide: ViewportScroller,
          useValue: {
            getScrollPosition: () => scrollPosition,
            setHistoryScrollRestoration: vi.fn(),
            scrollToPosition,
          },
        },
      ],
    });

    host = document.createElement('div');
    document.body.append(host);
    TestBed.inject(ApplicationRef).bootstrap(TestApp, host);
    router = TestBed.inject(Router);
    router.setUpLocationChangeListener();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    host.remove();
  });

  function clickBack() {
    const finished = firstValueFrom(router.events.pipe(filter((e) => e instanceof NavigationEnd)));
    TestBed.inject(ApplicationRef).tick();
    host.querySelector('button')!.click();
    return finished;
  }

  it('restores the original URL and scroll offset across consecutive back clicks', async () => {
    await router.navigateByUrl('/explore?genres=trap');
    await vi.waitFor(() => expect(scrollToPosition).toHaveBeenLastCalledWith([0, 0]));
    scrollPosition = [0, 840];

    await router.navigateByUrl('/beats/1');
    await vi.waitFor(() => expect(scrollPosition).toEqual([0, 0]));
    scrollPosition = [0, 260];

    await router.navigateByUrl('/producer/old-handle');
    await router.navigateByUrl('/producer/new-handle', { replaceUrl: true });
    await clickBack();
    expect(router.url).toBe('/beats/1');
    await vi.waitFor(() => expect(scrollPosition).toEqual([0, 260]));

    await clickBack();
    expect(router.url).toBe('/explore?genres=trap');
    await vi.waitFor(() => expect(scrollPosition).toEqual([0, 840]));
  });

  it('restores the offset after the previous page grows', async () => {
    let resize: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }

        observe() {}
        disconnect() {}
      },
    );

    await router.navigateByUrl('/explore');
    await vi.waitFor(() => expect(scrollToPosition).toHaveBeenLastCalledWith([0, 0]));
    scrollPosition = [0, 840];
    await router.navigateByUrl('/beats/1');
    await vi.waitFor(() => expect(scrollPosition).toEqual([0, 0]));

    maxScrollY = 400;
    await clickBack();
    await vi.waitFor(() => expect(resize).toBeDefined());
    expect(scrollPosition).toEqual([0, 400]);

    maxScrollY = 1000;
    resize!();
    expect(scrollPosition).toEqual([0, 840]);
  });

  it('replaces a directly opened detail page with the fallback', async () => {
    await router.navigateByUrl('/beats/1', { replaceUrl: true });
    const back = vi.spyOn(TestBed.inject(Location), 'back');
    await clickBack();
    expect(router.url).toBe('/explore');
    expect(back).not.toHaveBeenCalled();
  });
});
