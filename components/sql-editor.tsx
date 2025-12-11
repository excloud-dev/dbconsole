"use client"

import { useEffect, useRef, useCallback } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { sql, PostgreSQL } from "@codemirror/lang-sql"
import { autocompletion, completionKeymap, CompletionContext, Completion } from "@codemirror/autocomplete"
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from "@codemirror/language"
import { tags } from "@lezer/highlight"

interface SchemaInfo {
    tables: { name: string; schema: string }[]
    columns: { name: string; table: { name: string; schema: string }; dataType: string }[]
}

interface SqlEditorProps {
    value: string
    onChange: (value: string) => void
    onExecute?: () => void
    schema?: SchemaInfo | null
    className?: string
    onLineCountChange?: (lines: number) => void
}

// Custom highlighting for SQL
const sqlHighlighting = HighlightStyle.define([
    { tag: tags.keyword, color: "#5c6bc0", fontWeight: "bold" },
    { tag: tags.string, color: "#43a047" },
    { tag: tags.number, color: "#e65100" },
    { tag: tags.comment, color: "#78909c", fontStyle: "italic" },
    { tag: tags.operator, color: "#6d4c41" },
    { tag: tags.propertyName, color: "#00796b" },
    { tag: tags.typeName, color: "#7b1fa2" },
])

// Theme for the editor
const editorTheme = EditorView.theme({
    "&": {
        fontSize: "13px",
        fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace",
        backgroundColor: "transparent",
        height: "100%",
    },
    ".cm-scroller": {
        overflow: "auto",
        fontFamily: "inherit",
    },
    ".cm-content": {
        padding: "6px 8px",
        paddingBottom: "40px", // Space for floating buttons
    },
    ".cm-focused": {
        outline: "none",
    },
    "&.cm-focused": {
        outline: "none",
    },
    ".cm-line": {
        padding: "0",
    },
    ".cm-placeholder": {
        color: "#a8a29e",
        fontStyle: "italic",
    },
    ".cm-tooltip.cm-tooltip-autocomplete": {
        backgroundColor: "#fff",
        border: "1px solid #e7e5e4",
        borderRadius: "6px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        padding: "4px 0",
    },
    ".cm-tooltip-autocomplete ul li": {
        padding: "4px 12px",
        fontSize: "12px",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "#f5f5f4",
        color: "#1c1917",
    },
    ".cm-completionIcon": {
        marginRight: "8px",
        opacity: "0.6",
    },
    ".cm-completionLabel": {
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
    },
    ".cm-completionDetail": {
        marginLeft: "12px",
        color: "#78716c",
        fontStyle: "italic",
        fontSize: "11px",
    },
})

export function SqlEditor({ value, onChange, onExecute, schema, className, onLineCountChange }: SqlEditorProps) {
    const editorRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const onChangeRef = useRef(onChange)
    const onExecuteRef = useRef(onExecute)
    const onLineCountChangeRef = useRef(onLineCountChange)

    // Keep refs updated
    onChangeRef.current = onChange
    onExecuteRef.current = onExecute
    onLineCountChangeRef.current = onLineCountChange

    // Build schema completions from schema prop
    const schemaCompletions = useCallback(
        (context: CompletionContext) => {
            const word = context.matchBefore(/[\w.]*/)
            if (!word || (word.from === word.to && !context.explicit)) return null

            // Get text before the current word to determine context
            const textBefore = context.state.sliceDoc(0, word.from).trim()
            const lastToken = textBefore.split(/\s+/).pop()?.toUpperCase() || ""
            const isFromClause = ["FROM", "JOIN", "UPDATE", "INTO"].includes(lastToken)
            const isSelectClause = ["SELECT", "WHERE", "ON", "SET", "BY", "HAVING"].includes(lastToken)

            // Special case: after "SELECT *", we should strongly suggest "FROM"
            const isSelectStar = textBefore.toUpperCase().endsWith("SELECT *")

            const completions: Completion[] = []

            // SQL keywords
            const keywords = [
                "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN",
                "ORDER BY", "GROUP BY", "HAVING", "LIMIT", "OFFSET", "JOIN", "INNER JOIN",
                "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "ON", "AS", "DISTINCT", "COUNT",
                "SUM", "AVG", "MIN", "MAX", "CASE", "WHEN", "THEN", "ELSE", "END",
                "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "CREATE TABLE",
                "ALTER TABLE", "DROP TABLE", "NULL", "IS NULL", "IS NOT NULL", "TRUE", "FALSE",
            ]

            keywords.forEach((kw) => {
                if (kw.toLowerCase().startsWith(word.text.toLowerCase())) {
                    // Boost FROM heavily if we just typed SELECT *
                    let boost = 1
                    if (isSelectStar && kw === "FROM") boost = 5
                    else if (kw === "FROM" && lastToken === "*") boost = 5

                    completions.push({
                        label: kw,
                        type: "keyword",
                        boost,
                    })
                }
            })

            // Table names from schema
            if (schema?.tables) {
                schema.tables.forEach((table) => {
                    if (table.name.toLowerCase().startsWith(word.text.toLowerCase())) {
                        // Boost tables when in FROM/JOIN clause
                        const boost = isFromClause ? 3 : 1.5
                        completions.push({
                            label: table.name,
                            type: "class",
                            detail: "table",
                            boost,
                        })
                    }
                })
            }

            // Column names from schema
            if (schema?.columns) {
                // Check if we're typing after a table name (e.g., "accounts.")
                const beforeDot = word.text.includes(".")
                    ? word.text.split(".")[0]
                    : null
                const afterDot = beforeDot ? word.text.split(".")[1] || "" : word.text

                schema.columns.forEach((col) => {
                    // If typing after dot, filter columns to that table
                    if (beforeDot) {
                        if (
                            col.table.name.toLowerCase() === beforeDot.toLowerCase() &&
                            col.name.toLowerCase().startsWith(afterDot.toLowerCase())
                        ) {
                            completions.push({
                                label: `${beforeDot}.${col.name}`,
                                displayLabel: col.name,
                                type: "property",
                                detail: col.dataType,
                                // Very high boost for exact table columns
                                boost: 4,
                            })
                        }
                    } else {
                        // General column match
                        if (col.name.toLowerCase().startsWith(word.text.toLowerCase())) {
                            // Boost columns when in SELECT/WHERE clause, but lower than keywords generally
                            const boost = isSelectClause ? 2 : 1
                            completions.push({
                                label: col.name,
                                type: "property",
                                detail: `${col.table.name}.${col.dataType}`,
                                boost,
                            })
                        }
                    }
                })
            }

            return {
                from: word.from,
                options: completions,
                validFor: /^[\w.]*$/,
            }
        },
        [schema],
    )

    useEffect(() => {
        if (!editorRef.current) return

        // Custom keymap for Cmd/Ctrl+Enter to execute
        const executeKeymap = keymap.of([
            {
                key: "Mod-Enter",
                run: () => {
                    onExecuteRef.current?.()
                    return true
                },
            },
        ])

        const state = EditorState.create({
            doc: value,
            extensions: [
                executeKeymap,
                keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
                history(),
                sql({ dialect: PostgreSQL }),
                syntaxHighlighting(defaultHighlightStyle),
                syntaxHighlighting(sqlHighlighting),
                autocompletion({
                    override: [schemaCompletions],
                    activateOnTyping: true,
                    maxRenderedOptions: 20,
                }),
                editorTheme,
                placeholder("SELECT * FROM table_name;"),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        onChangeRef.current(update.state.doc.toString())
                        onLineCountChangeRef.current?.(update.state.doc.lines)
                    }
                }),
                EditorView.lineWrapping,
            ],
        })

        const view = new EditorView({
            state,
            parent: editorRef.current,
        })

        viewRef.current = view

        // Initial line count
        onLineCountChangeRef.current?.(state.doc.lines)

        return () => {
            view.destroy()
        }
    }, [schemaCompletions])

    // Sync external value changes
    useEffect(() => {
        const view = viewRef.current
        if (view && value !== view.state.doc.toString()) {
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: value,
                },
            })
        }
    }, [value])

    return (
        <div
            ref={editorRef}
            className={className}
            style={{ height: '100%', cursor: 'text' }}
            onClick={(e) => {
                if (e.target === e.currentTarget && viewRef.current) {
                    const length = viewRef.current.state.doc.length
                    viewRef.current.dispatch({ selection: { anchor: length } })
                    viewRef.current.focus()
                }
            }}
        />
    )
}
