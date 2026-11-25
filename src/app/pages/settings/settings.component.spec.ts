import { SettingsComponent } from './settings.component';

describe('SettingsComponent', () => {
  it('opens the Appearance tab by default', () => {
    expect(new SettingsComponent().activeTab).toBe('appearance');
  });
});
