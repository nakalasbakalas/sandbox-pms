export const bookingEmailParserFixtures = [
  {
    name: 'new booking template',
    input: {
      subject: 'New booking confirmed LH-ABCD1234',
      rawText: 'Lead guest: Alice Tan Booking reference: LH-ABCD1234 Check-in date: 2026-07-12 Check-out date: 2026-07-14 Room type: Deluxe Double Room Adults: 2 Children: 1 Total amount: THB 6400 Payment received.',
    },
    expected: {
      eventType: 'NEW_BOOKING',
      channelRef: 'LH-ABCD1234',
      guestName: 'Alice Tan',
      checkIn: '2026-07-12',
      checkOut: '2026-07-14',
      roomType: 'DOUBLE',
      amount: 6400,
      paymentStatus: 'PAID',
    },
  },
  {
    name: 'modification template',
    input: {
      subject: 'Booking modified TRIP-7788',
      rawText: 'Guest name: Ben Porter Reservation ID: TRIP-7788 Checkin: 13/07/2026 Checkout: 15/07/2026 Room type: Twin Room Total amount: THB 4800',
    },
    expected: {
      eventType: 'MODIFICATION',
      channelRef: 'TRIP-7788',
      guestName: 'Ben Porter',
      checkIn: '2026-07-13',
      checkOut: '2026-07-15',
      roomType: 'TWIN',
      amount: 4800,
      paymentStatus: undefined,
    },
  },
  {
    name: 'cancellation template',
    input: {
      subject: 'Reservation cancelled ASC-9001',
      rawText: 'Guest name: Cara Mills Reservation reference: ASC-9001 Arrival date: 2026-07-20 Departure date: 2026-07-22 Room type: Deluxe Double Room',
    },
    expected: {
      eventType: 'CANCELLATION',
      channelRef: 'ASC-9001',
      guestName: 'Cara Mills',
      checkIn: '2026-07-20',
      checkOut: '2026-07-22',
      roomType: 'DOUBLE',
      amount: undefined,
      paymentStatus: undefined,
    },
  },
  {
    name: 'guest message template',
    input: {
      subject: 'Guest message for reservation MSG-4455',
      rawText: 'Guest name: Daniel Reed Reservation ID: MSG-4455 Check-in date: 2026-07-18 Check-out date: 2026-07-20 Room type: Twin Room Guest message: Please confirm a late arrival.',
    },
    expected: {
      eventType: 'GUEST_MESSAGE',
      channelRef: 'MSG-4455',
      guestName: 'Daniel Reed',
      checkIn: '2026-07-18',
      checkOut: '2026-07-20',
      roomType: 'TWIN',
      amount: undefined,
      paymentStatus: undefined,
    },
  },
  {
    name: 'payment notice template',
    input: {
      subject: 'Payment received PAY-5511',
      rawText: 'Guest name: Erin Shaw Booking reference: PAY-5511 Stay dates: 18/07/2026 - 20/07/2026 Room type: Deluxe Double Room Amount received: THB 3200 Payment received in full.',
    },
    expected: {
      eventType: 'PAYMENT_NOTICE',
      channelRef: 'PAY-5511',
      guestName: 'Erin Shaw',
      checkIn: '2026-07-18',
      checkOut: '2026-07-20',
      roomType: 'DOUBLE',
      amount: 3200,
      paymentStatus: 'PAID',
    },
  },
]
