"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { MarkdownMessage } from "@/components/markdown-message";
import { Button } from "@/components/ui/button";

export function ViewerBody() {
	const params = useParams();
	const searchParams = useSearchParams();
	const documentId = String(params.documentId ?? "");
	const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
	const highlight = searchParams.get("highlight") ?? "";

	const [url, setUrl] = useState<string | null>(null);
	const [mime, setMime] = useState<string>("");
	const [name, setName] = useState<string>("Document");
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const res = await fetch(`/api/documents/${documentId}/signed-url`, {
					cache: "no-store",
				});
				const data = (await res.json()) as {
					url?: string;
					mimeType?: string;
					name?: string;
					error?: string;
				};
				if (!res.ok) throw new Error(data.error ?? "Could not open document.");
				if (!cancelled) {
					setUrl(data.url ?? null);
					setMime(data.mimeType ?? "");
					setName(data.name ?? "Document");
				}
			} catch (e) {
				if (!cancelled) {
					setLoadError(e instanceof Error ? e.message : String(e));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [documentId]);

	const isPdf = mime.toLowerCase().includes("pdf");

	return (
		<div className="flex min-h-dvh flex-col bg-background text-foreground">
			<header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
				<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-4">
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold">{name}</p>
						<p className="text-xs text-muted-foreground">
							{isPdf ? `PDF • Page ${page}` : mime || "File"}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{url ? (
							<Button asChild variant="outline" size="sm">
								<a href={url} target="_blank" rel="noopener noreferrer">
									Open in new tab
								</a>
							</Button>
						) : null}
						<Button asChild variant="secondary" size="sm">
							<Link href="/">Back to workspace</Link>
						</Button>
					</div>
				</div>
			</header>

			<main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-0">
				{loadError ? (
					<div className="p-4 text-sm text-destructive">{loadError}</div>
				) : null}

				{!loadError && url ? (
					<div className="min-h-[55dvh] flex-1 border-b border-border bg-muted/20">
						{isPdf ? (
							<iframe
								title={name}
								className="h-[min(78dvh,900px)] w-full bg-background"
								src={`${url}#page=${page}`}
							/>
						) : (
							<div className="flex h-[min(78dvh,900px)] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
								<p>
									Inline preview is optimized for PDFs. Use “Open in new tab”
									for Office files, drawings, or photos.
								</p>
								<Button asChild>
									<a href={url} target="_blank" rel="noopener noreferrer">
										Download / open file
									</a>
								</Button>
							</div>
						)}
					</div>
				) : null}

				{!loadError && !url ? (
					<div className="p-4 text-sm text-muted-foreground">
						Loading signed URL…
					</div>
				) : null}

				{highlight ? (
					<section className="space-y-2 px-3 py-4 sm:px-4">
						<h2 className="text-sm font-semibold">Cited passage</h2>
						<div className="rounded-lg border border-border bg-card p-3">
							<MarkdownMessage content={highlight} />
						</div>
						<p className="text-xs text-muted-foreground">
							The viewer jumps to the cited PDF page when supported by your
							browser. Use this passage to locate the exact block in other file
							types.
						</p>
					</section>
				) : null}
			</main>
		</div>
	);
}
