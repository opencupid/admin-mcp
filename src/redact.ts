/** Keys holding contact details that are stripped unless EXPOSE_CONTACT_PII=true. */
export const CONTACT_PII_KEYS = new Set(['email', 'phonenumber'])

/** Returns a deep copy of `value` with all contact PII keys removed. */
export function redactContactPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactContactPii)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !CONTACT_PII_KEYS.has(key))
        .map(([key, v]) => [key, redactContactPii(v)])
    )
  }
  return value
}
