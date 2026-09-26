// Formats an event's eventDate (+ optional endDate) into display strings for
// the event-notification email. Fixed to America/Los_Angeles rather than the
// server's default timezone: Cloud Functions run in UTC, and Roze enters
// event times while physically in the LA area, so formatting in the server's
// own timezone would show subscribers the wrong local time.
const TIME_ZONE = "America/Los_Angeles";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

// en-CA gives YYYY-MM-DD, a stable sortable/comparable key -- used only to
// compare calendar days in TIME_ZONE, not for display.
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

function formatEventDateTime(eventDate, endDate) {
  const start = toDate(eventDate);
  if (!start) return { dateText: "", timeText: "" };

  const end = toDate(endDate);
  // Mirrors the admin app's own hasDistinctEndDate check
  // (events_screen.dart) so the email and admin UI agree on what counts as
  // a multi-day event.
  const hasDistinctEnd = end && end.getTime() !== start.getTime();

  if (!hasDistinctEnd) {
    return { dateText: dateFormatter.format(start), timeText: timeFormatter.format(start) };
  }

  const sameDay = dayKeyFormatter.format(start) === dayKeyFormatter.format(end);

  if (sameDay) {
    return {
      dateText: dateFormatter.format(start),
      timeText: `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`,
    };
  }

  return {
    dateText: `${dateFormatter.format(start)} – ${dateFormatter.format(end)}`,
    timeText: `Starts ${timeFormatter.format(start)}`,
  };
}

module.exports = { formatEventDateTime };
