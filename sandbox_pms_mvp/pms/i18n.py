from __future__ import annotations

from .constants import BOOKING_LANGUAGES


LANGUAGE_LABELS = {
    "th": "ไทย",
    "en": "English",
    "zh-Hans": "简体中文",
}


BOOKING_COPY = {
    "th": {
        "search_title": "ค้นหาห้องว่าง",
        "book_now": "จองตอนนี้",
        "hold_expired": "ช่วงเวลาการถือห้องหมดอายุแล้ว กรุณาค้นหาใหม่อีกครั้ง",
        "room_unavailable": "ห้องที่เลือกเพิ่งถูกจองไปแล้ว กรุณาเลือกตัวเลือกใหม่",
        "terms_required": "กรุณายอมรับเงื่อนไขการจองก่อนดำเนินการต่อ",
        "invalid_dates": "วันที่เข้าพักต้องมาก่อนวันที่ออก",
        "invalid_occupancy": "จำนวนผู้เข้าพักเกินกว่าที่ห้องรองรับ",
        "duplicate_booking": "เราตรวจพบการจองนี้แล้วและจะพาคุณไปยังหน้าการยืนยันเดิม",
        "cancellation_received": "เราได้รับคำขอยกเลิกของคุณแล้ว",
        "modification_received": "เราได้รับคำขอแก้ไขการจองของคุณแล้ว",
        "policy_summary": "ยกเลิกฟรีก่อนวันเข้าพัก 24 ชั่วโมง หลังจากนั้นอาจมีค่าธรรมเนียม 1 คืน",
        "extra_guest_summary": "ผู้เข้าพักเพิ่ม 200 บาท/คืน เด็ก 6-11 ปี 100 บาท/คืน",
        "checkin_summary": "เช็คอิน 14:00 เช็คเอาต์ 11:00",
        "confirmation_title": "ยืนยันการจอง",
        "review_queue": "คิวตรวจสอบการจองใหม่",
        "guest_email_subject": "ยืนยันการจอง Sandbox Hotel {reference}",
        "payment_email_subject": "ลิงก์ชำระมัดจำ Sandbox Hotel {reference}",
        "payment_email_intro": "กรุณาชำระเงินมัดจำ {amount} ผ่านหน้าชำระเงินที่ปลอดภัยด้านล่าง",
        "payment_pay_deposit": "ชำระมัดจำ",
        "payment_return_title": "สถานะการชำระเงิน",
        "payment_pending": "รอยืนยัน",
        "payment_paid": "ชำระแล้ว",
        "payment_failed": "ชำระไม่สำเร็จ",
        "payment_expired": "ลิงก์หมดอายุ",
        "payment_cancelled": "ยกเลิกแล้ว",
        "payment_processing": "กำลังดำเนินการ",
        "payment_return_pending_body": "เรากำลังยืนยันผลการชำระกับผู้ให้บริการ หากสถานะไม่เปลี่ยนในไม่นาน กรุณาติดต่อโรงแรม",
        "payment_return_paid_body": "เราได้รับเงินมัดจำและนำไปลงในยอดจองของคุณแล้ว",
        "payment_return_failed_body": "การชำระไม่สำเร็จ คุณสามารถลองใหม่ผ่านลิงก์ชำระหรือ ติดต่อโรงแรม",
        "payment_return_expired_body": "ลิงก์ชำระนี้หมดอายุแล้ว กรุณาติดต่อโรงแรมเพื่อรับลิงก์ใหม่",
        "payment_link_unavailable": "ยังไม่สามารถสร้างลิงก์ชำระมัดจำได้ กรุณาติดต่อโรงแรมเพื่อรับความช่วยเหลือ",
        "booking_lookup_not_found": "ไม่พบการจองที่ตรงกับข้อมูลที่ให้ไว้ กรุณาตรวจสอบหมายเลขการจองและอีเมลหรือเบอร์โทรศัพท์อีกครั้ง",
        "terms_acknowledgement": "ฉันยอมรับเงื่อนไขการจองและประกาศความเป็นส่วนตัว",
    },
    "en": {
        "search_title": "Search availability",
        "book_now": "Book now",
        "hold_expired": "Your room hold has expired. Please search again.",
        "room_unavailable": "That room was just taken. Please choose a refreshed option.",
        "terms_required": "You must accept the booking terms before continuing.",
        "invalid_dates": "Check-in must be before check-out.",
        "invalid_occupancy": "Guest count exceeds room occupancy rules.",
        "duplicate_booking": "We found an existing matching booking and will take you to its confirmation.",
        "cancellation_received": "Your cancellation request has been received.",
        "modification_received": "Your modification request has been received.",
        "policy_summary": "Free cancellation up to 24 hours before arrival. Later cancellations may incur one night.",
        "extra_guest_summary": "Extra guest THB 200/night, child 6-11 THB 100/night",
        "checkin_summary": "Check-in 14:00, check-out 11:00",
        "confirmation_title": "Booking confirmed",
        "review_queue": "New booking review queue",
        "guest_email_subject": "Sandbox Hotel booking confirmation {reference}",
        "payment_email_subject": "Sandbox Hotel deposit payment link {reference}",
        "payment_email_intro": "Please pay the deposit of {amount} using the secure hosted payment page below.",
        "payment_pay_deposit": "Pay deposit",
        "payment_return_title": "Payment status",
        "payment_pending": "Pending confirmation",
        "payment_paid": "Paid",
        "payment_failed": "Payment failed",
        "payment_expired": "Payment expired",
        "payment_cancelled": "Payment cancelled",
        "payment_processing": "Processing",
        "payment_return_pending_body": "We are confirming your payment with the provider. If the status does not update shortly, contact the hotel.",
        "payment_return_paid_body": "Your deposit has been received and applied to your reservation folio.",
        "payment_return_failed_body": "The payment did not complete. You can retry from the payment link or contact the hotel.",
        "payment_return_expired_body": "This payment link has expired. Please contact the hotel for a new payment link.",
        "payment_link_unavailable": "We could not generate the deposit payment link yet. Please contact the hotel for assistance.",
        "booking_lookup_not_found": "We could not find a booking matching those details. Please check the booking reference and email or phone.",
        "terms_acknowledgement": "I agree to the booking terms and privacy notice",
    },
    "zh-Hans": {
        "search_title": "查询可订房型",
        "book_now": "立即预订",
        "hold_expired": "您的房间保留已过期，请重新查询。",
        "room_unavailable": "该房型刚刚售完，请查看更新后的可订选项。",
        "terms_required": "继续前请先同意预订条款。",
        "invalid_dates": "入住日期必须早于离店日期。",
        "invalid_occupancy": "入住人数超过房型限制。",
        "duplicate_booking": "系统检测到相同预订，将带您前往已有确认页。",
        "cancellation_received": "我们已收到您的取消申请。",
        "modification_received": "我们已收到您的修改申请。",
        "policy_summary": "入住前24小时可免费取消，逾期可能收取首晚费用。",
        "extra_guest_summary": "加人每晚 THB 200，6-11 岁儿童每晚 THB 100",
        "checkin_summary": "入住 14:00，退房 11:00",
        "confirmation_title": "预订确认",
        "review_queue": "新预订审核队列",
        "guest_email_subject": "Sandbox Hotel 预订确认 {reference}",
        "payment_email_subject": "Sandbox Hotel 押金付款链接 {reference}",
        "payment_email_intro": "请使用下方安全托管付款页面支付 {amount} 押金。",
        "payment_pay_deposit": "支付押金",
        "payment_return_title": "付款状态",
        "payment_pending": "等待确认",
        "payment_paid": "已支付",
        "payment_failed": "付款失败",
        "payment_expired": "链接已过期",
        "payment_cancelled": "已取消",
        "payment_processing": "处理中",
        "payment_return_pending_body": "我们正在与付款服务商确认付款状态。如果状态长时间未更新，请联系酒店。",
        "payment_return_paid_body": "您的押金已收到并记入预订账户。",
        "payment_return_failed_body": "付款未完成。您可以使用付款链接再试一次，或直接联系酒店。",
        "payment_return_expired_body": "该付款链接已过期。请联系酒店获取新的付款链接。",
        "payment_link_unavailable": "我们暂时无法生成押金付款链接，请直接联系酒店获取帮助。",
        "booking_lookup_not_found": "未找到与这些信息匹配的预订。请检查预订号和邮箱或手机号。",
        "terms_acknowledgement": "我同意预订条款和隐私说明",
    },
}


def normalize_language(language: str | None) -> str:
    if language in BOOKING_LANGUAGES:
        return language
    if language == "zh":
        return "zh-Hans"
    return "th"


def t(language: str | None, key: str, **kwargs) -> str:
    lang = normalize_language(language)
    template = BOOKING_COPY.get(lang, BOOKING_COPY["th"]).get(key, BOOKING_COPY["en"].get(key, key))
    return template.format(**kwargs)
