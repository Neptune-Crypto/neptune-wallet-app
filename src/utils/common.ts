import BigNumber from "bignumber.js";
// +
export function bigNumberPlus(a: any, b: any) {
  a = BigNumber(a);
  b = BigNumber(b);
  return a.plus(b).toNumber();
}
// +
export function bigNumberPlusToString(a: any, b: any) {
  a = BigNumber(a);
  b = BigNumber(b);
  return a.plus(b).toFixed().toString();
}
// -
export function bigNumberMinus(a: any, b: any) {
  a = BigNumber(a);
  b = BigNumber(b);
  return a.minus(b).toNumber();
}
// *
export function bigNumberTimes(a: any, b: any) {
  a = BigNumber(a);
  b = BigNumber(b);
  return a.times(b).toNumber();
}
// *
export function bigNumberTimesToString(a: any, b: any) {
  a = BigNumber(a);
  b = BigNumber(b);
  return a.times(b).toFixed().toString();
}
// /
export function bigNumberDiv(a: any, b: any) {
  a = BigNumber(a);
  b = BigNumber(b);
  return a.div(b).toNumber();
}

export const sleep_milliseconds = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isValidUrl(urlString: string) {
  try {
    new URL(urlString);
    return true;
  } catch (err) {
    return false;
  }
}
