/** Escape karakter wildcard LIKE agar input user tidak berperan sebagai pola. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
