/** Flatten nested JSON message objects into react-intl dot-notation keys. */
export function flattenMessages(
  nested: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  return Object.keys(nested).reduce<Record<string, string>>((messages, key) => {
    const value = nested[key];
    const prefixedKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      messages[prefixedKey] = value;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(messages, flattenMessages(value as Record<string, unknown>, prefixedKey));
    }

    return messages;
  }, {});
}
