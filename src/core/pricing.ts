export type UsdPrice = `${number}`;

export function isValidPrice(price: string): price is UsdPrice {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(price) && Number(price) > 0;
}

export function priceToUsdcAtomicUnits(price: UsdPrice): string {
  const [whole = '0', fraction = ''] = price.split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))).toString();
}
