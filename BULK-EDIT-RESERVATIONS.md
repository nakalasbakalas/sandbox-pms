# Bulk Edit Reservations Feature

## Overview

The Bulk Edit feature allows hotel staff to select and modify multiple reservations simultaneously, significantly improving operational efficiency when making common changes across multiple bookings.

## Accessing Bulk Edit Mode

1. Navigate to the **Reservations** page
2. Click the **"Select Multiple"** button in the top right corner
3. The interface switches to bulk selection mode with checkboxes on each reservation card

## Selecting Reservations

### Individual Selection
- Click on any reservation card to toggle its selection
- Click the checkbox to select/deselect without opening the card
- Selected reservations show a blue ring and highlighted background

### Bulk Selection
- Use **"Select All"** buttons above each tab to select all visible reservations
- Available on each filtered view (All, Arrivals, Departures, Active, Upcoming, Cancelled)
- Selection count displays in the header: "X selected"

### Clearing Selection
- Click **"Clear"** button in the header to deselect all and exit bulk mode
- Or click **"X"** to cancel individual selections

## Bulk Edit Operations

Once reservations are selected, click **"Bulk Edit"** to open the editor dialog.

### 1. Status Changes
**Use Case:** Mark multiple reservations as confirmed, cancelled, or no-show

- Select new status from dropdown
- Applies to all selected reservations instantly
- Useful for batch confirmations or cancellations

**Example:** Select all pending bookings from a cancelled event and mark as CANCELLED

### 2. Date Adjustments

#### Extend Stay
- Add days to checkout date
- Automatically recalculates nights and total amount
- Deposit amount adjusted proportionally

**Example:** Festival extended by 2 days - add 2 days to all affected bookings

#### Shorten Stay
- Remove days from checkout date
- Automatically recalculates pricing
- Useful for early departure scenarios

**Example:** Conference ended early - reduce stay by 1 day for all attendees

#### Set New Dates
- Manually set new check-in and check-out dates
- Replaces existing dates completely
- Total amounts recalculated based on new duration

**Example:** Event rescheduled - shift 20 bookings to new dates

### 3. Rate Adjustments

#### Percentage Adjustment
- Increase or decrease rates by a percentage
- Positive values increase rates (e.g., +10% for ฿1,500 = ฿1,650)
- Negative values decrease rates (e.g., -15% for ฿2,000 = ฿1,700)
- Total amounts recalculated automatically

**Example:** Apply 20% peak season markup to all December bookings

#### Fixed Amount Adjustment
- Add or subtract a fixed amount per night
- Positive values increase (e.g., +฿200)
- Negative values decrease (e.g., -฿300)
- Total amounts recalculated automatically

**Example:** Add ฿500/night premium for New Year's Eve stays

### 4. Payment Status Updates

#### Mark Deposits as Paid
- Bulk update deposit status to "Paid"
- Useful after processing batch payments
- Removes pending deposit warnings

**Example:** Bank transfer received covering 10 bookings - mark all as paid

#### Mark Deposits as Pending
- Reset deposit status to pending
- Use when payments need reverification
- Triggers pending payment alerts

### 5. Notes Management

#### Append Notes
- Add the same note to all selected reservations
- Automatically includes timestamp: `[2025-01-15 14:30]`
- Appends to existing notes (doesn't replace)
- Useful for batch announcements or updates

**Example:** Add "Pool under maintenance Jan 20-22" to all affected stays

### 6. Booking Source Changes

- Update the booking source/channel for multiple reservations
- Available sources: Direct, Booking.com, Agoda, Expedia, Airbnb, Walk-in, Phone, Email
- Useful for correcting miscategorized bookings or channel reassignments

**Example:** Bookings incorrectly marked as Direct - reassign to Booking.com

## Workflow Example: Group Booking Modification

**Scenario:** A corporate group of 15 rooms needs to extend their stay by 2 nights and receive a 10% discount.

1. Click **"Select Multiple"**
2. Filter by guest name or date range to find the group bookings
3. Click **"Select All"** or individually select the 15 reservations
4. Click **"Bulk Edit"**
5. Select **"Dates"** tab → Choose "Extend Stay" → Enter "2" days
6. Apply changes (extension completed)
7. With same 15 still selected, click **"Bulk Edit"** again
8. Select **"Rates"** tab → Choose "Percentage Adjustment" → Enter "-10"
9. Apply changes (discount applied)
10. Click **"Clear"** to exit bulk mode

**Result:** All 15 reservations extended by 2 nights with 10% discount, amounts recalculated automatically.

## Safety Features

- **Preview Before Apply:** See selected count and reservation list before saving
- **Automatic Recalculation:** Pricing, deposits, and totals update automatically
- **Audit Trail:** All changes include updated timestamps
- **Confirmation Required:** Bulk operations require explicit "Apply Changes" action
- **Validation:** System prevents invalid date ranges or negative rates

## Best Practices

1. **Filter First:** Use status filters and search to narrow down bookings before bulk selecting
2. **Verify Selection:** Always review the selected reservations list in the bulk edit dialog
3. **One Operation at a Time:** For complex changes, apply one type of edit, verify, then proceed to next
4. **Use Notes:** Document bulk changes with notes for future reference
5. **Check Calculations:** Verify rate and total amount changes make sense for your use case

## Technical Details

### Data Updates
- Uses functional state updates to prevent race conditions
- All selected reservations updated atomically
- `updatedAt` timestamp refreshed on all modified reservations

### Recalculation Logic
- Nights = difference between checkout and checkin
- Total Amount = Nights × Rate Per Night
- Deposit Amount = Total Amount × 30% (rounded down)

### Supported Statuses
- PENDING
- CONFIRMED
- CHECKED_IN
- CHECKED_OUT
- CANCELLED
- NO_SHOW

## Limitations

- Cannot bulk modify:
  - Room assignments (must be done individually)
  - Guest information (personal data requires individual attention)
  - Special requests (unique per guest)
- Bulk operations cannot be undone (no undo feature yet)
- Maximum practical selection: ~100 reservations (UI performance consideration)

## Future Enhancements

- Undo/Redo functionality
- Bulk room assignment
- Save bulk edit templates for repeated operations
- Export selected reservations to CSV
- Bulk email/notification sending
- Advanced filters (date range, rate range, source)
