import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import -- eventNotification.js requires()
// this module via CJS at the top of its file (used in its tested handler,
// not just a v8-ignored wrapper). An ESM import and a CJS require() of the
// same file create two separate module instances under this suite's v8
// coverage provider, and the merged report only credits one of them --
// matching the loading mechanism here is what makes the exercised
// coverage actually merge (confirmed empirically while debugging the
// identical symptom on lib/confirmationToken.js).
const require = createRequire(import.meta.url);
const {
  orderDataToConfirmationEmailParams,
  orderShippedEmailParams,
  eventNotificationEmailParams,
  newsletterConfirmationEmailParams,
  newsletterWelcomeEmailParams,
  formatAddressRaw,
} = require('./emailPayload.js');

function fullOrder(overrides = {}) {
  return {
    status: 'paid',
    stripeSessionId: 'cs_test_abc123',
    stripePaymentIntentId: 'pi_test_xyz',
    customer: { email: 'buyer@example.com', name: 'Buyer Name', phone: '555-1234' },
    items: [{ name: 'Blue Branches', qty: 1, amountTotal: 70 }],
    total: 70,
    currency: 'usd',
    shippingAddress: {
      name: 'Buyer Name',
      line1: '123 Main St',
      line2: null,
      city: 'Springfield',
      state: 'CA',
      postalCode: '90210',
      country: 'US',
    },
    notes: 'gift wrap please',
    ...overrides,
  };
}

describe('orderDataToConfirmationEmailParams', () => {
  it('maps a full order to Brevo template params', () => {
    const params = orderDataToConfirmationEmailParams(fullOrder());

    expect(params).toEqual({
      EMAIL: 'buyer@example.com',
      ORDER_NUMBER: 'cs_test_abc123',
      ORDER_TOTAL: '$70.00',
      CUSTOMER_NAME: 'Buyer Name',
      ITEMS: [{ name: 'Blue Branches', qty: 1, amountTotal: 70 }],
      ITEMS_TEXT: 'Blue Branches (x1) — $70.00',
      SHIPPING_ADDRESS: '123 Main St, Springfield, CA 90210, US',
    });
  });

  it('joins multiple items in ITEMS_TEXT with <br> — plain email templates render '
    + 'params via string substitution into already-built HTML, so a real line break '
    + 'needs an HTML tag, not just \\n, which browsers collapse to a space', () => {
    const order = fullOrder({
      items: [
        { name: 'Blue Branches', qty: 1, amountTotal: 70 },
        { name: 'Tiny Terracotta', qty: 2, amountTotal: 15 },
      ],
      total: 100,
    });

    const params = orderDataToConfirmationEmailParams(order);

    expect(params.ITEMS_TEXT).toBe(
      'Blue Branches (x1) — $70.00<br>Tiny Terracotta (x2) — $15.00'
    );
  });

  it('formats a shipping address with line2 when present', () => {
    const order = fullOrder({
      shippingAddress: {
        name: 'Buyer Name',
        line1: '123 Main St',
        line2: 'Apt 4B',
        city: 'Springfield',
        state: 'CA',
        postalCode: '90210',
        country: 'US',
      },
    });

    const params = orderDataToConfirmationEmailParams(order);

    expect(params.SHIPPING_ADDRESS).toBe('123 Main St, Apt 4B, Springfield, CA 90210, US');
  });

  it('defaults SHIPPING_ADDRESS to an empty string when null', () => {
    const order = fullOrder({ shippingAddress: null });

    const params = orderDataToConfirmationEmailParams(order);

    expect(params.SHIPPING_ADDRESS).toBe('');
  });

  it('defaults CUSTOMER_NAME to an empty string when absent', () => {
    const order = fullOrder({ customer: { email: 'buyer@example.com', name: null, phone: null } });

    const params = orderDataToConfirmationEmailParams(order);

    expect(params.CUSTOMER_NAME).toBe('');
  });

  it('formats ORDER_TOTAL with two decimal places even for whole dollar amounts', () => {
    const order = fullOrder({ total: 45.5 });

    const params = orderDataToConfirmationEmailParams(order);

    expect(params.ORDER_TOTAL).toBe('$45.50');
  });

  it('escapes HTML in CUSTOMER_NAME, item names, and SHIPPING_ADDRESS, since these are '
    + 'customer-supplied text interpolated unescaped into the Brevo template body', () => {
    const order = fullOrder({
      customer: { email: 'buyer@example.com', name: '<b>Buyer</b>', phone: null },
      items: [{ name: '<img src=x onerror=alert(1)>', qty: 1, amountTotal: 70 }],
      shippingAddress: {
        name: 'Buyer',
        line1: '<script>alert(1)</script>',
        line2: null,
        city: 'Springfield',
        state: 'CA',
        postalCode: '90210',
        country: 'US',
      },
    });

    const params = orderDataToConfirmationEmailParams(order);

    expect(params.CUSTOMER_NAME).toBe('&lt;b&gt;Buyer&lt;/b&gt;');
    expect(params.ITEMS_TEXT).toBe('&lt;img src=x onerror=alert(1)&gt; (x1) — $70.00');
    expect(params.SHIPPING_ADDRESS).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;, Springfield, CA 90210, US'
    );
  });
});

describe('orderShippedEmailParams', () => {
  function fullShippingDetails(overrides = {}) {
    return {
      trackingNumber: '1Z999AA10123456784',
      carrier: 'UPS',
      trackingUrl: 'https://ups.com/track?n=1Z999AA10123456784',
      estimatedDelivery: '2026-09-30',
      ...overrides,
    };
  }

  function fullOrderDetails(overrides = {}) {
    return {
      orderNumber: 'ORD-1001',
      customerName: 'Buyer Name',
      shippingAddress: '123 Main St, Springfield, CA 90210, US',
      ...overrides,
    };
  }

  it('maps email, order details, and shipping details to Brevo template params', () => {
    const params = orderShippedEmailParams(
      'buyer@example.com',
      fullOrderDetails(),
      fullShippingDetails()
    );

    expect(params).toEqual({
      EMAIL: 'buyer@example.com',
      ORDER_NUMBER: 'ORD-1001',
      CUSTOMER_NAME: 'Buyer Name',
      TRACKING_NUMBER: '1Z999AA10123456784',
      CARRIER: 'UPS',
      TRACKING_URL: 'https://ups.com/track?n=1Z999AA10123456784',
      ESTIMATED_DELIVERY: '2026-09-30',
      SHIPPING_ADDRESS: '123 Main St, Springfield, CA 90210, US',
    });
  });

  it('defaults ORDER_NUMBER to N/A when absent, and other fields to empty strings', () => {
    const params = orderShippedEmailParams(
      'buyer@example.com',
      { orderNumber: undefined, customerName: undefined, shippingAddress: undefined },
      { trackingNumber: undefined, carrier: undefined, trackingUrl: undefined, estimatedDelivery: undefined }
    );

    expect(params).toEqual({
      EMAIL: 'buyer@example.com',
      ORDER_NUMBER: 'N/A',
      CUSTOMER_NAME: '',
      TRACKING_NUMBER: '',
      CARRIER: '',
      TRACKING_URL: '',
      ESTIMATED_DELIVERY: '',
      SHIPPING_ADDRESS: '',
    });
  });

  it('escapes HTML in caller-supplied order and shipping fields, since they are '
    + 'interpolated unescaped into the Brevo template body', () => {
    const params = orderShippedEmailParams(
      'buyer@example.com',
      fullOrderDetails({
        customerName: '<b>Buyer</b>',
        shippingAddress: '<script>alert(1)</script>',
      }),
      fullShippingDetails({ carrier: '<img src=x onerror=alert(1)>' })
    );

    expect(params.CUSTOMER_NAME).toBe('&lt;b&gt;Buyer&lt;/b&gt;');
    expect(params.SHIPPING_ADDRESS).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(params.CARRIER).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('coerces a numeric ORDER_NUMBER to a string instead of throwing, since these are '
    + 'onCall inputs with no type validation at the boundary', () => {
    const params = orderShippedEmailParams(
      'buyer@example.com',
      fullOrderDetails({ orderNumber: 1001 }),
      fullShippingDetails()
    );

    expect(params.ORDER_NUMBER).toBe('1001');
  });
});

describe('formatAddressRaw', () => {
  it('joins address parts the same way formatAddress does, without escaping', () => {
    expect(formatAddressRaw({
      line1: '123 Main St',
      line2: 'Apt 4B',
      city: 'Springfield',
      state: 'CA',
      postalCode: '90210',
      country: 'US',
    })).toBe('123 Main St, Apt 4B, Springfield, CA 90210, US');
  });

  it('leaves HTML-significant characters unescaped, for a caller that will escape the whole joined string itself', () => {
    expect(formatAddressRaw({
      line1: 'Smith & Sons, 5 <Main> St',
      city: 'Springfield',
      state: 'CA',
      postalCode: '90210',
      country: 'US',
    })).toBe('Smith & Sons, 5 <Main> St, Springfield, CA 90210, US');
  });

  it('returns an empty string for a null address', () => {
    expect(formatAddressRaw(null)).toBe('');
  });
});

describe('eventNotificationEmailParams', () => {
  // Firestore Timestamps expose .toDate() -- this fake mimics just enough
  // of that surface for the pure formatting logic under test.
  function ts(date) {
    return { toDate: () => date };
  }

  function fullEvent(overrides = {}) {
    return {
      title: 'Succulent Workshop',
      // 2026-10-15 18:00 America/Los_Angeles == 2026-10-16 01:00 UTC (PDT)
      eventDate: ts(new Date('2026-10-16T01:00:00Z')),
      endDate: null,
      location: 'MyFriendRoze Studio',
      description: 'Learn to arrange your own succulent garden.',
      link: 'https://myfriendroze.com/events/succulent-workshop',
      ...overrides,
    };
  }

  it('maps the real event doc and subscriber info to Brevo template params', () => {
    const params = eventNotificationEmailParams(
      fullEvent(),
      'subscriber@example.com',
      'https://example.com/unsub?type=events',
      'https://example.com/unsub?type=all'
    );

    expect(params).toEqual({
      EMAIL: 'subscriber@example.com',
      EVENT_TITLE: 'Succulent Workshop',
      EVENT_DATE: 'Thursday, October 15, 2026',
      EVENT_TIME: '6:00 PM',
      EVENT_LOCATION: 'MyFriendRoze Studio',
      EVENT_DESCRIPTION: 'Learn to arrange your own succulent garden.',
      EVENT_LINK: 'https://myfriendroze.com/events/succulent-workshop',
      UNSUBSCRIBE_EVENTS: 'https://example.com/unsub?type=events',
      UNSUBSCRIBE_ALL: 'https://example.com/unsub?type=all',
    });
  });

  it('defaults EVENT_TITLE to "Special Event" when absent, and other fields to empty strings', () => {
    const params = eventNotificationEmailParams(
      {
        title: undefined,
        eventDate: null,
        endDate: null,
        location: undefined,
        description: undefined,
        link: undefined,
      },
      'subscriber@example.com',
      'https://example.com/unsub?type=events',
      'https://example.com/unsub?type=all'
    );

    expect(params.EVENT_TITLE).toBe('Special Event');
    expect(params.EVENT_DATE).toBe('');
    expect(params.EVENT_TIME).toBe('');
    expect(params.EVENT_LOCATION).toBe('');
    expect(params.EVENT_DESCRIPTION).toBe('');
    expect(params.EVENT_LINK).toBe('');
  });

  it('formats a multi-day event as a date range with a start time', () => {
    const params = eventNotificationEmailParams(
      fullEvent({
        eventDate: ts(new Date('2026-10-16T01:00:00Z')), // Oct 15, 6:00 PM PDT
        endDate: ts(new Date('2026-10-17T20:00:00Z')), // Oct 17, 1:00 PM PDT
      }),
      'subscriber@example.com',
      'https://example.com/unsub?type=events',
      'https://example.com/unsub?type=all'
    );

    expect(params.EVENT_DATE).toBe('Thursday, October 15, 2026 – Saturday, October 17, 2026');
    expect(params.EVENT_TIME).toBe('Starts 6:00 PM');
  });

  it('escapes HTML in Roze-entered event fields, since they are interpolated '
    + 'unescaped into the Brevo template body', () => {
    const params = eventNotificationEmailParams(
      fullEvent({
        title: '<b>Workshop</b>',
        description: '<script>alert(1)</script>',
        location: '<img src=x onerror=alert(1)>',
      }),
      'subscriber@example.com',
      'https://example.com/unsub?type=events',
      'https://example.com/unsub?type=all'
    );

    expect(params.EVENT_TITLE).toBe('&lt;b&gt;Workshop&lt;/b&gt;');
    expect(params.EVENT_DESCRIPTION).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(params.EVENT_LOCATION).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('passes EMAIL and unsubscribe URLs through unescaped, since they are Firestore/HMAC '
    + 'generated rather than caller-supplied free text', () => {
    const params = eventNotificationEmailParams(
      fullEvent(),
      'subscriber@example.com',
      'https://example.com/unsub?type=events&token=abc&x=1',
      'https://example.com/unsub?type=all&token=def&x=2'
    );

    expect(params.EMAIL).toBe('subscriber@example.com');
    expect(params.UNSUBSCRIBE_EVENTS).toBe('https://example.com/unsub?type=events&token=abc&x=1');
    expect(params.UNSUBSCRIBE_ALL).toBe('https://example.com/unsub?type=all&token=def&x=2');
  });
});

describe('newsletterConfirmationEmailParams', () => {
  it('maps email/greeting/confirmUrl to Brevo template params', () => {
    const params = newsletterConfirmationEmailParams({
      email: 'buyer@example.com',
      firstName: 'Roze',
      confirmUrl: 'https://example.com/confirm?token=abc',
    });

    expect(params).toEqual({
      EMAIL: 'buyer@example.com',
      GREETING: 'Hi Roze,',
      CONFIRM_URL: 'https://example.com/confirm?token=abc',
    });
  });

  // Computed in code rather than left to a Brevo conditional tag (whose
  // syntax isn't confirmed against current docs, same reasoning as
  // order-confirmation.html) -- avoids a template ever rendering "Hi ,".
  it('falls back to a generic greeting when no first name is given', () => {
    const params = newsletterConfirmationEmailParams({
      email: 'buyer@example.com',
      confirmUrl: 'https://example.com/confirm?token=abc',
    });

    expect(params.GREETING).toBe('Hi there,');
  });

  it('falls back to a generic greeting for a blank first name', () => {
    const params = newsletterConfirmationEmailParams({
      email: 'buyer@example.com',
      firstName: '   ',
      confirmUrl: 'https://example.com/confirm?token=abc',
    });

    expect(params.GREETING).toBe('Hi there,');
  });

  // firstName is request-controlled (the signup form) and gets interpolated
  // into an email Brevo actually sends under this site's trusted sender
  // identity -- unescaped, a crafted name could inject markup.
  it('HTML-escapes a firstName containing markup', () => {
    const params = newsletterConfirmationEmailParams({
      email: 'buyer@example.com',
      firstName: '<img src=x onerror=alert(1)>',
      confirmUrl: 'https://example.com/confirm?token=abc',
    });

    expect(params.GREETING).not.toContain('<img');
    expect(params.GREETING).toBe('Hi &lt;img src=x onerror=alert(1)&gt;,');
  });
});

describe('newsletterWelcomeEmailParams', () => {
  it('maps email/greeting/unsubscribe links to Brevo template params', () => {
    const params = newsletterWelcomeEmailParams({
      email: 'buyer@example.com',
      firstName: 'Roze',
      unsubscribeNewsletter: 'https://example.com/unsub?type=newsletter',
      unsubscribeAll: 'https://example.com/unsub?type=all',
    });

    expect(params).toEqual({
      EMAIL: 'buyer@example.com',
      GREETING: 'Hi Roze,',
      UNSUBSCRIBE_NEWSLETTER: 'https://example.com/unsub?type=newsletter',
      UNSUBSCRIBE_ALL: 'https://example.com/unsub?type=all',
    });
  });

  it('falls back to a generic greeting when no first name is given', () => {
    const params = newsletterWelcomeEmailParams({
      email: 'buyer@example.com',
      unsubscribeNewsletter: 'https://example.com/unsub?type=newsletter',
      unsubscribeAll: 'https://example.com/unsub?type=all',
    });

    expect(params.GREETING).toBe('Hi there,');
  });

  it('HTML-escapes a firstName containing markup', () => {
    const params = newsletterWelcomeEmailParams({
      email: 'buyer@example.com',
      firstName: '<img src=x onerror=alert(1)>',
      unsubscribeNewsletter: 'https://example.com/unsub?type=newsletter',
      unsubscribeAll: 'https://example.com/unsub?type=all',
    });

    expect(params.GREETING).not.toContain('<img');
  });
});
