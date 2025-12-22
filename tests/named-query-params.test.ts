import { describe, expect, it } from "vitest"
import { cleanupTrivialPredicates } from "@/lib/sql/named-query-params"

describe("named-query-params cleanup", () => {
  it("removes AND-linked 1=1 predicates", () => {
    const sql = "SELECT * FROM users WHERE 1=1 AND status = $1 AND 1=1"
    expect(cleanupTrivialPredicates(sql).trim()).toBe("SELECT * FROM users WHERE status = $1")
  })

  it("removes standalone WHERE 1=1", () => {
    const sql = "SELECT * FROM users WHERE 1=1"
    expect(cleanupTrivialPredicates(sql).trim()).toBe("SELECT * FROM users")
  })

  it("keeps OR-linked 1=1 intact", () => {
    const sql = "SELECT * FROM users WHERE 1=1 OR status = $1"
    expect(cleanupTrivialPredicates(sql)).toBe(sql)
  })
})
