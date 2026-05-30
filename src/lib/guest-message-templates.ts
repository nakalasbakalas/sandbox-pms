import type { GuestMessageTemplate, GuestMessageType } from '@/types/guest-communications'

const bookingConfirmationBody = 'Dear {{guestName}},\n\nThank you for choosing {{hotelName}}! We are delighted to confirm your reservation.\n\nBooking Details:\n- Confirmation Number: {{confirmationNumber}}\n- Check-in: {{checkInDate}} at {{checkInTime}}\n- Check-out: {{checkOutDate}} at {{checkOutTime}}\n- Room Type: {{roomType}}\n- Number of Guests: {{guestCount}}\n- Total Amount: {{totalAmount}} THB\n\nWe look forward to welcoming you!\n\nBest regards,\n{{hotelName}} Team'

const preArrivalBody = 'Dear {{guestName}},\n\nYour stay at {{hotelName}} is just around the corner! We are preparing everything for your arrival on {{checkInDate}}.\n\nQuick Reminders:\n✓ Check-in Time: {{checkInTime}}\n✓ Check-out Time: {{checkOutTime}}\n✓ Room Type: {{roomType}}\n\nGetting Here:\n{{hotelAddress}}\n\nNeed assistance with transportation or have special requests? Just reply to this message.\n\nSee you soon!\n{{hotelName}} Team'

const checkInWelcomeBody = 'Welcome, {{guestName}}!\n\nYou are all checked in to Room {{roomNumber}}. We hope you have a wonderful stay with us.\n\nYour Stay Details:\n- Room: {{roomNumber}}\n- Check-out: {{checkOutDate}} at {{checkOutTime}}\n- WiFi: {{wifiNetwork}} / Password: {{wifiPassword}}\n\nNeed anything? Contact our front desk:\n📞 {{hotelPhone}}\n\nEnjoy your stay!'

const checkOutThankYouBody = 'Dear {{guestName}},\n\nThank you for choosing {{hotelName}}! We hope you enjoyed your stay.\n\nYour Receipt:\n- Confirmation: {{confirmationNumber}}\n- Check-in: {{checkInDate}}\n- Check-out: {{checkOutDate}}\n- Room: {{roomNumber}}\n- Total Paid: {{totalPaid}} THB\n\nWe would love to hear about your experience. Please take a moment to review your stay.\n\nWe hope to welcome you back soon!\n\nBest regards,\n{{hotelName}} Team'

const postStayReviewBody = 'Dear {{guestName}},\n\nWe hope you had a wonderful stay at {{hotelName}}!\n\nYour feedback is incredibly valuable to us. Would you mind taking 2 minutes to share your experience?\n\n[Review Link]\n\nAs a thank you, we would like to offer you 10% off your next booking with us.\n\nLooking forward to welcoming you back!\n\nBest regards,\n{{hotelName}} Team'

const bookingConfirmationTHBody = 'เรียน คุณ{{guestName}}\n\nขอบคุณที่เลือก {{hotelName}}! เรายินดียืนยันการจองของท่าน\n\nรายละเอียดการจอง:\n- หมายเลขการจอง: {{confirmationNumber}}\n- เช็คอิน: {{checkInDate}} เวลา {{checkInTime}}\n- เช็คเอาท์: {{checkOutDate}} เวลา {{checkOutTime}}\n- ประเภทห้อง: {{roomType}}\n- จำนวนผู้เข้าพัก: {{guestCount}}\n- ยอดรวม: {{totalAmount}} บาท\n\nเราตั้งตารอที่จะต้อนรับท่าน!\n\nด้วยความเคารพ\nทีมงาน {{hotelName}}'

const housekeepingScheduleBody = 'Hello {{guestName}},\n\nThis is a friendly reminder that housekeeping will service your room between {{serviceTime}}.\n\nIf you prefer not to be disturbed, please place the "Do Not Disturb" sign on your door or contact the front desk.\n\nThank you!\n{{hotelName}}'

const specialOfferBody = 'Dear {{guestName}},\n\nWe have a special offer exclusively for our valued guests!\n\n{{offerDetails}}\n\nBook now and use code: {{promoCode}}\n\nValid until: {{expiryDate}}\n\nDon\'t miss out!\n\nBest regards,\n{{hotelName}} Team'

export const DEFAULT_GUEST_TEMPLATES: GuestMessageTemplate[] = [
  {
    id: 'booking-confirmation-en',
    name: 'Booking Confirmation (English)',
    type: 'BOOKING_CONFIRMATION',
    subject: 'Booking Confirmation - {{hotelName}}',
    body: bookingConfirmationBody,
    channels: ['EMAIL', 'LINE'],
    variables: ['hotelName', 'guestName', 'confirmationNumber', 'checkInDate', 'checkInTime', 'checkOutDate', 'checkOutTime', 'roomType', 'guestCount', 'totalAmount'],
    isActive: true,
    language: 'EN',
    timingTrigger: { type: 'IMMEDIATE' },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'pre-arrival-en',
    name: 'Pre-Arrival Welcome (English)',
    type: 'PRE_ARRIVAL',
    subject: 'We\'re Ready to Welcome You! - {{hotelName}}',
    body: preArrivalBody,
    channels: ['EMAIL', 'SMS', 'LINE'],
    variables: ['hotelName', 'guestName', 'checkInDate', 'checkInTime', 'checkOutTime', 'roomType', 'hotelAddress'],
    isActive: true,
    language: 'EN',
    timingTrigger: {
      type: 'RELATIVE',
      relativeTo: 'CHECK_IN',
      hoursOffset: -24,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'check-in-welcome-en',
    name: 'Check-in Welcome (English)',
    type: 'CHECK_IN',
    subject: 'Welcome to {{hotelName}}!',
    body: checkInWelcomeBody,
    channels: ['EMAIL', 'SMS', 'LINE'],
    variables: ['hotelName', 'guestName', 'roomNumber', 'checkOutDate', 'checkOutTime', 'wifiNetwork', 'wifiPassword', 'hotelPhone'],
    isActive: true,
    language: 'EN',
    timingTrigger: { type: 'IMMEDIATE' },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'checkout-thankyou-en',
    name: 'Check-out Thank You (English)',
    type: 'CHECK_OUT',
    subject: 'Thank You for Staying with Us!',
    body: checkOutThankYouBody,
    channels: ['EMAIL', 'LINE'],
    variables: ['hotelName', 'guestName', 'confirmationNumber', 'checkInDate', 'checkOutDate', 'roomNumber', 'totalPaid'],
    isActive: true,
    language: 'EN',
    timingTrigger: { type: 'IMMEDIATE' },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'post-stay-review-en',
    name: 'Post-Stay Review Request (English)',
    type: 'POST_STAY',
    subject: 'How Was Your Stay? - {{hotelName}}',
    body: postStayReviewBody,
    channels: ['EMAIL', 'LINE'],
    variables: ['hotelName', 'guestName'],
    isActive: true,
    language: 'EN',
    timingTrigger: {
      type: 'RELATIVE',
      relativeTo: 'CHECK_OUT',
      hoursOffset: 48,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'booking-confirmation-th',
    name: 'ยืนยันการจอง (Thai)',
    type: 'BOOKING_CONFIRMATION',
    subject: 'ยืนยันการจอง - {{hotelName}}',
    body: bookingConfirmationTHBody,
    channels: ['EMAIL', 'LINE', 'SMS'],
    variables: ['hotelName', 'guestName', 'confirmationNumber', 'checkInDate', 'checkInTime', 'checkOutDate', 'checkOutTime', 'roomType', 'guestCount', 'totalAmount'],
    isActive: true,
    language: 'TH',
    timingTrigger: { type: 'IMMEDIATE' },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'in-stay-housekeeping-en',
    name: 'Housekeeping Schedule (English)',
    type: 'IN_STAY',
    subject: 'Daily Housekeeping - Room {{roomNumber}}',
    body: housekeepingScheduleBody,
    channels: ['SMS', 'LINE'],
    variables: ['hotelName', 'guestName', 'roomNumber', 'serviceTime'],
    isActive: false,
    language: 'EN',
    timingTrigger: { type: 'SCHEDULED' },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'special-offer-en',
    name: 'Special Promotion (English)',
    type: 'SPECIAL_OFFER',
    subject: 'Special Offer Just for You! - {{hotelName}}',
    body: specialOfferBody,
    channels: ['EMAIL', 'LINE'],
    variables: ['hotelName', 'guestName', 'offerDetails', 'promoCode', 'expiryDate'],
    isActive: false,
    language: 'EN',
    timingTrigger: { type: 'IMMEDIATE' },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]

export function getTemplatesByType(type: GuestMessageType): GuestMessageTemplate[] {
  return DEFAULT_GUEST_TEMPLATES.filter(t => t.type === type)
}

export function getTemplatesByLanguage(language: 'EN' | 'TH'): GuestMessageTemplate[] {
  return DEFAULT_GUEST_TEMPLATES.filter(t => t.language === language)
}

export function getActiveTemplates(): GuestMessageTemplate[] {
  return DEFAULT_GUEST_TEMPLATES.filter(t => t.isActive)
}

export function replaceTemplateVariables(
  template: string,
  variables: Record<string, string>
): string {
  let result = template
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value)
  })
  return result
}
