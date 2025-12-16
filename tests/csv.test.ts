import { describe, expect, it } from "vitest"
import { rowsToCsv } from "../lib/csv"

describe("rowsToCsv", () => {
    it("escapes commas, quotes, and newlines inside cells", () => {
        const csv = rowsToCsv(
            ["name", "notes"],
            [
                { name: "Alice", notes: "Line1\nLine2" },
                { name: "Bob, Jr.", notes: 'He said "Hi"' },
            ],
        )

        expect(csv).toContain("Line1\nLine2")
        expect(csv).toContain('He said ""Hi"""')
    })

    it("normalizes null/undefined/boolean/object values", () => {
        const csv = rowsToCsv(
            ["flag", "payload"],
            [
                { flag: null, payload: undefined },
                { flag: true, payload: { nested: "yes" } },
            ],
        )

        expect(csv).toContain("true")
        expect(csv).toContain('"{""nested"":""yes""}"')
    })

    it("builds CRLF-delimited lines with header + rows", () => {
        const csv = rowsToCsv(["id"], [{ id: 1 }, { id: 2 }])
        const lines = csv.split("\r\n")

        expect(lines).toHaveLength(3) // header + 2 rows
        expect(lines[0]).toBe("id")
        expect(lines.slice(1)).toEqual(["1", "2"])
    })
})

