import { describe, expect, it } from "vitest"
import { generateWriteSql, type GeneratorConfig } from "@/lib/write-query-generator"

describe("write-query-generator", () => {
  it("skips auto and empty values for insert", () => {
    const config: GeneratorConfig = {
      mode: "insert",
      table: { schema: "public", name: "users" },
      params: [
        {
          name: "id",
          dataType: "uuid",
          inputType: "string",
          isNullable: false,
          isAuto: true,
          isPk: true,
          value: "",
        },
        {
          name: "email",
          dataType: "text",
          inputType: "string",
          isNullable: false,
          isAuto: false,
          isPk: false,
          value: "user@example.com",
        },
        {
          name: "created_at",
          dataType: "timestamp",
          inputType: "string",
          isNullable: false,
          isAuto: true,
          isPk: false,
          value: "",
        },
      ],
    }

    const { sql } = generateWriteSql(config)
    expect(sql).toBe("INSERT INTO public.users (email)\nVALUES ('user@example.com');")
  })

  it("falls back to default values when no insert inputs provided", () => {
    const config: GeneratorConfig = {
      mode: "insert",
      table: { schema: "public", name: "audit_logs" },
      params: [
        {
          name: "id",
          dataType: "uuid",
          inputType: "string",
          isNullable: false,
          isAuto: true,
          isPk: true,
          value: "",
        },
      ],
    }
    const { sql } = generateWriteSql(config)
    expect(sql).toBe("INSERT INTO public.audit_logs DEFAULT VALUES;")
  })

  it("builds update with set + where clauses and null comparisons", () => {
    const config: GeneratorConfig = {
      mode: "update",
      table: { schema: "public", name: "users" },
      params: [
        {
          name: "name",
          dataType: "text",
          inputType: "string",
          isNullable: true,
          isAuto: false,
          isPk: false,
          role: "set",
          value: "Sam",
        },
        {
          name: "deleted_at",
          dataType: "timestamp",
          inputType: "string",
          isNullable: true,
          isAuto: false,
          isPk: false,
          role: "where",
          isNull: true,
          value: "",
        },
        {
          name: "id",
          dataType: "uuid",
          inputType: "string",
          isNullable: false,
          isAuto: false,
          isPk: true,
          role: "where",
          value: "abc",
        },
      ],
    }

    const { sql } = generateWriteSql(config)
    expect(sql).toBe("UPDATE public.users\nSET name = 'Sam'\nWHERE deleted_at IS NULL AND id = 'abc';")
  })

})
