/** The short id of a task or page in a project: the project key and its number, for example `ABC-12`. */
export const codeOf = (key: string | null | undefined, number: number | null | undefined): string | null => (key && number ? `${key}-${number}` : null);
