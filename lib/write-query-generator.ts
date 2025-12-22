import { quoteIdent } from "@/lib/sql/quote-ident"

export type GeneratorMode = "insert" | "update"

export type GeneratorParamState = {
  name: string
  dataType: string
  inputType: "string" | "number" | "boolean"
  isNullable: boolean
  isAuto: boolean
  isPk: boolean
  role?: "set" | "where"
  overrideAuto?: boolean
  isNull?: boolean
  value: string
}

export type GeneratorConfig = {
  mode: GeneratorMode
  table: { schema: string; name: string }
  params: GeneratorParamState[]
  allowUnsafeUpdate?: boolean
}

const isEmptyValue = (value: string | undefined) => !value || value.trim() === ""

const toSqlLiteralByType = (value: string, type: GeneratorParamState["inputType"]) => {
  if (type === "number") {
    const trimmed = value.trim()
    if (trimmed === "") return "NULL"
    const num = Number(trimmed)
    return Number.isFinite(num) ? String(num) : "NULL"
  }
  if (type === "boolean") {
    const normalized = value.trim().toLowerCase()
    if (["true", "t", "1", "yes", "y"].includes(normalized)) return "TRUE"
    if (["false", "f", "0", "no", "n"].includes(normalized)) return "FALSE"
    return "NULL"
  }
  const s = value.replace(/'/g, "''")
  return `'${s}'`
}

const formatGeneratorValue = (param: GeneratorParamState) => {
  if (param.isNull) return "NULL"
  if (isEmptyValue(param.value)) return null
  return toSqlLiteralByType(param.value, param.inputType)
}

export function generateWriteSql(config: GeneratorConfig): { sql: string; warnings: string[] } {
  const warnings: string[] = []
  const tableName = `${config.table.schema}.${config.table.name}`
  const tableIdent = quoteIdent(tableName)

  if (config.mode === "insert") {
    const columns: string[] = []
    const values: string[] = []
    for (const param of config.params) {
      if (param.isAuto && !param.overrideAuto) continue
      const rendered = formatGeneratorValue(param)
      if (rendered === null) continue
      columns.push(quoteIdent(param.name))
      values.push(rendered)
    }

    if (columns.length === 0) {
      return { sql: `INSERT INTO ${tableIdent} DEFAULT VALUES;`, warnings }
    }
    return {
      sql: `INSERT INTO ${tableIdent} (${columns.join(", ")})\nVALUES (${values.join(", ")});`,
      warnings,
    }
  }

  const setClauses: string[] = []
  const whereClauses: string[] = []

  for (const param of config.params) {
    const role = param.role ?? "set"
    if (role === "set") {
      if (param.isAuto && !param.overrideAuto) continue
      const rendered = formatGeneratorValue(param)
      if (rendered === null) continue
      setClauses.push(`${quoteIdent(param.name)} = ${rendered}`)
    } else {
      const rendered = formatGeneratorValue(param)
      if (rendered === null) continue
      if (param.isNull) {
        whereClauses.push(`${quoteIdent(param.name)} IS NULL`)
      } else {
        whereClauses.push(`${quoteIdent(param.name)} = ${rendered}`)
      }
    }
  }

  if (setClauses.length === 0) {
    warnings.push("No SET values provided.")
  }
  if (whereClauses.length === 0) {
    warnings.push("No WHERE values provided.")
  }

  const whereSql = whereClauses.length ? `\nWHERE ${whereClauses.join(" AND ")}` : ""
  const sql = `UPDATE ${tableIdent}\nSET ${setClauses.join(", ")}${whereSql};`
  return { sql, warnings }
}
