"use client"

import { useMemo, useState } from "react"
import { Copy, Check, Expand } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

interface CellDetailDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    content: unknown
    columnName: string
    executedSql?: string
}

// Improved tokenizer for highlighting
function highlightJson(json: string) {
    // Regex matches: strings, numbers, booleans, null, keys, punctuation
    const regex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}[\],:])/g;

    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(json)) !== null) {
        const part = match[0];
        const index = match.index;

        // Push whitespace/text before match
        if (index > lastIndex) {
            elements.push(json.slice(lastIndex, index));
        }

        if (part.endsWith(':')) {
            // Key
            elements.push(<span key={index} className="text-blue-600 font-semibold">{part.slice(0, -1)}</span>);
            elements.push(<span key={index + '_c'} className="text-stone-400">:</span>);
        } else if (part.startsWith('"')) {
            // String value
            elements.push(<span key={index} className="text-green-600">{part}</span>);
        } else if (part === 'true' || part === 'false') {
            elements.push(<span key={index} className="text-purple-600 font-semibold">{part}</span>);
        } else if (part === 'null') {
            elements.push(<span key={index} className="text-stone-400 italic">{part}</span>);
        } else if (/^-?\d/.test(part)) {
            elements.push(<span key={index} className="text-orange-600">{part}</span>);
        } else {
            // Punctuation
            elements.push(<span key={index} className="text-stone-500">{part}</span>);
        }

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < json.length) {
        elements.push(json.slice(lastIndex));
    }

    return elements;
}

export function CellDetailDialog({ open, onOpenChange, content, columnName }: CellDetailDialogProps) {
    const [isCopied, setIsCopied] = useState(false)

    // Simple SQL highlighter
    const highlightSql = (sql: string) => {
        const keywords = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|FULL|INNER|OUTER|ON|AND|OR|NOT|IN|LIKE|ILIKE|GROUP|BY|ORDER|LIMIT|OFFSET|UNION|ALL|AS|CASE|WHEN|THEN|END|DISTINCT|WITH|INSERT|UPDATE|DELETE|VALUES|RETURNING|HAVING)\b/gi
        const strings = /'([^']|'')*'/g
        const numbers = /\b\d+(?:\.\d+)?\b/g
        const identifiers = /"[^\"]*"|`[^`]*`/g

        const tokens: { regex: RegExp; className: string }[] = [
            { regex: strings, className: "text-emerald-600" },
            { regex: identifiers, className: "text-blue-600" },
            { regex: keywords, className: "text-purple-700 font-semibold" },
            { regex: numbers, className: "text-orange-600" },
        ]

        let output: React.ReactNode[] = []
        let remaining = sql
        let offset = 0

        while (remaining.length > 0) {
            let nextMatch: { start: number; end: number; text: string; className: string } | null = null
            for (const { regex, className } of tokens) {
                regex.lastIndex = 0
                const m = regex.exec(remaining)
                if (m) {
                    const start = m.index
                    const end = m.index + m[0].length
                    if (!nextMatch || start < nextMatch.start) {
                        nextMatch = { start, end, text: m[0], className }
                    }
                }
            }

            if (!nextMatch) {
                output.push(remaining)
                break
            }

            if (nextMatch.start > 0) {
                output.push(remaining.slice(0, nextMatch.start))
            }
            output.push(<span key={offset + nextMatch.start} className={nextMatch.className}>{nextMatch.text}</span>)
            remaining = remaining.slice(nextMatch.end)
            offset += nextMatch.end
        }

        return output
    }

    const { formattedContent, rawText, isJson } = useMemo(() => {
        if (content === null) {
            return {
                formattedContent: <span className="text-stone-400 italic">NULL</span>,
                rawText: "NULL",
                isJson: false,
            }
        }

        if (content === undefined) {
            return {
                formattedContent: "",
                rawText: "",
                isJson: false,
            }
        }

        let jsonString = ""
        let isValidJson = false

        if (typeof content === "object") {
            try {
                jsonString = JSON.stringify(content, null, 2)
                isValidJson = true
            } catch (e) { }
        } else if (typeof content === "string") {
            try {
                const parsed = JSON.parse(content)
                if (typeof parsed === 'object' && parsed !== null) {
                    jsonString = JSON.stringify(parsed, null, 2)
                    isValidJson = true
                }
            } catch (e) { }
        }

        if (isValidJson) {
            return {
                formattedContent: highlightJson(jsonString),
                rawText: jsonString,
                isJson: true,
            }
        } else if (typeof content === "string" && columnName.toLowerCase().includes("sql")) {
            return {
                formattedContent: highlightSql(content),
                rawText: content,
                isJson: false,
            }
        } else {
            const plain = String(content)
            return {
                formattedContent: plain,
                rawText: plain,
                isJson: false,
            }
        }
    }, [content, columnName])

    const handleCopy = () => {
        const textToCopy = rawText
        navigator.clipboard.writeText(textToCopy)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-4 py-3 border-b border-stone-100 flex-shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-base font-medium">
                        <Expand className="h-4 w-4 text-stone-500" />
                        {columnName}
                        {isJson && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-mono border border-blue-100 uppercase tracking-wider">JSON</span>}
                    </DialogTitle>
                </DialogHeader>

                <ScrollArea className="flex-1 p-4">
                    <div className="rounded-md border border-stone-200 bg-stone-50/80 shadow-inner px-3 py-2">
                        <div className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-stone-800">
                            {formattedContent}
                        </div>
                    </div>
                </ScrollArea>

                <div className="p-3 border-t border-stone-100 flex justify-end bg-stone-50/50 rounded-b-lg">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopy}
                        className={`h-7 text-xs gap-1.5 transition-all duration-300 border ${isCopied
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                : "bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100 border-emerald-100 hover:border-emerald-200"
                            }`}
                    >
                        {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {isCopied ? "Copied!" : "Copy Content"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
