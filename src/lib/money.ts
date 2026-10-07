/**
 * An offer amount, in whole units — the one reading of it in the app.
 *
 * No imports, so the offer card can run the same parse in the browser that the
 * data layer runs on the server. The card used to have its own, which turned
 * "€215.000" into 215 and "$" into 0 after this one had been taught to refuse
 * both: two parsers, and the screen where people compare offers had the wrong
 * one.
 *
 * Assistants send "215k", "$215,000" and 215000 for the same figure, and a
 * person typing into the form sends "". All three of the first shapes mean the
 * same thing and are accepted; "" and null mean "not sent" and come back
 * undefined; anything else that is not a number is refused rather than stored
 * as zero, because zero on a comparison table reads as "they offered nothing".
 */

/** Postgres INTEGER, and the reason amounts are whole units rather than cents. */
export const MAX_AMOUNT = 2_147_483_647;

export function parseAmount(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    // A string with no digit in it is not a figure. Without this, " ", "$" and
    // "k" all reach Number("") and land as a real zero.
    if (!/\d/.test(raw)) throw new Error(`${field} is not a number: "${value}"`);
    // "215.000" is two hundred and fifteen thousand in half of Europe and two
    // hundred and fifteen everywhere else, and guessing wrong is a 1000× error
    // sitting next to correctly-read columns. Refused rather than guessed.
    if (/\d\.\d{3}(\D|$)/.test(raw)) {
      throw new Error(
        `${field} is ambiguous: "${value}" could be thousands or a decimal. Send it as digits, like 215000.`,
      );
    }
    const clean = raw.replace(/[$£€,\s]/g, "");
    const k = clean.endsWith("k");
    const parsed = Number(k ? clean.slice(0, -1) : clean);
    if (!Number.isFinite(parsed)) throw new Error(`${field} is not a number: "${value}"`);
    n = k ? parsed * 1000 : parsed;
  } else throw new Error(`${field} is not a number`);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be zero or more`);
  if (n > MAX_AMOUNT) throw new Error(`${field} is larger than this column can hold`);
  return Math.round(n);
}
