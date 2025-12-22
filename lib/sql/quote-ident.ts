// Quote a possibly-qualified identifier (schema.table or table) safely.
// Splits on dots and quotes each part so mixed-case/reserved names work.
export const quoteIdent = (name: string) =>
  name
    .split(".")
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(".")
