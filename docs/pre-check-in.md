# Digital Pre-Check-In Module

## Architecture Overview

The Digital Pre-Check-In module allows guests to complete their arrival information
before reaching reception, reducing front-desk check-in time and improving data
capture accuracy.

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Models** | `pms/models.py` | `PreCheckIn`, `ReservationDocument` |
| **Constants** | `pms/constants.py` | Status enums, readiness states |
| **Service** | `pms/services/pre_checkin_service.py` | Business logic |
| **Routes** | `pms/app.py` | Guest + staff HTTP endpoints |
| **Templates** | `templates/pre_checkin_*.html`, `templates/staff_pre_checkin_detail.html` | UI |
| **Migration** | `migrations/versions/20260314_01_phase17_pre_checkin.py` | Schema |
| **Tests** | `tests/test_phase17_pre_checkin.py` | 41 test cases |

### Data Model

#### PreCheckIn Table (`pre_checkins`)

One-to-one relationship with `reservations`. Stores guest-submitted arrival data.

| Field | Type | Description |
|-------|------|-------------|
| `reservation_id` | UUID FK | Links to reservation (unique, cascade) |
| `token` | String(120) | Secure access token (unique, indexed) |
| `status` | String(30) | Lifecycle status |
| `readiness` | String(40) | Front-desk readiness indicator |
| `primary_contact_name` | String(255) | Guest full name |
| `primary_contact_phone` | String(60) | Guest phone |
| `primary_contact_email` | String(255) | Guest email |
| `nationality` | String(80) | Guest nationality |
| `number_of_occupants` | Integer | Total guests |
| `eta` | String(40) | Estimated arrival time |
| `special_requests` | Text | Guest special requests |
| `notes_for_staff` | Text | Notes for reception |
| `vehicle_registration` | String(80) | Vehicle plate (if applicable) |
| `occupant_details` | JSON | List of additional occupant names |
| `acknowledgment_accepted` | Boolean | Registration acknowledgment |
| `acknowledgment_name` | String(255) | Typed signature |
| `acknowledgment_at` | DateTime | When acknowledgment was given |
| `expires_at` | DateTime | Token expiry |
| `link_sent_at` | DateTime | When link was generated/sent |
| `link_opened_at` | DateTime | When guest first opened the link |
| `started_at` | DateTime | When guest started filling form |
| `completed_at` | DateTime | When guest submitted form |

#### ReservationDocument Table (`reservation_documents`)

Stores uploaded identity documents linked to reservations.

| Field | Type | Description |
|-------|------|-------------|
| `reservation_id` | UUID FK | Links to reservation (cascade) |
| `guest_id` | UUID FK | Links to guest (nullable) |
| `document_type` | String(40) | passport, national_id, driving_license, other |
| `storage_key` | String(500) | File path/key in storage |
| `original_filename` | String(255) | Original upload filename |
| `content_type` | String(120) | MIME type |
| `file_size_bytes` | Integer | File size |
| `verification_status` | String(20) | pending, verified, rejected |
| `verified_by_user_id` | UUID FK | Staff who verified |
| `verified_at` | DateTime | When verified |
| `rejection_reason` | String(255) | Why rejected |

### Status Lifecycle

```
not_sent → sent → opened → in_progress → submitted → verified
                                                    → rejected → sent (regenerated)
                                        → expired → sent (regenerated)
```

### Readiness States

| State | Meaning |
|-------|---------|
| `awaiting_guest` | Link sent, waiting for guest action |
| `docs_missing` | Guest submitted but no ID uploaded |
| `id_uploaded` | ID uploaded, pending verification |
| `signature_missing` | Missing registration acknowledgment |
| `payment_pending` | Deposit not yet received |
| `ready_for_arrival` | All requirements met |
| `checked_at_desk` | Staff verified at desk |

## Guest Flow

1. Staff generates a pre-check-in link from the reservation detail page
2. Guest receives the link (copy/paste, email, messaging)
3. Guest opens the link → mobile-first form loads with booking details
4. Guest fills in: name, phone, email, nationality, ETA, special requests
5. Guest uploads ID document (passport, national ID, driving license)
6. Guest accepts registration acknowledgment (checkbox + typed name)
7. Guest submits → confirmation page shown
8. Front desk sees readiness status update immediately

## Staff Flow

1. From reservation detail, click "Send Pre-Check-In" to generate link
2. Copy link and send to guest via preferred channel
3. View pre-check-in status in reservation detail (status pill)
4. Click through to pre-check-in detail page to see:
   - All guest-submitted information
   - Uploaded documents with view/verify/reject actions
   - Timeline (sent, opened, started, completed)
   - Acknowledgment status
5. Verify or reject documents individually
6. Mark entire pre-check-in as verified when ready
7. At check-in, guest data is already captured → fewer manual steps

## API Endpoints

### Guest-Facing (Token-Authenticated)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/pre-checkin/<token>` | Load pre-check-in form |
| POST | `/pre-checkin/<token>/save` | Save progress or submit |
| POST | `/pre-checkin/<token>/upload` | Upload identity document |

### Staff-Facing (Session-Authenticated)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/staff/reservations/<id>/pre-checkin/generate` | Generate link |
| POST | `/staff/reservations/<id>/pre-checkin/resend` | Regenerate link |
| GET | `/staff/reservations/<id>/pre-checkin` | View details |
| POST | `/staff/reservations/<id>/pre-checkin/verify` | Mark verified |
| POST | `/staff/reservations/<id>/pre-checkin/reject` | Reject |
| POST | `/staff/documents/<id>/verify` | Verify/reject document |
| GET | `/staff/documents/<id>/view` | View document file |

## Security

- **Token-based access**: Guests use cryptographically secure URL-safe tokens
- **Time-limited tokens**: Default 7-day expiry, configurable
- **Upload validation**: File type whitelist (jpg, png, webp, pdf), 10MB max
- **Secure storage**: Documents stored in server filesystem, not publicly accessible
- **Staff authorization**: All staff routes require `reservation.view`/`reservation.edit`/`reservation.check_in` permissions
- **Audit logging**: All critical actions logged to `audit_log` and `activity_log`
- **Input sanitization**: All guest inputs are stripped and length-limited
- **CSRF**: Guest POST routes are token-authenticated (exempt from session CSRF); staff routes use standard CSRF

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UPLOAD_DIR` | `instance/uploads/documents` | Document storage directory |

## File Storage

Documents are stored on the local filesystem under the configured `UPLOAD_DIR`.
Each reservation gets a subdirectory. Files are named with UUIDs to prevent
filename collisions. The storage is designed to be swappable to S3/GCS in the
future by replacing the `_save_file` and `_upload_dir` helpers.

## Testing Locally

```bash
cd sandbox_pms_mvp
python -m pytest tests/test_phase17_pre_checkin.py -v
```

To manually test the guest flow:

1. Start the app: `python -m flask run`
2. Create a reservation via staff UI
3. Generate a pre-check-in link from the reservation detail page
4. Open the link in a browser (or incognito window)
5. Fill in the form, upload a document, and submit
6. Check the staff pre-check-in detail page

## Known Limitations

- Document storage is local filesystem only (no cloud storage adapter yet)
- No automated OCR or identity verification
- No email/SMS auto-sending of pre-check-in links (manual copy for now)
- Signature capture is typed-name only (no canvas signature)
- No auto-population from previous stays
