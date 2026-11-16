import { Transform } from 'class-transformer';

/** Trim string; nilai non-string dibiarkan agar validator yang menolaknya. */
export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Trim + lowercase (untuk email). */
export const TrimLowerCase = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
