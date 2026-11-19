import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { dialOf } from "@/lib/dials";

const LIVE = new Set(["MOBILE", "FIXED_LINE", "FIXED_LINE_OR_MOBILE"]);

export function nationalDigits(iso: string, local: string) {
  const code = dialOf(iso).replace(/\D/g, "");
  let digits = local.replace(/\D/g, "");
  if (digits.startsWith(code) && digits.length > code.length) digits = digits.slice(code.length);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

function live(iso: string, digits: string) {
  const parsed = parsePhoneNumberFromString(`${dialOf(iso)}${digits}`, iso as CountryCode);
  if (!parsed?.isValid()) return false;
  if (parsed.country && parsed.country !== iso) return false;
  const type = parsed.getType();
  return Boolean(type && LIVE.has(type));
}

export function phoneOk(iso: string, local: string) {
  const digits = nationalDigits(iso, local);
  return digits.length > 0 && live(iso, digits);
}

export function phoneOkFull(value: string) {
  const parsed = parsePhoneNumberFromString(value.replace(/[^\d+]/g, ""));
  if (!parsed?.isValid() || !parsed.country) return false;
  const type = parsed.getType();
  return Boolean(type && LIVE.has(type));
}
