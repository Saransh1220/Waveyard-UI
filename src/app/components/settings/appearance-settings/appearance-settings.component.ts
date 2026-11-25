import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-appearance-settings',
  standalone: true,
  templateUrl: './appearance-settings.component.html',
  styleUrls: ['./appearance-settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppearanceSettingsComponent {}
