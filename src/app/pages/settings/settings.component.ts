import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AppearanceSettingsComponent } from '../../components/settings/appearance-settings/appearance-settings.component';
import { BRAND } from '../../core/config/brand';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [AppearanceSettingsComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  readonly brand = BRAND;
  activeTab: 'appearance' | 'preferences' | 'account' = 'appearance';
}
