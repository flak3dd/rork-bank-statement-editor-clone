/** Ambient types for the ESM bank description generator module. */
export function genAnz(): string;
export function genCba(): string;
export function genWestpac(): string;
export function genIng(): string;
export function genBankwest(): string;
export function genSuncorp(): string;
export function genMacquarie(): string;
export function genRams(): string;
export function genOther(): string;

export const generators: Record<string, () => string>;
