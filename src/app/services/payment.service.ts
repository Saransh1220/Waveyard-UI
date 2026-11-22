import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  catchError,
  defer,
  EMPTY,
  expand,
  finalize,
  map,
  Observable,
  of,
  switchMap,
  tap,
  throwError,
  timer,
} from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CreateOrderBody,
  CreateOrderRequest,
  CreateRefundRequest,
  GetCheckoutQuoteRequest,
  GetLicenseDownloadsRequest,
  GetOrderRefundsRequest,
  GetOrderRequest,
  GetOrderStatusRequest,
  GetProducerOrdersRequest,
  GetUserLicensesRequest,
  ProducerOrderResponse,
  VerifyPaymentRequest,
} from '../core/api/payment.requests';
import { BRAND } from '../core/config/brand';
import { ApiService } from '../core/services/api.service';
import type { Money, SelectedPriceOffer } from '../models/money';
import {
  CheckoutQuote,
  License,
  LicenseDownloadsResponse,
  Order,
  OrderRefund,
  OrderRefundResponse,
  OrderStatusDto,
  PaginationMetadata,
  PaymentVerificationRequest,
  RazorpayOptions,
  RazorpayResponse,
} from '../models/payment';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

interface QuotedCheckoutIntent {
  key: string;
  quote: CheckoutQuote;
  previouslyLegacy?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PaymentService {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  private router = inject(Router);

  // Track active licenses
  // Track active licenses - moved down to keep together with pagination
  // userLicenses = signal<License[]>([]);

  private razorpayCheckoutOpen = false;
  private readonly quotedIntents = new Map<string, QuotedCheckoutIntent>();
  private readonly unreservedLegacyKeys = new Set<string>();
  readonly isInitiatingPayment = signal<boolean>(false);

  getCheckoutQuote(specId: string, licenseOptionId: string, currency?: string | null) {
    return this.api.execute(new GetCheckoutQuoteRequest(specId, licenseOptionId, currency));
  }

  resumeQuote(specId: string, licenseOptionId: string): CheckoutQuote | undefined {
    return this.readQuoteIntent(this.intentKey(specId, licenseOptionId))?.quote;
  }

  hasLegacyCheckout(specId: string, licenseOptionId: string): boolean {
    const key = this.readLegacyKey(this.intentKey(specId, licenseOptionId));
    return !!key && !this.unreservedLegacyKeys.has(key);
  }

  private intentKey(specId: string, licenseOptionId: string): string {
    const userId = this.auth.currentUser()?.id ?? 'guest';
    return `waveyard_checkout_intent_${userId}_${specId}_${licenseOptionId}`;
  }

  private readQuoteIntent(storageKey: string): QuotedCheckoutIntent | undefined {
    const cached = this.quotedIntents.get(storageKey);
    if (cached) return cached;
    try {
      const intent = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (typeof intent?.key === 'string' && intent.quote?.quote_id && intent.quote.offer) {
        return intent;
      }
    } catch {
      // Previous app versions stored a plain idempotency key.
    }
    return undefined;
  }

  private readLegacyKey(storageKey: string): string | undefined {
    try {
      const key = sessionStorage.getItem(storageKey);
      if (key && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(key)) return key;
    } catch {
      // Session storage can be unavailable.
    }
    return undefined;
  }

  /**
   * Create an order and open checkout with explicit evidence and idempotency protection
   */
  initiatePayment(
    specId: string,
    licenseOptionId: string,
    specTitle: string,
    evidence?: {
      selectedPrice?: SelectedPriceOffer;
      displayPriceMoney?: Money;
      priceMoney?: Money;
      quote?: CheckoutQuote;
      resuming?: boolean;
      resumeLegacy?: boolean;
    },
  ): Observable<Order> {
    return defer(() => {
      if (this.isInitiatingPayment() || this.razorpayCheckoutOpen) {
        return EMPTY;
      }
      this.isInitiatingPayment.set(true);

      const intentStorageKey = this.intentKey(specId, licenseOptionId);
      const previous = this.readQuoteIntent(intentStorageKey);
      const legacyKey = previous ? undefined : this.readLegacyKey(intentStorageKey);
      const quote = evidence?.quote;
      const resumeLegacy = evidence?.resumeLegacy === true;
      if (resumeLegacy && !legacyKey) {
        this.isInitiatingPayment.set(false);
        return EMPTY;
      }
      if (previous && previous.quote.quote_id !== quote?.quote_id) {
        this.isInitiatingPayment.set(false);
        return throwError(() => ({ error: { code: 'CHECKOUT_QUOTE_REVIEW_REQUIRED' } }));
      }
      const idempotencyKey = previous?.key ?? legacyKey ?? crypto.randomUUID();
      const previouslyLegacy = previous?.previouslyLegacy || !!legacyKey;
      const clearIntent = () => {
        this.quotedIntents.delete(intentStorageKey);
        this.unreservedLegacyKeys.delete(idempotencyKey);
        try {
          sessionStorage.removeItem(intentStorageKey);
        } catch {}
      };
      const restoreLegacyKey = (checkForOrder: boolean) => {
        this.quotedIntents.delete(intentStorageKey);
        if (checkForOrder) this.unreservedLegacyKeys.delete(idempotencyKey);
        else this.unreservedLegacyKeys.add(idempotencyKey);
        try {
          sessionStorage.setItem(intentStorageKey, idempotencyKey);
        } catch {}
      };
      try {
        if (!quote && !resumeLegacy) {
          sessionStorage.setItem(intentStorageKey, idempotencyKey);
        }
      } catch {
        // Quoted retries also survive unavailable session storage in this tab.
      }
      if (quote) {
        const intent = { key: idempotencyKey, quote, previouslyLegacy };
        this.quotedIntents.set(intentStorageKey, intent);
        try {
          sessionStorage.setItem(intentStorageKey, JSON.stringify(intent));
        } catch {}
      }

      const body: CreateOrderBody = {
        spec_id: specId,
        license_option_id: licenseOptionId,
      };

      if (resumeLegacy) {
        body.resume_only = true;
      } else if (quote) {
        body.currency = quote.requested_currency;
        body.expected_price_id = quote.offer.price_id;
        body.expected_revision = quote.offer.revision;
        body.expected_amount_minor = quote.offer.amount_minor;
        body.expected_currency = quote.offer.currency;
        body.quote_id = quote.quote_id;
      } else if (evidence?.selectedPrice) {
        body.currency = evidence.selectedPrice.currency;
        body.expected_price_id = evidence.selectedPrice.price_id;
        body.expected_revision = evidence.selectedPrice.revision;
        body.expected_amount_minor = evidence.selectedPrice.amount_minor;
        body.expected_currency = evidence.selectedPrice.currency;
      } else if (evidence?.displayPriceMoney) {
        body.currency = evidence.displayPriceMoney.currency;
        body.expected_amount_minor = evidence.displayPriceMoney.amount_minor;
        body.expected_currency = evidence.displayPriceMoney.currency;
      }

      // Step 1: Create order on backend with Idempotency-Key
      return this.api.execute(new CreateOrderRequest(body, idempotencyKey)).pipe(
        switchMap((order) => {
          if ('code' in order) {
            const message =
              order.code === 'CHECKOUT_RECONCILING'
                ? 'We’re verifying your checkout with the payment provider. Try again in a moment.'
                : 'Checkout is currently in progress. Please wait a moment...';
            this.toast.show(message, 'info');
            return EMPTY;
          }
          if (
            order.status === 'paid' ||
            order.status === 'refunded' ||
            order.status === 'failed' ||
            order.status === 'cancelled'
          ) {
            clearIntent();
            if (
              (evidence?.resuming || resumeLegacy) &&
              (order.status === 'failed' || order.status === 'cancelled')
            ) {
              this.toast.show(
                'The earlier checkout is closed. You can use the current price.',
                'info',
              );
              return EMPTY;
            }
            void this.router.navigate(['/payment/return'], { queryParams: { order_id: order.id } });
            return of(order);
          }
          if (order.checkout_url) {
            window.location.assign(order.checkout_url);
          } else if (order.razorpay_order_id) {
            this.openRazorpayCheckout(order, specTitle);
          }
          return of(order);
        }),
        catchError((error) => {
          const code = error?.error?.code;
          if (error?.status === 202 || code === 'CHECKOUT_IN_FLIGHT') {
            this.toast.show('Checkout is currently in progress. Please wait a moment...', 'info');
          } else if (resumeLegacy && error?.status === 404 && code === 'CHECKOUT_NOT_FOUND') {
            // Reuse the key if the buyer confirms a new quote, in case the old request is still committing.
            this.unreservedLegacyKeys.add(idempotencyKey);
            this.toast.show(
              'The earlier checkout was not started. Review the current price.',
              'info',
            );
            return EMPTY;
          } else if (error?.status === 409 && code === 'IDEMPOTENCY_CONFLICT') {
            if (quote && previouslyLegacy) {
              restoreLegacyKey(true);
              this.toast.show('Your earlier checkout is available to resume.', 'info');
              return EMPTY;
            }
            if (!quote && !resumeLegacy) clearIntent();
            this.toast.show(
              'A checkout with different details already exists. Check your orders before trying again.',
              'error',
            );
          } else if (code === 'PRICE_CHANGED' || code === 'PRICE_UNAVAILABLE') {
            if (quote && previouslyLegacy) restoreLegacyKey(false);
            else clearIntent();
            if (!quote) this.toast.show('Price changed. Please review the updated offer.', 'info');
          } else if (error?.status === 401) {
            if (!previous && !resumeLegacy) {
              if (quote && previouslyLegacy) restoreLegacyKey(true);
              else clearIntent();
            }
            this.toast.show('Sign in to continue to checkout.', 'info');
          } else {
            this.toast.show('Failed to create order. Please try again.', 'error');
          }
          return throwError(() => error);
        }),
        finalize(() => this.isInitiatingPayment.set(false)),
      );
    });
  }

  /**
   * Open Razorpay checkout modal
   */
  private openRazorpayCheckout(order: Order, specTitle: string): void {
    if (typeof window === 'undefined' || typeof (window as any).Razorpay === 'undefined') {
      this.toast.show(
        'Razorpay SDK failed to load. Please check your connection and try again.',
        'error',
      );
      return;
    }

    const user = this.auth.currentUser();

    const options: RazorpayOptions = {
      key: environment.razorpayKeyId,
      amount: order.amount,
      currency: order.currency,
      name: BRAND.name,
      description: `Purchase ${specTitle}`,
      order_id: order.razorpay_order_id!,
      prefill: {
        name: user?.name || '',
        email: user?.email || '',
      },
      theme: {
        color: '#6366f1',
      },
      handler: (response: RazorpayResponse) => {
        this.razorpayCheckoutOpen = false;
        this.handlePaymentSuccess(order.id, response);
      },
      modal: {
        ondismiss: () => {
          this.razorpayCheckoutOpen = false;
          this.toast.show('Payment cancelled', 'info');
        },
      },
    };

    const razorpay = new window.Razorpay(options);
    this.razorpayCheckoutOpen = true;
    try {
      razorpay.open();
    } catch (error) {
      this.razorpayCheckoutOpen = false;
      throw error;
    }
  }

  /**
   * Handle successful payment from Razorpay
   */
  private handlePaymentSuccess(orderId: string, response: RazorpayResponse): void {
    const verificationData: PaymentVerificationRequest = {
      order_id: orderId,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature,
    };

    // Fast-path client verification, always route to payment return page
    this.api
      .execute(new VerifyPaymentRequest(verificationData))
      .pipe(
        tap(() => {
          this.fetchUserLicenses().subscribe();
        }),
        catchError(() => {
          // If fast-path returns error or hangs, return page polling and webhook will resolve it
          return of(null);
        }),
      )
      .subscribe(() => {
        this.router.navigate(['/payment/return'], { queryParams: { order_id: orderId } });
      });
  }

  /**
   * Get single order status snapshot
   */
  getOrder(orderId: string): Observable<Order> {
    return this.api.execute(new GetOrderRequest(orderId));
  }

  getOrderStatus(orderId: string): Observable<OrderStatusDto> {
    return this.api.execute(new GetOrderStatusRequest(orderId));
  }

  /**
   * Poll order status until terminal status or timeout (easing interval, capped at 90s)
   */
  pollOrderStatus(orderId: string, maxDurationMs: number = 90000): Observable<OrderStatusDto> {
    const startTime = Date.now();
    let currentDelayMs = 2000;

    return defer(() => this.getOrderStatus(orderId)).pipe(
      expand((status) => {
        const elapsed = Date.now() - startTime;
        const terminalStatuses: string[] = ['paid', 'failed', 'cancelled', 'refunded'];
        if (terminalStatuses.includes(status.status) || elapsed >= maxDurationMs) {
          return EMPTY;
        }

        const delayMs =
          status.retry_after_seconds > 0
            ? status.retry_after_seconds * 1000
            : Math.min(currentDelayMs * 1.5, 5000);
        currentDelayMs = delayMs;

        return timer(delayMs).pipe(switchMap(() => this.getOrderStatus(orderId)));
      }),
    );
  }

  // Track active licenses and pagination
  userLicenses = signal<License[]>([]);
  licensePagination = signal<PaginationMetadata | null>(null);

  /**
   * Fetch user's licenses
   */
  fetchUserLicenses(
    page: number = 1,
    limit: number = 8,
    search?: string,
    licenseType?: string,
  ): Observable<License[]> {
    const params: any = { page, limit };
    if (search) params.q = search;
    if (licenseType && licenseType !== 'ALL') params.type = licenseType; // Handle 'ALL' case

    return this.api.execute(new GetUserLicensesRequest(params)).pipe(
      tap((response: any) => {
        // Handle both new paginated response and old flat array for robustness
        const data = response?.data || (Array.isArray(response) ? response : []);
        const metadata = response?.metadata || null;

        this.userLicenses.set(data);
        this.licensePagination.set(metadata);
      }),
      map((response: any) => response?.data || (Array.isArray(response) ? response : [])),
      catchError((error) => {
        console.error('Failed to fetch licenses', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Check if user has purchased a license for a spec
   */
  hasLicenseForSpec(specId: string): boolean {
    return this.userLicenses().some(
      (license) => license.spec_id === specId && license.is_active && !license.is_revoked,
    );
  }

  /**
   * Get download URLs for a license
   */
  getLicenseDownloads(licenseId: string): Observable<LicenseDownloadsResponse> {
    return this.api.execute(new GetLicenseDownloadsRequest(licenseId));
  }

  /**
   * Get orders for producer (sales)
   */
  getProducerOrders(page: number = 1, limit: number = 10): Observable<ProducerOrderResponse> {
    return this.api.execute(new GetProducerOrdersRequest(page, limit));
  }

  /**
   * Admin: Initiate full refund for an order
   */
  refundOrder(orderId: string, reason: string, notes?: string): Observable<OrderRefundResponse> {
    const idempotencyKey = crypto.randomUUID();
    return this.api.execute(new CreateRefundRequest(orderId, { reason, notes }, idempotencyKey));
  }

  /**
   * Admin: Get refund records for an order
   */
  getOrderRefunds(orderId: string): Observable<OrderRefund[]> {
    return this.api
      .execute(new GetOrderRefundsRequest(orderId))
      .pipe(map((res) => res?.data || []));
  }
}
