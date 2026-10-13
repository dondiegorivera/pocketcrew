import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison of a presented secret with the expected one; an unset expected secret never matches. */
export const sameSecret = (given: string, expected: string | undefined) =>
	!!expected && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
