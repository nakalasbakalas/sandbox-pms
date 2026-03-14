# Payment Architecture — Sandbox Hotel PMS

## Overview

The Sandbox Hotel PMS Payment Integration layer provides reservation-linked
financial tracking with support for hosted checkout, manual payment recording,
deposit collection, refunds, adjustments, and reconciliation.

### Design Principles

- **Hosted checkout only** — no raw card data touches the PMS; PCI scope is minimised.
- **Provider-agnostic adapter** — centralised `PaymentProviderBase` interface with
  Stripe, test-hosted, and disabled implementations.
- **Immutable folio ledger** — every financial event creates a `FolioCharge` record;
  corrections use void/reversal, never overwrites.
- **Idempotent processing** — unique `posting_key` on charges and
  `provider_event_id` on events prevent duplicate recording.
- **Audit by default** — all material changes produce `AuditLog`, `CashierActivityLog`,
  and `PaymentEvent` entries.

---

## Domain Models

### Reservation (extended)

| Field                   | Purpose                                        |
|-------------------------|------------------------------------------------|
| `deposit_required_amount` | Deposit target set at booking                 |
| `deposit_received_amount` | Running deposit total (synced from folio)     |
| `payment_status`          | Cached settlement state for queries           |

**Payment statuses**: `unpaid`, `partially_paid`, `paid`, `deposit_required`,
`deposit_received`, `overpaid`, `refunded`, `failed`, `pending`, `voided`.

### FolioCharge

Every financial line item on a reservation's folio/bill. Charge types include
`room`, `tax`, `deposit`, `payment`, `refund`, `fee`, `adjustment`, `correction`.

Charge codes map to operational categories: `RM`, `VAT`, `DEP`, `DEP_APPL`,
`PMT-CASH`, `PMT-QR`, `PMT-CARD`, `PMT-BANK`, `REF`, `ADJ_POS`, `ADJ_NEG`, `CORR`.

### PaymentRequest

Represents a request for payment — typically a hosted checkout link for deposit
collection. Lifecycle statuses: `pending` → `paid` | `expired` | `cancelled` | `failed`.

### PaymentEvent

Provider event audit trail. Stores raw webhook payloads, provider event IDs,
and processed timestamps. Unique constraint on `(provider, provider_event_id)`
prevents duplicate webhook processing.

### CashierDocument

Issued financial documents (folio, invoice, receipt) with sequential numbering.

### CashierActivityLog

Detailed event log for all cashier operations including payment posts, voids,
refunds, and document issuance.

### AuditLog

Comprehensive before/after audit trail for all entity changes. Captures actor,
action, diff, IP address, and request ID.

---

## Payment Provider Adapter Architecture

```
PaymentProviderBase (abstract)
├── create_checkout(payment_request, return_url) → HostedCheckoutResult
├── verify_and_parse_webhook(request_data, headers) → NormalizedProviderEvent
└── retrieve_status(provider_reference) → NormalizedProviderEvent

Implementations:
├── StripeHostedPaymentProvider   — Stripe Checkout Sessions
├── TestHostedPaymentProvider     — HMAC-SHA256 test provider
└── DisabledPaymentProvider       — graceful no-op
```

### Adding a New Provider

1. Create a class extending `PaymentProviderBase` in `payment_integration_service.py`.
2. Implement `create_checkout()`, `verify_and_parse_webhook()`, and `retrieve_status()`.
3. Register in `get_payment_provider()` factory function.
4. Add provider name to admin settings UI options.
5. Set environment variables for provider credentials.

---

## Payment States and Transaction Types

### Reservation Payment Status

| Status             | Meaning                                     |
|--------------------|---------------------------------------------|
| `unpaid`           | No payments received                        |
| `partially_paid`   | Some payment but balance remains            |
| `paid`             | Balance fully settled                       |
| `deposit_required` | Deposit expected but not yet received       |
| `deposit_received` | Deposit collected, stay balance outstanding |
| `overpaid`         | Credits exceed charges                      |
| `refunded`         | Full refund processed                       |
| `failed`           | Payment attempt failed                      |
| `pending`          | Payment in progress                         |
| `voided`           | All charges voided                          |

### Folio Transaction Types

| Type                  | Charge Code  | Direction |
|-----------------------|-------------|-----------|
| Room charge           | `RM`        | Debit     |
| Tax                   | `VAT`       | Debit     |
| Deposit received      | `DEP`       | Credit    |
| Cash payment          | `PMT-CASH`  | Credit    |
| Card payment          | `PMT-CARD`  | Credit    |
| QR payment            | `PMT-QR`    | Credit    |
| Bank transfer         | `PMT-BANK`  | Credit    |
| Refund                | `REF`       | Debit     |
| Positive adjustment   | `ADJ_POS`   | Debit     |
| Negative adjustment   | `ADJ_NEG`   | Credit    |
| Correction            | `CORR`      | Either    |

---

## Payment Flows

### 1. Hosted Deposit Collection

```
Staff creates deposit request
  → PaymentRequest created (status: pending)
  → Provider checkout session created (Stripe/test)
  → Payment link sent to guest via email

Guest opens payment link
  → Redirected to provider hosted checkout
  → Guest completes payment
  → Provider sends webhook to /webhooks/payments/<provider>
  → Webhook verified (signature + tolerance)
  → PaymentEvent recorded
  → Deposit posted to folio as FolioCharge
  → Reservation.payment_status updated
  → Confirmation email queued
```

### 2. Manual Front-Desk Payment

```
Staff selects payment method (cash/card/QR/bank)
  → PaymentPostingPayload submitted
  → FolioCharge created (credit)
  → PaymentRequest created or linked (status: paid)
  → PaymentEvent recorded
  → Reservation.payment_status updated
  → CashierActivityLog entry created
```

### 3. Refund

```
Staff initiates refund
  → RefundPostingPayload submitted
  → If processed: FolioCharge created (debit, code REF)
  → If pending: PaymentEvent with event_type="refund_pending"
  → Reservation.payment_status updated
  → AuditLog entry created
```

### 4. Void

```
Staff voids a charge
  → Original charge marked voided_at + void_reason
  → Reversal FolioCharge created (is_reversal=True)
  → Reservation.payment_status updated
  → AuditLog with before/after state
```

---

## Webhook Setup

### Stripe

Endpoint: `https://<domain>/webhooks/payments/stripe`

Required events:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Verification: Stripe-Signature header with HMAC-SHA256.

### Test Provider

Endpoint: `https://<domain>/webhooks/payments/test_hosted`

Verification: `X-Test-Hosted-Signature` header with HMAC-SHA256 using
`TEST_HOSTED_PAYMENT_SECRET`.

---

## Environment Variables

| Variable                              | Required | Default               | Purpose                     |
|---------------------------------------|----------|-----------------------|-----------------------------|
| `PAYMENT_PROVIDER`                    | No       | `disabled`            | Active provider             |
| `PAYMENT_BASE_URL`                    | No       | (empty)               | Public URL for payment links |
| `PAYMENT_LINK_TTL_MINUTES`            | No       | `60`                  | Link expiry time            |
| `PAYMENT_LINK_RESEND_COOLDOWN_SECONDS`| No       | `60`                  | Resend throttle             |
| `PAYMENT_WEBHOOK_TOLERANCE_SECONDS`   | No       | `300`                 | Webhook clock tolerance     |
| `STRIPE_SECRET_KEY`                   | If Stripe| (empty)               | Stripe API key              |
| `STRIPE_WEBHOOK_SECRET`               | If Stripe| (empty)               | Stripe webhook secret       |
| `STRIPE_API_BASE`                     | No       | `https://api.stripe.com` | Stripe API base URL      |
| `TEST_HOSTED_PAYMENT_SECRET`          | No       | `sandbox-test-hosted-secret` | Test provider secret |

### Runtime Database Settings

These can be adjusted via Admin → Payments without restart:

- `payment.active_provider` — override env provider
- `payment.deposit_enabled` — enable/disable deposit collection
- `payment.link_expiry_minutes` — link TTL
- `payment.link_resend_cooldown_seconds` — resend cooldown

---

## API Endpoints

### Public Payment Routes

| Method | Path                                 | Purpose                     |
|--------|--------------------------------------|-----------------------------|
| GET    | `/payments/request/<code>`           | Guest entry to hosted checkout |
| GET    | `/payments/return/<code>`            | Guest return after payment  |
| POST   | `/webhooks/payments/<provider>`      | Provider webhook ingestion  |

### Staff Cashier Routes

| Method | Path                                                    | Permission              | Purpose                    |
|--------|---------------------------------------------------------|-------------------------|----------------------------|
| GET    | `/staff/cashier/<id>/payment-summary`                   | `payment.read`          | JSON balance summary       |
| POST   | `/staff/cashier/<id>/payments`                          | `payment.create`        | Record manual payment      |
| POST   | `/staff/cashier/<id>/payment-requests`                  | `payment_request.create`| Create deposit request     |
| POST   | `/staff/cashier/<id>/payment-requests/<id>/resend`      | `payment_request.create`| Resend payment link        |
| POST   | `/staff/cashier/<id>/payment-requests/<id>/refresh`     | `payment.read`          | Sync provider status       |

### Admin Routes

| Method | Path                                      | Permission       | Purpose                    |
|--------|-------------------------------------------|------------------|----------------------------|
| GET/POST | `/staff/admin/payments`                | `settings.view/edit` | Payment configuration   |
| GET    | `/staff/admin/payments/reconciliation`    | `payment.read`   | Reconciliation dashboard   |

---

## Testing Payment Flows Locally

### Using Test Provider

```bash
export PAYMENT_PROVIDER=test_hosted
export PAYMENT_BASE_URL=http://localhost:5000
export TEST_HOSTED_PAYMENT_SECRET=sandbox-test-hosted-secret
```

1. Create a reservation via admin or public booking.
2. Open cashier folio → Create deposit request.
3. The payment link uses the test provider's hosted checkout simulator.
4. Simulate webhook callback:

```bash
# The test provider signs webhooks with HMAC-SHA256
python -c "
import hmac, hashlib, json, time
payload = json.dumps({
    'event_type': 'payment.paid',
    'provider_reference': '<PROVIDER_REF>',
    'amount': '500.00',
    'currency': 'THB',
    'timestamp': str(int(time.time()))
})
secret = 'sandbox-test-hosted-secret'
sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
print(f'Signature: {sig}')
print(f'Payload: {payload}')
"
```

### Running Tests

```bash
# All payment tests
python -m pytest sandbox_pms_mvp/tests/test_phase8_cashier.py \
                 sandbox_pms_mvp/tests/test_phase9_hosted_payments.py \
                 sandbox_pms_mvp/tests/test_phase19_payment_status.py -q

# Payment status specific tests
python -m pytest sandbox_pms_mvp/tests/test_phase19_payment_status.py -q
```

---

## Reconciliation

The reconciliation dashboard at `/staff/admin/payments/reconciliation` provides:

- **Period totals** — total requests, total collected, pending count.
- **Status breakdown** — requests by status (paid, pending, failed, expired).
- **Recent requests** — table of payment requests with status and amounts.
- **Awaiting payment** — reservations with outstanding balances.
- **Provider events** — webhook and sync events for audit.

---

## Security Considerations

1. **No card data stored** — all card collection via hosted provider pages.
2. **Webhook verification** — HMAC-SHA256 signature validation on all providers.
3. **Guest token verification** — payment links include HMAC reservation tokens.
4. **Idempotent processing** — duplicate webhooks and posting keys prevent double-charging.
5. **Audit trail** — every financial action logged with actor, timestamp, before/after state.
6. **Permission-gated** — all cashier routes require specific role permissions.
7. **HTTPS enforced** — `FORCE_HTTPS=1` in production.
