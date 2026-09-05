export type DbTimestamp = Date | string;

export function dbTimestamp(value: DbTimestamp): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("Invalid database timestamp.");
    }

    return value;
  }

  if (typeof value !== "string") {
    throw new TypeError("Invalid database timestamp.");
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError("Invalid database timestamp.");
  }

  return timestamp;
}
