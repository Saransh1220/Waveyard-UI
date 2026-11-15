import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { CurrencyPriceFieldComponent } from '../../../components/currency-price-field/currency-price-field.component';
import { UploadFormBase } from '../../upload/upload-form.base';

@Component({
  selector: 'app-studio-upload',
  imports: [CommonModule, ReactiveFormsModule, CurrencyPriceFieldComponent],
  templateUrl: '../../../pages/upload/upload.component.html',
  styleUrls: ['../../../pages/upload/upload.component.scss'],
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      .upload-page-container {
        min-height: auto;
        padding: 0;
        background: transparent;
      }
      .upload-shell {
        padding: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudioUploadComponent extends UploadFormBase {
  override successRoute = ['/studio/tracks'];
  override closeRoute = '/studio/tracks';
}
