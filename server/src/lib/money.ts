const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function normalizeMoneyInput(value: string) {
  const trimmed = value.trim();

  if (!MONEY_PATTERN.test(trimmed)) {
    throw new Error("Amounts must be positive numbers with up to 2 decimal places.");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const normalized = `${whole}.${fraction.padEnd(2, "0")}`;

  if (normalized === "0.00") {
    throw new Error("Amounts must be positive numbers with up to 2 decimal places.");
  }

  return normalized;
}

export function moneyToCents(value: string) {
  const normalized = normalizeMoneyInput(value);
  const [whole, fraction] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction);
}

export function centsToMoney(cents: number) {
  const whole = Math.floor(cents / 100);
  const fraction = Math.abs(cents % 100)
    .toString()
    .padStart(2, "0");

  return `${whole}.${fraction}`;
}

export function sumMoney(values: string[]) {
  return centsToMoney(values.reduce((sum, value) => sum + moneyToCents(value), 0));
}
