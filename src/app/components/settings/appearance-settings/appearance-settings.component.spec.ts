import { TestBed } from '@angular/core/testing';
import { AppearanceSettingsComponent } from './appearance-settings.component';

describe('AppearanceSettingsComponent', () => {
  it('shows a read-only preview of Waveyard’s dark appearance', async () => {
    await TestBed.configureTestingModule({
      imports: [AppearanceSettingsComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppearanceSettingsComponent);
    fixture.detectChanges();

    const appearance: HTMLElement = fixture.nativeElement;
    expect(appearance.querySelector('h1')?.textContent).toBe('Appearance');
    expect(appearance.textContent).toContain('Waveyard uses a dark appearance.');
    expect(appearance.querySelector('.mockup-window')).not.toBeNull();
    expect(appearance.querySelector('button, input, select')).toBeNull();
  });
});
