"use client"

import { useState, useEffect } from "react"
import { Copy, Check, X, Expand } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

interface CellDetailDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    content: unknown
    columnName: string
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
    const [formattedContent, setFormattedContent] = useState<React.ReactNode>("")
    const [isJson, setIsJson] = useState(false)

    useEffect(() => {
        if (content === null) {
            setFormattedContent(<span className="text-stone-400 italic">NULL</span>)
            setIsJson(false)
            return
        }

        if (content === undefined) {
            setFormattedContent("")
            setIsJson(false)
            return
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
            setIsJson(true)
            setFormattedContent(highlightJson(jsonString))
        } else {
            setIsJson(false)
            setFormattedContent(String(content))
        }
    }, [content])

    const handleCopy = () => {
        const textToCopy = typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content)
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

                <ScrollArea className="flex-1 p-4 bg-white/50">
                    <div className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-stone-800">
                        {formattedContent}
                    </div>
                </ScrollArea>

                <div className="p-2 border-t border-stone-100 flex justify-end bg-stone-50/50 rounded-b-lg">
                    <Button variant="outline" size="sm" onClick={handleCopy} className="h-7 text-xs gap-1.5">
                        {isCopied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-stone-500" />}
                        {isCopied ? "Copied" : "Copy Content"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
