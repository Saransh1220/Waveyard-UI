import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LabService } from '../../services/lab';
import { SpecUploadService } from '../../services/spec-upload.service';
import { SpecUploadMonitorService } from '../../services/spec-upload-monitor.service';
import { ToastService } from '../../services/toast.service';
import { UploadComponent } from './upload.component';

describe('UploadComponent (rendered layout)', () => {
  let fixture: ComponentFixture<UploadComponent>;
  let component: UploadComponent;
  let el: HTMLElement;

  function markRequiredFilesUploaded() {
    component.uploadSessionId.set('upload-1');
    component.fileUploadStates.set({
      cover: { phase: 'uploaded', progress: 100 },
      preview: { phase: 'uploaded', progress: 100 },
      wav: { phase: 'uploaded', progress: 100 },
      stems: { phase: 'uploaded', progress: 100 },
    });
    component.previewFile.set(new File(['x'], 'p.mp3'));
    component.wavFile.set(new File(['x'], 'p.wav'));
    component.stemsFile.set(new File(['x'], 'p.zip'));
  }

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [UploadComponent],
      providers: [
        { provide: AuthService, useValue: { currentUser: signal(null) } },
        { provide: LabService, useValue: { notifyRefresh: vi.fn() } },
        { provide: SpecUploadMonitorService, useValue: { monitor: vi.fn() } },
        {
          provide: SpecUploadService,
          useValue: {
            createDraft: vi.fn(),
            uploadFile: vi.fn(),
            publishBeat: vi.fn(),
            completeUpload: vi.fn(),
          },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ToastService, useValue: { show: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(UploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('renders the form sections together with the live preview and checklist', () => {
    expect(el.querySelector('h1')?.textContent).toContain('Upload a beat');
    expect(
      Array.from(el.querySelectorAll('.upload-section h2'), (heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(['Assets', 'Track details', 'Licenses and pricing']);
    expect(el.querySelector('aside h2')?.textContent).toContain('Live preview');
    expect(el.querySelector('.checklist li button')).toBeTruthy();
  });

  it('lists the three audio files, all required for a beat', () => {
    const rows = el.querySelectorAll('.audio-group .file-row');
    expect(rows.length).toBe(3);
    const pills = Array.from(rows).map((row) =>
      row.querySelector('.optional')?.textContent?.trim(),
    );
    expect(pills).toEqual([undefined, undefined, undefined]);
    expect(rows[0].querySelector('label input')?.getAttribute('aria-label')).toBe(
      'Choose MP3 preview',
    );
  });

  it('marks WAV and stems optional when the upload is not a beat', () => {
    // The category is set before the first render, as the form is OnPush and reads plain form state.
    const sample = TestBed.createComponent(UploadComponent);
    sample.componentInstance.uploadForm.patchValue({ category: 'sample' });
    sample.detectChanges();
    const pills = Array.from(
      (sample.nativeElement as HTMLElement).querySelectorAll('.file-row .optional'),
    ).map((p) => p.textContent?.trim());
    expect(pills).toEqual(['Optional', 'Optional']);
    expect(sample.componentInstance.isFileRequired('wav')).toBe(false);
    expect(sample.componentInstance.isFileRequired('preview')).toBe(true);
  });

  it('shows the selected file name and lets the user remove it', () => {
    component.previewFile.set(new File(['x'], 'beat.mp3'));
    component.previewSummary.set({ name: 'beat.mp3', size: '1 MB' });
    fixture.detectChanges();

    expect(component.fileSummary('preview')).toEqual({ name: 'beat.mp3', size: '1 MB' });
    const row = el.querySelector('.file-row') as HTMLElement;
    expect(row.querySelector('.file-name')?.textContent).toContain('beat.mp3 · 1 MB');
    expect(row.querySelector('label input')?.getAttribute('aria-label')).toBe(
      'Replace MP3 preview',
    );

    (row.querySelector('.file-remove') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.previewFile()).toBeNull();
    expect(component.fileSummary('preview')).toBeNull();
    expect(el.querySelector('.file-row .file-remove')).toBeNull();
  });

  it('shows upload progress for a file slot', () => {
    component.fileUploadStates.update((states) => ({
      ...states,
      wav: { phase: 'uploading', progress: 42 },
    }));
    fixture.detectChanges();
    const transfer = el.querySelectorAll('.file-row')[1].querySelector('.transfer') as HTMLElement;
    expect(transfer.textContent).toContain('Uploading 42%');
    expect(transfer.getAttribute('data-phase')).toBe('uploading');
  });

  it('highlights the stems drop zone and accepts a dropped archive', () => {
    const zone = el.querySelectorAll('.file-row')[2];
    const file = new File(['stems'], 'trackouts.zip', { type: 'application/zip' });
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
    const dispatchDrag = (name: string) => {
      const event = new Event(name, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      zone.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };

    expect(dispatchDrag('dragover').defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe('copy');
    expect(zone.classList.contains('drag-active')).toBe(true);
    dispatchDrag('dragleave');
    expect(zone.classList.contains('drag-active')).toBe(false);
    dispatchDrag('dragover');
    expect(dispatchDrag('drop').defaultPrevented).toBe(true);
    expect(zone.classList.contains('drag-active')).toBe(false);
    expect(component.stemsFile()).toBe(file);
    expect(zone.querySelector('.file-name')?.textContent).toContain(file.name);
  });

  it('shows the cover preview and a remove action once cover art is chosen', () => {
    expect(el.querySelector('.cover-drop img')).toBeNull();
    component.coverFile.set(new File(['x'], 'c.png'));
    component.coverPreviewUrl.set('data:image/png;base64,AAAA');
    fixture.detectChanges();

    expect(el.querySelector('.cover-drop img')).not.toBeNull();
    expect(el.querySelector('.cover-overlay')?.textContent).toContain('Replace');
    (el.querySelector('.cover-copy .link-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.coverFile()).toBeNull();
    expect(el.querySelector('.cover-drop img')).toBeNull();
  });

  it('toggles mood chips, tags and licenses from the form', () => {
    const chip = el.querySelector('.chips .chip') as HTMLButtonElement;
    const mood = chip.textContent?.trim() ?? '';
    const before = component.isMoodSelected(mood);
    chip.click();
    fixture.detectChanges();
    expect(component.isMoodSelected(mood)).toBe(!before);
    expect(chip.getAttribute('aria-pressed')).toBe(String(!before));

    const tagField = el.querySelector('.tag-input input') as HTMLInputElement;
    tagField.value = 'dark';
    tagField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(component.tags.length).toBe(1);
    expect(el.querySelector('.tag')?.textContent).toContain('dark');
    (el.querySelector('.tag button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.tags.length).toBe(0);

    const firstSwitch = el.querySelector('.license .switch') as HTMLButtonElement;
    const enabled = component.licenses.at(0).get('enabled')?.value;
    const previewCount = el.querySelectorAll('.preview-licenses li').length;
    const priceInput = el.querySelector('.license .price input') as HTMLInputElement;
    expect(priceInput.disabled).toBe(!enabled);
    firstSwitch.click();
    fixture.detectChanges();
    expect(component.licenses.at(0).get('enabled')?.value).toBe(!enabled);
    expect(priceInput.disabled).toBe(!!enabled);
    expect(el.querySelectorAll('.preview-licenses li')).toHaveLength(
      previewCount + (enabled ? -1 : 1),
    );
  });

  it('keeps a tier price and validation feedback visible when its editor is collapsed', () => {
    const tiers = el.querySelectorAll<HTMLDetailsElement>('.license-details');
    expect(Array.from(tiers, (tier) => tier.open)).toEqual([true, false, false, false]);

    const basic = component.licenses.at(0);
    basic.patchValue({ price: '28.50' });
    tiers[0].open = false;
    fixture.detectChanges();
    expect(tiers[0].querySelector('summary')?.textContent).toContain('28.50');

    basic.patchValue({ nativeError: 'Enter a valid price.' });
    fixture.detectChanges();
    expect(tiers[0].querySelector('summary')?.textContent).toContain('Check prices');
  });

  it('toggles the free MP3 download switch', () => {
    const toggle = el.querySelector('.free-row .switch') as HTMLButtonElement;
    expect(component.f['freeMp3Enabled'].value).toBe(false);
    toggle.click();
    fixture.detectChanges();
    expect(component.f['freeMp3Enabled'].value).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('reflects the draft in the live preview', () => {
    expect(el.querySelector('.preview-title')?.textContent).toContain('Untitled beat');
    component.uploadForm.patchValue({ title: 'Violet Hour', genre: 'Trap', bpm: 140 as never });
    fixture.detectChanges();
    expect(el.querySelector('.preview-title')?.textContent).toContain('Violet Hour');
    expect(el.querySelector('.preview-meta')?.textContent).toContain('140 BPM');
    expect(el.querySelectorAll('.preview-licenses li').length).toBe(
      component.selectedLicenses().length,
    );
  });

  it('updates the publish checklist as requirements are met', () => {
    const items = () => Array.from(el.querySelectorAll('.checklist li'));
    expect(items().filter((li) => li.classList.contains('ok')).length).toBe(1);

    markRequiredFilesUploaded();
    component.uploadForm.patchValue({ title: 'Violet Hour', genre: 'Trap' });
    fixture.detectChanges();
    expect(items().filter((li) => li.classList.contains('ok')).length).toBe(3);
    expect(items()[1].textContent).toContain('3 / 3 uploaded');
    component.f.bpm.setValue(140 as never);
    fixture.detectChanges();
    expect(items().every((li) => li.classList.contains('ok'))).toBe(true);
  });

  it('only enables Publish once the required files are uploaded, and publishes on click', () => {
    const publish = el.querySelector('.act.primary') as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(el.querySelector('.upload-footer p')?.textContent).toContain(
      'Waiting for required files',
    );

    markRequiredFilesUploaded();
    const submit = vi.spyOn(component, 'submitUpload').mockImplementation(() => undefined);
    const save = vi.spyOn(component, 'saveDraft').mockImplementation(() => undefined);
    fixture.detectChanges();
    expect(publish.disabled).toBe(false);
    expect(publish.textContent).toContain('Publish beat');
    expect(el.querySelector('.upload-footer p')?.textContent).toContain('uploaded');

    publish.click();
    (el.querySelector('.act.ghost') as HTMLButtonElement).click();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('focuses invalid track details when publishing', () => {
    markRequiredFilesUploaded();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.act.primary')!.click();
    fixture.detectChanges();
    expect(document.activeElement?.id).toBe('upload-details');
    expect(el.querySelector('[aria-labelledby="upload-details"]')?.textContent).toContain(
      'BPM is required.',
    );
  });

  it('exposes the audio row definitions used by the template', () => {
    expect(component.audioRows.map((row) => row.type)).toEqual(['preview', 'wav', 'stems']);
    expect(component.audioRows.every((row) => row.accept.length > 0)).toBe(true);
  });
});
