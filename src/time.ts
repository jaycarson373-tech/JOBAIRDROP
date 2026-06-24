export function currentEpochId(date = new Date()): string {
  const ms = date.getTime();
  const fiveMinutes = 5 * 60 * 1000;
  return new Date(Math.floor(ms / fiveMinutes) * fiveMinutes).toISOString();
}
