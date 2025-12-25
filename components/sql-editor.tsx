"use client"

import { useEffect, useRef, useCallback, useMemo } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { sql, PostgreSQL } from "@codemirror/lang-sql"
import { autocompletion, completionKeymap, CompletionContext, Completion } from "@codemirror/autocomplete"
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from "@codemirror/language"
import { tags } from "@lezer/highlight"
import { useBinding } from "@/components/shortcuts/useBinding"

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
    readOnly?: boolean
    domId?: string
}

// Custom highlighting for SQL - uses CSS variables for dark mode support
const sqlHighlighting = HighlightStyle.define([
    { tag: tags.keyword, class: "sql-keyword" },
    { tag: tags.string, class: "sql-string" },
    { tag: tags.number, class: "sql-number" },
    { tag: tags.comment, class: "sql-comment" },
    { tag: tags.operator, class: "sql-operator" },
    { tag: tags.propertyName, class: "sql-property" },
    { tag: tags.typeName, class: "sql-type" },
])

// Theme for the editor - uses CSS variables for dark mode support
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
        caretColor: "var(--sql-caret, currentColor)",
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
        color: "var(--sql-placeholder, #a8a29e)",
        fontStyle: "italic",
    },
    ".cm-tooltip.cm-tooltip-autocomplete": {
        backgroundColor: "var(--sql-tooltip-bg, #fff)",
        border: "1px solid var(--sql-tooltip-border, #e7e5e4)",
        borderRadius: "6px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        padding: "4px 0",
    },
    ".cm-tooltip-autocomplete ul li": {
        padding: "4px 12px",
        fontSize: "12px",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--sql-tooltip-selected-bg, #f5f5f4)",
        color: "var(--sql-tooltip-selected-text, #1c1917)",
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
        color: "var(--sql-completion-detail, #78716c)",
        fontStyle: "italic",
        fontSize: "11px",
    },
    // Syntax highlighting classes
    ".sql-keyword": {
        color: "var(--sql-keyword, #5c6bc0)",
        fontWeight: "bold",
    },
    ".sql-string": {
        color: "var(--sql-string, #43a047)",
    },
    ".sql-number": {
        color: "var(--sql-number, #e65100)",
    },
    ".sql-comment": {
        color: "var(--sql-comment, #78909c)",
        fontStyle: "italic",
    },
    ".sql-operator": {
        color: "var(--sql-operator, #6d4c41)",
    },
    ".sql-property": {
        color: "var(--sql-property, #00796b)",
    },
    ".sql-type": {
        color: "var(--sql-type, #7b1fa2)",
    },
})

export function SqlEditor({ value, onChange, onExecute, schema, className, onLineCountChange, ...props }: SqlEditorProps) {
    const editorRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    // Keep the latest external value available for editor re-creation cases (e.g. schema/readOnly changes).
    // Without this, rebuilding the EditorView can temporarily reset the visible doc to the initial mount value.
    const valueRef = useRef(value)
    const onChangeRef = useRef(onChange)
    const onExecuteRef = useRef(onExecute)
    const onLineCountChangeRef = useRef(onLineCountChange)

    useEffect(() => {
        onChangeRef.current = onChange
    }, [onChange])

    useEffect(() => {
        onExecuteRef.current = onExecute
    }, [onExecute])

    useEffect(() => {
        onLineCountChangeRef.current = onLineCountChange
    }, [onLineCountChange])

    useEffect(() => {
        valueRef.current = value
    }, [value])

    const executeBinding = useBinding("query.run")
    const codeMirrorExecuteKey = useMemo(() => (executeBinding ? executeBinding.replace(/\+/g, "-") : "Mod-Enter"), [executeBinding])

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
                key: codeMirrorExecuteKey,
                run: () => {
                    onExecuteRef.current?.()
                    return true
                },
            },
        ])

        const state = EditorState.create({
            doc: valueRef.current,
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
                EditorView.editable.of(!props.readOnly),
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
    }, [schemaCompletions, props.readOnly, codeMirrorExecuteKey])

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
            id={props.domId}
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
