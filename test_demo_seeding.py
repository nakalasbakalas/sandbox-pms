#!/usr/bin/env python
"""Test script to verify demo data seeding works correctly."""

import sys
from datetime import date

from sandbox_pms_mvp.pms.app import create_app
from sandbox_pms_mvp.pms.extensions import db
from sandbox_pms_mvp.pms.models import Guest, Reservation
from sandbox_pms_mvp.pms.seeds import seed_demo_guests_and_reservations


def test_demo_seeding():
    """Test the demo seeding function."""
    app = create_app()

    with app.app_context():
        # Check if demo data already exists
        existing_guests = Guest.query.filter(Guest.phone.like("DEMO-%")).count()

        if existing_guests > 0:
            print(f"⚠️  Demo data already exists ({existing_guests} guests). Skipping seeding.")
            print("To re-test, delete existing demo data first.")
        else:
            print("🌱 Seeding demo data...")
            seed_demo_guests_and_reservations(num_guests=30, num_reservations=80)
            db.session.commit()
            print("✓ Demo data seeded successfully")

        # Verify the data
        print("\n" + "="*60)
        print("VERIFICATION RESULTS")
        print("="*60)

        # Count guests
        total_guests = Guest.query.filter(Guest.phone.like("DEMO-%")).count()
        print(f"\n✓ Demo Guests: {total_guests}")

        # Count reservations
        demo_guest_ids = [g.id for g in Guest.query.filter(Guest.phone.like("DEMO-%")).all()]
        reservations = Reservation.query.filter(
            Reservation.primary_guest_id.in_(demo_guest_ids)
        ).all()

        print(f"✓ Total Reservations: {len(reservations)}")

        # Status distribution
        from collections import Counter
        status_counts = Counter(r.current_status for r in reservations)
        print(f"\n📊 Status Distribution:")
        for status, count in sorted(status_counts.items()):
            percentage = (count / len(reservations)) * 100
            print(f"   {status:15s}: {count:3d} ({percentage:5.1f}%)")

        # Date range
        check_in_dates = [r.check_in_date for r in reservations]
        check_out_dates = [r.check_out_date for r in reservations]

        print(f"\n📅 Date Range:")
        print(f"   Check-in range: {min(check_in_dates)} to {max(check_in_dates)}")
        print(f"   Check-out range: {min(check_out_dates)} to {max(check_out_dates)}")

        # Verify all dates are in March 2026
        march_start = date(2026, 3, 1)
        march_end = date(2026, 3, 31)

        dates_in_march = all(
            march_start <= d <= march_end + timedelta(days=10)  # Allow slight overflow
            for d in check_in_dates + check_out_dates
        )

        if dates_in_march:
            print(f"   ✓ All dates are in/around March 2026")
        else:
            print(f"   ⚠️  Some dates are outside March 2026")

        # Room assignments
        assigned_count = sum(1 for r in reservations if r.assigned_room_id is not None)
        print(f"\n🏨 Room Assignments:")
        print(f"   Assigned rooms: {assigned_count}")
        print(f"   Unassigned: {len(reservations) - assigned_count}")

        # Pricing verification
        sample_res = reservations[0]
        print(f"\n💰 Sample Pricing (Reservation {sample_res.reservation_code}):")
        print(f"   Room total: ${sample_res.quoted_room_total}")
        print(f"   Tax total: ${sample_res.quoted_tax_total}")
        print(f"   Grand total: ${sample_res.quoted_grand_total}")
        print(f"   Check-in: {sample_res.check_in_date}")
        print(f"   Check-out: {sample_res.check_out_date}")
        print(f"   Nights: {(sample_res.check_out_date - sample_res.check_in_date).days}")

        print("\n" + "="*60)
        print("✅ VERIFICATION COMPLETE")
        print("="*60)


if __name__ == "__main__":
    from datetime import timedelta
    test_demo_seeding()
