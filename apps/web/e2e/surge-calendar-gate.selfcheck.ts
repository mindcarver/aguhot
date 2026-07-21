import { isSurgeCalendarPublicationEnabled } from "../app/(public)/surge-calendar/publication-gate";

const assertions = [
  ["default stays closed", !isSurgeCalendarPublicationEnabled(undefined)],
  ["only the explicit true value opens publication", isSurgeCalendarPublicationEnabled("true")],
  ["other values stay closed", !isSurgeCalendarPublicationEnabled("TRUE")],
];

let failed = 0;
for (const [name, passed] of assertions) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed++;
}
if (failed > 0) process.exit(1);
