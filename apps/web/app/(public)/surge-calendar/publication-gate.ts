export function isSurgeCalendarPublicationEnabled(value = process.env.SURGE_CALENDAR_PUBLICATION_ENABLED): boolean {
  return value === "true";
}
