export function parseAppDate(value) {
  if (!value) return new Date(NaN)
  if (value instanceof Date) return value

  const stringValue = String(value)

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stringValue)) {
    return new Date(stringValue.replace(' ', 'T') + 'Z')
  }

  return new Date(stringValue)
}

export function formatSystemDate(value, options) {
  return parseAppDate(value).toLocaleDateString(undefined, options)
}

export function formatSystemTime(value, options) {
  return parseAppDate(value).toLocaleTimeString(undefined, options)
}

export function getAppTimestamp() {
  return new Date().toISOString()
}
