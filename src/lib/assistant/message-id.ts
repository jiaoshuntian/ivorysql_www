type CryptoSource = {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint32Array) => Uint32Array;
};

let fallbackSequence = 0;

export function createMessageId(
  cryptoSource: CryptoSource | undefined = globalThis.crypto,
): string {
  if (typeof cryptoSource?.randomUUID === "function") {
    return cryptoSource.randomUUID();
  }

  if (typeof cryptoSource?.getRandomValues === "function") {
    const values = cryptoSource.getRandomValues(new Uint32Array(4));
    return Array.from(values, (value) =>
      value.toString(16).padStart(8, "0"),
    ).join("");
  }

  fallbackSequence += 1;
  return `${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
}
