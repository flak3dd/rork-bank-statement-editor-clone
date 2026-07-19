/**
 * Pure math / formatting utilities used by the bank-statement description generators.
 * No React, no DOM, no UI — only deterministic-style random sampling and formatting.
 */

/** Return a uniformly random integer in the inclusive range [min, max]. */
export function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Return a uniformly random element from an array. */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Zero-pad a number to at least two digits. */
export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Alias for rand() when the result is used as a reference number. */
export function randRef(min, max) {
  return rand(min, max);
}

/** Generate a random monetary amount between min and max with the given decimal precision. */
export function amount(min, max, decimals = 2) {
  const value = min + Math.random() * (max - min);
  return value.toFixed(decimals);
}

/** Generate a random integer amount, useful for whole-dollar or whole-cent values. */
export function integerAmount(min, max) {
  return rand(min, max);
}

/** Format a day/month pair as dd/mm, zero-padding each component. */
export function formatShortDate(day, month) {
  return `${pad2(day)}/${pad2(month)}`;
}

/** Format a 24-hour time string from random or supplied hour and minute. */
export function formatTime(hour = rand(0, 23), minute = rand(0, 59)) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** Return one of two values based on a boolean condition. */
export function conditional(condition, ifTrue, ifFalse = '') {
  return condition ? ifTrue : ifFalse;
}

/** Build a string from a template function that receives the supplied utility helpers. */
export function build(template, helpers = { rand, pick, pad2, amount, formatShortDate, formatTime, conditional }) {
  return template(helpers);
}

/** Convenience: sample one formatter from a list of template functions and execute it. */
export function sample(templates, helpers = { rand, pick, pad2, amount, formatShortDate, formatTime, conditional }) {
  const t = pick(templates);
  return typeof t === 'function' ? t(helpers) : t;
}
