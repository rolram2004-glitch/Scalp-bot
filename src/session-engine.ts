export function getSession(): string {
  const hour = new Date().getUTCHours();

  if (hour >= 7 && hour < 9) {
    return "LONDON_OPEN";
  }

  if (hour >= 9 && hour < 13) {
    return "LONDON";
  }

  if (hour >= 13 && hour < 16) {
    return "LONDON_NY_OVERLAP";
  }

  if (hour >= 16 && hour < 21) {
    return "NEW_YORK";
  }

  if (hour >= 21 && hour < 23) {
    return "NY_CLOSE";
  }

  if (hour >= 0 && hour < 7) {
    return "TOKYO";
  }

  return "OFF_HOURS";
}

export function isKillzone(): boolean {
  const hour = new Date().getUTCHours();

  return (
    (hour >= 7 && hour < 9) ||
    (hour >= 13 && hour < 15)
  );
}
