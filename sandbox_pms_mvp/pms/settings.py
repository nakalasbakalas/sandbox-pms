from __future__ import annotations

from decimal import Decimal

from .constants import BOOKING_LANGUAGES

APP_SETTINGS_SEED = [
    ("hotel.name", {"value": "Sandbox Hotel"}, "string", "Hotel name", True, 1),
    ("hotel.currency", {"value": "THB"}, "string", "Operating currency", True, 2),
    ("hotel.check_in_time", {"value": "14:00"}, "time", "Standard check-in time", True, 3),
    ("hotel.check_out_time", {"value": "11:00"}, "time", "Standard check-out time", True, 4),
    ("hotel.vat_rate", {"value": "0.07"}, "decimal", "VAT rate", False, 5),
    ("hotel.service_charge_rate", {"value": "0.00"}, "decimal", "Service charge rate", False, 6),
    ("hotel.extra_guest_fee", {"value": "200.00"}, "money", "Extra guest nightly fee", False, 7),
    ("hotel.child_fee_6_11", {"value": "100.00"}, "money", "Child fee age 6-11", False, 8),
    ("hotel.child_fee_0_5", {"value": "0.00"}, "money", "Child fee age 0-5", False, 9),
    ("hotel.overbooking_allowed", {"value": False}, "boolean", "Overbooking policy", False, 10),
    ("reservation.code_prefix", {"value": "SBX"}, "string", "Reservation code prefix", False, 11),
    ("reservation.default_hold_cutoff_hour", {"value": 18}, "integer", "Tentative hold cutoff hour", False, 12),
    ("reservation.standard_cancellation_hours", {"value": 24}, "integer", "Standard cancellation cutoff hours", False, 13),
    ("reservation.late_cancellation_fee_nights", {"value": "1.00"}, "decimal", "Late cancellation fee nights", False, 14),
    ("reservation.no_show_fee_nights", {"value": "1.00"}, "decimal", "No show fee nights", False, 15),
    ("reservation.early_check_in_fee", {"value": "100.00"}, "money", "Configurable early check-in fee", False, 16),
    ("reservation.late_check_out_fee", {"value": "100.00"}, "money", "Configurable late check-out fee", False, 17),
    ("booking.public_hold_minutes", {"value": 7}, "integer", "Public booking hold duration", False, 18),
    ("booking.terms_version", {"value": "2026-03"}, "string", "Published booking terms version", True, 19),
    ("hotel.contact_phone", {"value": "+66 000 000 000"}, "string", "Public reservation contact phone", True, 20),
    ("hotel.contact_email", {"value": "reservations@sandbox-hotel.local"}, "string", "Public reservation contact email", True, 21),
    ("hotel.address", {"value": "Sandbox Hotel, Thailand"}, "string", "Hotel address", True, 22),
    ("hotel.logo_url", {"value": ""}, "string", "Hotel logo URL", True, 23),
    ("hotel.tax_id", {"value": "0100000000000"}, "string", "Tax or business display identifier", True, 24),
    ("hotel.brand_mark", {"value": "SBX"}, "string", "Short hotel brand mark", True, 25),
    ("reservation.deposit_percentage", {"value": "50.00"}, "decimal", "Deposit percentage for future reservations", False, 26),
    ("payment.active_provider", {"value": "env"}, "string", "Active hosted payment provider override", False, 27),
    ("payment.deposit_enabled", {"value": True}, "boolean", "Enable hosted deposit payments", False, 28),
    ("payment.link_expiry_minutes", {"value": 60}, "integer", "Hosted payment link expiry minutes", False, 29),
    ("payment.link_resend_cooldown_seconds", {"value": 60}, "integer", "Payment link resend cooldown in seconds", False, 30),
    ("housekeeping.require_inspected_for_ready", {"value": False}, "boolean", "Require inspected rooms before check-in readiness", False, 31),
    ("housekeeping.checkout_dirty_status", {"value": "dirty"}, "string", "Default housekeeping status applied after checkout", False, 32),
    ("notifications.sender_name", {"value": "Sandbox Hotel"}, "string", "Display sender name for guest communications", False, 33),
    ("notifications.pre_arrival_enabled", {"value": True}, "boolean", "Enable scheduled pre-arrival reminders", False, 34),
    ("notifications.pre_arrival_days_before", {"value": 1}, "integer", "Days before arrival to send pre-arrival reminder", False, 35),
    ("notifications.failed_payment_reminder_enabled", {"value": True}, "boolean", "Enable failed payment reminders", False, 36),
    ("notifications.failed_payment_reminder_delay_hours", {"value": 6}, "integer", "Hours after payment failure before reminder is eligible", False, 37),
    ("notifications.staff_email_alerts_enabled", {"value": False}, "boolean", "Send staff operational alerts by email", False, 38),
    ("notifications.staff_alert_recipients", {"value": ""}, "string", "Comma-separated staff alert email recipients", False, 39),
    ("notifications.line_staff_alert_enabled", {"value": False}, "boolean", "Enable optional LINE staff alert channel", False, 40),
    ("notifications.whatsapp_staff_alert_enabled", {"value": False}, "boolean", "Enable optional WhatsApp staff alert channel", False, 41),
]


POLICY_DOCUMENTS_SEED = {
    "cancellation_policy": {
        "name": "Cancellation policy",
        "version": "2026-03",
        "content": {
            "th": "ยกเลิกฟรีก่อนวันเข้าพัก 24 ชั่วโมง หลังจากนั้นอาจมีค่าธรรมเนียม 1 คืน",
            "en": "Free cancellation up to 24 hours before arrival. Later cancellations may incur one night.",
            "zh-Hans": "入住前24小时可免费取消，逾期可能收取首晚费用。",
        },
    },
    "no_show_policy": {
        "name": "No-show policy",
        "version": "2026-03",
        "content": {
            "th": "ไม่มาเข้าพักโดยไม่แจ้งอาจถูกเรียกเก็บค่าห้องคืนแรก",
            "en": "No-show reservations may be charged one night if the guest does not arrive or notify the hotel.",
            "zh-Hans": "未按时入住且未通知酒店的预订，酒店可能收取首晚费用。",
        },
    },
    "check_in_policy": {
        "name": "Check-in policy",
        "version": "2026-03",
        "content": {
            "th": "เช็คอินเวลา 14:00 น. ต้องแสดงบัตรประชาชนหรือหนังสือเดินทางเมื่อเข้าพัก",
            "en": "Standard check-in is 14:00 and a government-issued ID or passport is required on arrival.",
            "zh-Hans": "标准入住时间为14:00，入住时需出示政府签发证件或护照。",
        },
    },
    "check_out_policy": {
        "name": "Check-out policy",
        "version": "2026-03",
        "content": {
            "th": "เช็คเอาต์เวลา 11:00 น. อาจมีค่าธรรมเนียมหากออกล่าช้า",
            "en": "Standard check-out is 11:00 and late departures may incur additional charges.",
            "zh-Hans": "标准退房时间为11:00，延迟退房可能产生额外费用。",
        },
    },
    "child_extra_guest_policy": {
        "name": "Child and extra guest policy",
        "version": "2026-03",
        "content": {
            "th": "ผู้เข้าพักเพิ่ม 200 บาท/คืน เด็กอายุ 0-5 ปีพักฟรีเมื่อใช้เตียงเดิม เด็ก 6-11 ปี 100 บาท/คืน",
            "en": "Extra guest THB 200/night. Children 0-5 stay free using existing bedding, children 6-11 are THB 100/night.",
            "zh-Hans": "加人每晚 THB 200。0-5岁儿童共用现有床位免费，6-11岁儿童每晚 THB 100。",
        },
    },
    "privacy_notice": {
        "name": "Privacy and communication notice",
        "version": "2026-03",
        "content": {
            "th": "โรงแรมใช้ข้อมูลการติดต่อเพื่อยืนยันการจอง การชำระเงิน และการสื่อสารด้านการเข้าพัก",
            "en": "The hotel uses contact details to confirm bookings, payments, and essential stay communications.",
            "zh-Hans": "酒店将使用您的联系方式进行预订确认、付款通知及必要的住宿沟通。",
        },
    },
}


NOTIFICATION_TEMPLATE_PLACEHOLDERS = {
    "guest_confirmation": [
        "hotel_name",
        "hotel_logo_url",
        "hotel_address",
        "hotel_check_in_time",
        "hotel_check_out_time",
        "guest_name",
        "reservation_code",
        "check_in_date",
        "check_out_date",
        "room_type_name",
        "room_number",
        "occupancy_summary",
        "grand_total",
        "deposit_amount",
        "contact_phone",
        "contact_email",
        "cancellation_policy",
        "check_in_policy",
        "check_out_policy",
    ],
    "deposit_payment_request": [
        "hotel_name",
        "hotel_logo_url",
        "hotel_address",
        "guest_name",
        "reservation_code",
        "deposit_amount",
        "payment_link",
        "payment_expires_at",
        "contact_phone",
        "contact_email",
        "check_in_policy",
    ],
    "payment_success": [
        "hotel_name",
        "hotel_logo_url",
        "guest_name",
        "reservation_code",
        "deposit_amount",
        "amount_received",
        "payment_status",
        "contact_phone",
        "contact_email",
    ],
    "payment_failed": [
        "hotel_name",
        "hotel_logo_url",
        "guest_name",
        "reservation_code",
        "deposit_amount",
        "payment_link",
        "payment_status",
        "contact_phone",
        "contact_email",
    ],
    "pre_arrival_reminder": [
        "hotel_name",
        "hotel_logo_url",
        "hotel_address",
        "guest_name",
        "reservation_code",
        "check_in_date",
        "check_out_date",
        "room_type_name",
        "room_number",
        "occupancy_summary",
        "hotel_check_in_time",
        "hotel_check_out_time",
        "contact_phone",
        "contact_email",
        "check_in_policy",
    ],
    "cancellation_confirmation": [
        "hotel_name",
        "hotel_logo_url",
        "guest_name",
        "reservation_code",
        "payment_status",
        "refund_amount",
        "contact_phone",
        "contact_email",
        "cancellation_policy",
    ],
    "modification_confirmation": [
        "hotel_name",
        "hotel_logo_url",
        "guest_name",
        "reservation_code",
        "check_in_date",
        "check_out_date",
        "room_type_name",
        "occupancy_summary",
        "grand_total",
        "modification_summary",
        "contact_phone",
        "contact_email",
    ],
    "cancellation_request_received": [
        "hotel_name",
        "guest_name",
        "reservation_code",
        "contact_phone",
        "contact_email",
    ],
    "modification_request_received": [
        "hotel_name",
        "guest_name",
        "reservation_code",
        "contact_phone",
        "contact_email",
    ],
    "internal_new_booking_alert": [
        "hotel_name",
        "guest_name",
        "reservation_code",
        "source_channel",
        "check_in_date",
        "check_out_date",
        "room_type_name",
        "occupancy_summary",
        "deposit_amount",
        "payment_status",
        "notification_summary",
    ],
    "internal_activity_alert": [
        "hotel_name",
        "guest_name",
        "reservation_code",
        "source_channel",
        "check_in_date",
        "check_out_date",
        "room_type_name",
        "deposit_amount",
        "payment_status",
        "notification_summary",
        "contact_phone",
        "contact_email",
    ],
}


"""Legacy Phase 10 template seed block retained for reference.
NOTIFICATION_TEMPLATES_SEED = []
for language in BOOKING_LANGUAGES:
    if language == "th":
        confirmation_subject = "ยืนยันการจอง {reservation_code}"
        confirmation_body = (
            "{hotel_name}\n"
            "{guest_name}\n"
            "ยืนยันการจองเลขที่ {reservation_code}\n"
            "เข้าพัก {check_in_date} ถึง {check_out_date}\n"
            "ประเภทห้อง {room_type_name}\n"
            "ยอดรวมโดยประมาณ THB {grand_total}\n"
            "มัดจำที่ต้องชำระ THB {deposit_amount}\n"
            "{cancellation_policy}\n"
            "{check_in_policy}\n"
            "{check_out_policy}\n"
            "ติดต่อ {contact_phone} / {contact_email}"
        )
        payment_subject = "ชำระมัดจำสำหรับการจอง {reservation_code}"
        payment_body = (
            "{hotel_name}\n"
            "{guest_name}\n"
            "กรุณาชำระมัดจำ THB {deposit_amount} ผ่านลิงก์ที่ปลอดภัยด้านล่าง\n"
            "{payment_link}\n"
            "{check_in_policy}\n"
            "ติดต่อ {contact_phone} / {contact_email}"
        )
    elif language == "zh-Hans":
        confirmation_subject = "{reservation_code} 预订确认"
        confirmation_body = (
            "{hotel_name}\n"
            "{guest_name}\n"
            "您的预订参考号为 {reservation_code}\n"
            "入住 {check_in_date}，退房 {check_out_date}\n"
            "房型 {room_type_name}\n"
            "预估总额 THB {grand_total}\n"
            "所需押金 THB {deposit_amount}\n"
            "{cancellation_policy}\n"
            "{check_in_policy}\n"
            "{check_out_policy}\n"
            "联系 {contact_phone} / {contact_email}"
        )
        payment_subject = "{reservation_code} 押金付款链接"
        payment_body = (
            "{hotel_name}\n"
            "{guest_name}\n"
            "请通过以下安全支付链接支付押金 THB {deposit_amount}\n"
            "{payment_link}\n"
            "{check_in_policy}\n"
            "联系 {contact_phone} / {contact_email}"
        )
    else:
        confirmation_subject = "Booking confirmation {reservation_code}"
        confirmation_body = (
            "{hotel_name}\n"
            "{guest_name}\n"
            "Your booking reference is {reservation_code}\n"
            "Stay {check_in_date} to {check_out_date}\n"
            "Room type {room_type_name}\n"
            "Estimated total THB {grand_total}\n"
            "Deposit required THB {deposit_amount}\n"
            "{cancellation_policy}\n"
            "{check_in_policy}\n"
            "{check_out_policy}\n"
            "Contact {contact_phone} / {contact_email}"
        )
        payment_subject = "Deposit payment link {reservation_code}"
        payment_body = (
            "{hotel_name}\n"
            "{guest_name}\n"
            "Please pay the deposit of THB {deposit_amount} using the secure payment link below.\n"
            "{payment_link}\n"
            "{check_in_policy}\n"
            "Contact {contact_phone} / {contact_email}"
        )

    NOTIFICATION_TEMPLATES_SEED.extend(
        [
            ("guest_confirmation", "email", language, "Guest booking confirmation", confirmation_subject, confirmation_body),
            ("deposit_payment_request", "email", language, "Deposit payment request", payment_subject, payment_body),
            (
                "payment_success",
                "email",
                language,
                "Payment success follow-up",
                confirmation_subject,
                "{hotel_name}\n{guest_name}\nWe received THB {deposit_amount} for reservation {reservation_code}.\nContact {contact_phone} / {contact_email}",
            ),
            (
                "payment_failed",
                "email",
                language,
                "Payment failed follow-up",
                payment_subject,
                "{hotel_name}\n{guest_name}\nThe deposit payment for reservation {reservation_code} did not complete.\nRetry link: {payment_link}\nContact {contact_phone} / {contact_email}",
            ),
            (
                "cancellation_request_received",
                "email",
                language,
                "Cancellation request acknowledgement",
                "Cancellation request received {reservation_code}",
                "{hotel_name}\n{guest_name}\nWe received your cancellation request for {reservation_code}. We will review it shortly.",
            ),
            (
                "modification_request_received",
                "email",
                language,
                "Modification request acknowledgement",
                "Modification request received {reservation_code}",
                "{hotel_name}\n{guest_name}\nWe received your modification request for {reservation_code}. We will review availability and contact you.",
            ),
            (
                "internal_new_booking_alert",
                "email",
                language,
                "Internal new booking alert",
                "New booking {reservation_code}",
                "{hotel_name}\nNew booking {reservation_code}\nGuest {guest_name}\nStay {check_in_date} to {check_out_date}\nRoom type {room_type_name}\nSource {source_channel}\nDeposit THB {deposit_amount}",
            ),
        ]
    )


"""

_NOTIFICATION_TEMPLATE_TEXT = {
    "th": {
        "guest_confirmation": (
            "ยืนยันการจอง {reservation_code}",
            "{hotel_name}\nเรียน {guest_name}\nยืนยันการจองเลขที่ {reservation_code}\n"
            "เข้าพัก {check_in_date} ถึง {check_out_date}\nประเภทห้อง {room_type_name}\n"
            "ผู้เข้าพัก {occupancy_summary}\nยอดรวมประมาณ THB {grand_total}\n"
            "มัดจำ THB {deposit_amount}\nเช็กอิน {hotel_check_in_time} / เช็กเอาต์ {hotel_check_out_time}\n"
            "{cancellation_policy}\n{check_in_policy}\n{check_out_policy}\n"
            "ติดต่อ {contact_phone} / {contact_email}",
        ),
        "deposit_payment_request": (
            "ชำระมัดจำ {reservation_code}",
            "{hotel_name}\nเรียน {guest_name}\nกรุณาชำระเงินมัดจำ THB {deposit_amount} สำหรับการจอง {reservation_code}\n"
            "ลิงก์ชำระเงิน {payment_link}\nลิงก์หมดอายุ {payment_expires_at}\n"
            "{check_in_policy}\nติดต่อ {contact_phone} / {contact_email}",
        ),
        "payment_success": (
            "ยืนยันการรับชำระ {reservation_code}",
            "{hotel_name}\nเรียน {guest_name}\nเราได้รับเงิน THB {amount_received} สำหรับการจอง {reservation_code}\n"
            "สถานะ {payment_status}\nติดต่อ {contact_phone} / {contact_email}",
        ),
        "payment_failed": (
            "ติดตามการชำระเงิน {reservation_code}",
            "{hotel_name}\nเรียน {guest_name}\nการชำระเงินมัดจำสำหรับการจอง {reservation_code} ยังไม่สำเร็จ\n"
            "สถานะ {payment_status}\nลองอีกครั้งได้ที่ {payment_link}\nติดต่อ {contact_phone} / {contact_email}",
        ),
        "pre_arrival_reminder": (
            "เตือนก่อนเข้าพัก {reservation_code}",
            "{hotel_name}\nเรียน {guest_name}\nขอเตือนการเข้าพักของท่านในวันที่ {check_in_date}\n"
            "ประเภทห้อง {room_type_name}\nผู้เข้าพัก {occupancy_summary}\nเวลาเช็กอิน {hotel_check_in_time}\n"
            "{check_in_policy}\n{hotel_address}\nติดต่อ {contact_phone} / {contact_email}",
        ),
        "cancellation_confirmation": (
            "ยืนยันการยกเลิก {reservation_code}",
            "{hotel_name}\nเรียน {guest_name}\nการจอง {reservation_code} ถูกยกเลิกเรียบร้อยแล้ว\n"
            "สถานะการคืนเงิน/มัดจำ {payment_status}\nยอดคืนโดยประมาณ THB {refund_amount}\n"
            "{cancellation_policy}\nติดต่อ {contact_phone} / {contact_email}",
        ),
        "modification_confirmation": (
            "ยืนยันการแก้ไขการจอง {reservation_code}",
            "{hotel_name}\nเรียน {guest_name}\nเราได้อัปเดตการจอง {reservation_code} แล้ว\n"
            "{modification_summary}\nเข้าพัก {check_in_date} ถึง {check_out_date}\n"
            "ประเภทห้อง {room_type_name}\nผู้เข้าพัก {occupancy_summary}\n"
            "ยอดรวมใหม่ THB {grand_total}\nติดต่อ {contact_phone} / {contact_email}",
        ),
        "cancellation_request_received": (
            "รับคำขอยกเลิกแล้ว {reservation_code}",
            "{hotel_name}\nเรียน {guest_name}\nเราได้รับคำขอยกเลิกสำหรับ {reservation_code} แล้ว และจะติดต่อกลับโดยเร็ว",
        ),
        "modification_request_received": (
            "รับคำขอแก้ไขแล้ว {reservation_code}",
            "{hotel_name}\nเรียน {guest_name}\nเราได้รับคำขอแก้ไขสำหรับ {reservation_code} แล้ว และจะตรวจสอบให้โดยเร็ว",
        ),
        "internal_new_booking_alert": (
            "การจองใหม่ {reservation_code}",
            "{hotel_name}\nการจองใหม่ {reservation_code}\nแขก {guest_name}\n"
            "เข้าพัก {check_in_date} ถึง {check_out_date}\nประเภทห้อง {room_type_name}\n"
            "ช่องทาง {source_channel}\nมัดจำ THB {deposit_amount}\nสถานะการชำระ {payment_status}",
        ),
        "internal_activity_alert": (
            "อัปเดตการดำเนินงาน {reservation_code}",
            "{hotel_name}\n{notification_summary}\nการจอง {reservation_code}\nแขก {guest_name}\n"
            "สถานะการชำระ {payment_status}\nติดต่อ {contact_phone} / {contact_email}",
        ),
    },
    "en": {
        "guest_confirmation": (
            "Booking confirmation {reservation_code}",
            "{hotel_name}\nDear {guest_name}\nYour booking reference is {reservation_code}\n"
            "Stay {check_in_date} to {check_out_date}\nRoom type {room_type_name}\n"
            "Occupancy {occupancy_summary}\nEstimated total THB {grand_total}\n"
            "Deposit required THB {deposit_amount}\nCheck-in {hotel_check_in_time} / Check-out {hotel_check_out_time}\n"
            "{cancellation_policy}\n{check_in_policy}\n{check_out_policy}\n"
            "Contact {contact_phone} / {contact_email}",
        ),
        "deposit_payment_request": (
            "Deposit payment link {reservation_code}",
            "{hotel_name}\nDear {guest_name}\nPlease pay the deposit of THB {deposit_amount} for reservation {reservation_code}\n"
            "Payment link {payment_link}\nLink expiry {payment_expires_at}\n"
            "{check_in_policy}\nContact {contact_phone} / {contact_email}",
        ),
        "payment_success": (
            "Payment received {reservation_code}",
            "{hotel_name}\nDear {guest_name}\nWe received THB {amount_received} for reservation {reservation_code}\n"
            "Payment status {payment_status}\nContact {contact_phone} / {contact_email}",
        ),
        "payment_failed": (
            "Payment follow-up {reservation_code}",
            "{hotel_name}\nDear {guest_name}\nThe deposit payment for reservation {reservation_code} has not completed.\n"
            "Current status {payment_status}\nRetry using this link {payment_link}\n"
            "Contact {contact_phone} / {contact_email}",
        ),
        "pre_arrival_reminder": (
            "Pre-arrival reminder {reservation_code}",
            "{hotel_name}\nDear {guest_name}\nThis is a reminder for your arrival on {check_in_date}\n"
            "Room type {room_type_name}\nOccupancy {occupancy_summary}\nCheck-in time {hotel_check_in_time}\n"
            "{check_in_policy}\n{hotel_address}\nContact {contact_phone} / {contact_email}",
        ),
        "cancellation_confirmation": (
            "Cancellation confirmed {reservation_code}",
            "{hotel_name}\nDear {guest_name}\nReservation {reservation_code} has been cancelled.\n"
            "Refund / deposit status {payment_status}\nEstimated refund THB {refund_amount}\n"
            "{cancellation_policy}\nContact {contact_phone} / {contact_email}",
        ),
        "modification_confirmation": (
            "Reservation updated {reservation_code}",
            "{hotel_name}\nDear {guest_name}\nReservation {reservation_code} has been updated.\n"
            "{modification_summary}\nStay {check_in_date} to {check_out_date}\n"
            "Room type {room_type_name}\nOccupancy {occupancy_summary}\n"
            "Updated total THB {grand_total}\nContact {contact_phone} / {contact_email}",
        ),
        "cancellation_request_received": (
            "Cancellation request received {reservation_code}",
            "{hotel_name}\nDear {guest_name}\nWe received your cancellation request for {reservation_code} and will review it shortly.",
        ),
        "modification_request_received": (
            "Modification request received {reservation_code}",
            "{hotel_name}\nDear {guest_name}\nWe received your modification request for {reservation_code} and will review availability shortly.",
        ),
        "internal_new_booking_alert": (
            "New booking {reservation_code}",
            "{hotel_name}\nNew booking {reservation_code}\nGuest {guest_name}\n"
            "Stay {check_in_date} to {check_out_date}\nRoom type {room_type_name}\n"
            "Source {source_channel}\nDeposit THB {deposit_amount}\nPayment status {payment_status}",
        ),
        "internal_activity_alert": (
            "Operational update {reservation_code}",
            "{hotel_name}\n{notification_summary}\nReservation {reservation_code}\nGuest {guest_name}\n"
            "Payment status {payment_status}\nContact {contact_phone} / {contact_email}",
        ),
    },
    "zh-Hans": {
        "guest_confirmation": (
            "预订确认 {reservation_code}",
            "{hotel_name}\n尊敬的 {guest_name}\n您的预订号为 {reservation_code}\n"
            "入住 {check_in_date}，退房 {check_out_date}\n房型 {room_type_name}\n"
            "入住人数 {occupancy_summary}\n预计总额 THB {grand_total}\n"
            "押金 THB {deposit_amount}\n入住时间 {hotel_check_in_time} / 退房时间 {hotel_check_out_time}\n"
            "{cancellation_policy}\n{check_in_policy}\n{check_out_policy}\n"
            "联系 {contact_phone} / {contact_email}",
        ),
        "deposit_payment_request": (
            "押金付款链接 {reservation_code}",
            "{hotel_name}\n尊敬的 {guest_name}\n请支付预订 {reservation_code} 的押金 THB {deposit_amount}\n"
            "支付链接 {payment_link}\n链接有效至 {payment_expires_at}\n"
            "{check_in_policy}\n联系 {contact_phone} / {contact_email}",
        ),
        "payment_success": (
            "付款已确认 {reservation_code}",
            "{hotel_name}\n尊敬的 {guest_name}\n我们已收到 THB {amount_received}，对应预订 {reservation_code}\n"
            "付款状态 {payment_status}\n联系 {contact_phone} / {contact_email}",
        ),
        "payment_failed": (
            "付款跟进 {reservation_code}",
            "{hotel_name}\n尊敬的 {guest_name}\n预订 {reservation_code} 的押金付款尚未完成。\n"
            "当前状态 {payment_status}\n请使用此链接重试 {payment_link}\n"
            "联系 {contact_phone} / {contact_email}",
        ),
        "pre_arrival_reminder": (
            "入住提醒 {reservation_code}",
            "{hotel_name}\n尊敬的 {guest_name}\n提醒您将于 {check_in_date} 入住\n"
            "房型 {room_type_name}\n入住人数 {occupancy_summary}\n入住时间 {hotel_check_in_time}\n"
            "{check_in_policy}\n{hotel_address}\n联系 {contact_phone} / {contact_email}",
        ),
        "cancellation_confirmation": (
            "取消确认 {reservation_code}",
            "{hotel_name}\n尊敬的 {guest_name}\n预订 {reservation_code} 已成功取消。\n"
            "退款/押金状态 {payment_status}\n预计退款 THB {refund_amount}\n"
            "{cancellation_policy}\n联系 {contact_phone} / {contact_email}",
        ),
        "modification_confirmation": (
            "修改确认 {reservation_code}",
            "{hotel_name}\n尊敬的 {guest_name}\n您的预订 {reservation_code} 已更新。\n"
            "{modification_summary}\n入住 {check_in_date}，退房 {check_out_date}\n"
            "房型 {room_type_name}\n入住人数 {occupancy_summary}\n"
            "更新后总额 THB {grand_total}\n联系 {contact_phone} / {contact_email}",
        ),
        "cancellation_request_received": (
            "已收到取消请求 {reservation_code}",
            "{hotel_name}\n尊敬的 {guest_name}\n我们已收到您关于 {reservation_code} 的取消请求，并会尽快处理。",
        ),
        "modification_request_received": (
            "已收到修改请求 {reservation_code}",
            "{hotel_name}\n尊敬的 {guest_name}\n我们已收到您关于 {reservation_code} 的修改请求，并会尽快审核。",
        ),
        "internal_new_booking_alert": (
            "新预订 {reservation_code}",
            "{hotel_name}\n新预订 {reservation_code}\n客人 {guest_name}\n"
            "入住 {check_in_date} 至 {check_out_date}\n房型 {room_type_name}\n"
            "渠道 {source_channel}\n押金 THB {deposit_amount}\n付款状态 {payment_status}",
        ),
        "internal_activity_alert": (
            "运营更新 {reservation_code}",
            "{hotel_name}\n{notification_summary}\n预订 {reservation_code}\n客人 {guest_name}\n"
            "付款状态 {payment_status}\n联系 {contact_phone} / {contact_email}",
        ),
    },
}


NOTIFICATION_TEMPLATES_SEED = []
for language in BOOKING_LANGUAGES:
    template_text = _NOTIFICATION_TEMPLATE_TEXT[language]
    for template_key in (
        "guest_confirmation",
        "deposit_payment_request",
        "payment_success",
        "payment_failed",
        "pre_arrival_reminder",
        "cancellation_confirmation",
        "modification_confirmation",
        "cancellation_request_received",
        "modification_request_received",
        "internal_new_booking_alert",
        "internal_activity_alert",
    ):
        subject_template, body_template = template_text[template_key]
        description = template_key.replace("_", " ").title()
        channel = "internal_notification" if template_key.startswith("internal_") else "email"
        NOTIFICATION_TEMPLATES_SEED.append(
            (
                template_key,
                channel,
                language,
                description,
                subject_template,
                body_template,
            )
        )
        if template_key.startswith("internal_"):
            NOTIFICATION_TEMPLATES_SEED.append(
                (
                    template_key,
                    "email",
                    language,
                    f"{description} email",
                    subject_template,
                    body_template,
                )
            )


def setting_value(settings: dict[str, dict], key: str, default: str | int | bool) -> str | int | bool:
    return settings.get(key, {}).get("value", default)


def money_setting(settings: dict[str, dict], key: str, default: str) -> Decimal:
    return Decimal(str(setting_value(settings, key, default)))
