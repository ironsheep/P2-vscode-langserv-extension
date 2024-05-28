/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Usage in an async function:
export async function waitSec(sec: number): Promise<void> {
  // convert sec to milleSec
  await delay(sec * 1000);
}

// Usage in an async function:
export async function waitMSec(ms: number): Promise<void> {
  // just use milleSec
  await delay(ms);
}
