"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";

const markdownClass =
	"space-y-3 text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:py-0.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-[0.85em] [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1";

/**
 * File-search / PDF snippets often break each cell delimiter onto its own line.
 * Collapse those so remark-gfm can recognize Markdown pipe tables again.
 */
export function normalizeCitationHighlightMarkdown(snippet: string): string {
	let s = snippet.replace(/\r\n/g, "\n").trim();
	let prev = "";
	while (prev !== s) {
		prev = s;
		s = s.replace(/\n\s*\|\|\s*\n/g, " || ");
		s = s.replace(/\n\s*\|\s*\n/g, " | ");
	}
	return s;
}

export function MarkdownMessage({
	content,
	className,
	/** Chat uses breaks; citations use softer breaks so pasted PDF snippets flow. */
	singleNewlinesAsHardBreaks = true,
}: {
	content: string;
	className?: string;
	singleNewlinesAsHardBreaks?: boolean;
}) {
	const remarkPlugins = singleNewlinesAsHardBreaks
		? [remarkGfm, remarkBreaks]
		: [remarkGfm];
	return (
		<div className={cn(markdownClass, className)}>
			<ReactMarkdown
				remarkPlugins={remarkPlugins}
				components={{
					a({ href, children }) {
						if (!href) return <span>{children}</span>;
						if (href.startsWith("/")) {
							return <Link href={href}>{children}</Link>;
						}
						return (
							<a href={href} target="_blank" rel="noopener noreferrer">
								{children}
							</a>
						);
					},
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
