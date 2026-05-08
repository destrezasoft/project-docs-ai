"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Check,
	FileText,
	History,
	ImagePlus,
	Loader2,
	MessageSquarePlus,
	PanelRight,
	Plus,
	SendHorizontal,
	Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownMessage } from "@/components/markdown-message";
import { cn } from "@/lib/utils";

type ChatSummary = {
	id: string;
	title: string | null;
	updatedAt: string;
};

type LibraryDoc = {
	id: string;
	name: string;
	description: string | null;
	mimeType: string;
	sizeBytes: number;
	indexingStatus: string;
	indexingError: string | null;
};

type DocumentDetail = {
	id: string;
	name: string;
	description: string | null;
	mimeType: string;
	sizeBytes: number;
	indexingStatus: string;
	indexingError: string | null;
	createdAt: string;
	updatedAt: string;
};

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
	try {
		return new Date(iso).toLocaleString(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		});
	} catch {
		return iso;
	}
}

type MsgAttachment = {
	id?: string;
	name?: string;
	mimeType?: string;
};

type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	attachments: MsgAttachment[];
};

type LibraryUploadStage = "prepare" | "upload" | "process" | "refresh";
type AttachmentUploadStage = "prepare" | "upload" | "link";

type UploadFlowState =
	| { kind: "idle" }
	| { kind: "library"; stage: LibraryUploadStage }
	| { kind: "attachment"; stage: AttachmentUploadStage };

const LIBRARY_UPLOAD_STEPS: {
	id: LibraryUploadStage;
	label: string;
}[] = [
	{ id: "prepare", label: "Preparing file" },
	{ id: "upload", label: "Uploading to server" },
	{ id: "process", label: "Processing on server" },
	{ id: "refresh", label: "Updating library list" },
];

const ATTACHMENT_UPLOAD_STEPS: {
	id: AttachmentUploadStage;
	label: string;
}[] = [
	{ id: "prepare", label: "Preparing file" },
	{ id: "upload", label: "Uploading to server" },
	{ id: "link", label: "Adding to chat" },
];

function stageIndex<T extends string>(
	steps: { id: T }[],
	current: T,
): number {
	return steps.findIndex((s) => s.id === current);
}

function UploadStepsList({
	steps,
	currentStageId,
}: {
	steps: { id: string; label: string }[];
	currentStageId: string;
}) {
	const activeIdx = stageIndex(steps, currentStageId);
	return (
		<ol className="space-y-2" aria-live="polite" aria-busy="true">
			{steps.map((step, i) => {
				const done = i < activeIdx;
				const active = i === activeIdx;
				return (
					<li
						key={step.id}
						className={cn(
							"flex items-start gap-2 text-xs",
							done && "text-muted-foreground",
							active && "font-medium text-foreground",
							!done && !active && "text-muted-foreground/70",
						)}
					>
						<span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
							{done ? (
								<Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
							) : active ? (
								<Loader2
									className="h-3.5 w-3.5 animate-spin text-primary"
									aria-hidden
								/>
							) : (
								<span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
							)}
						</span>
						<span>{step.label}</span>
					</li>
				);
			})}
		</ol>
	);
}

export function ProjectWorkspace() {
	const [chats, setChats] = useState<ChatSummary[]>([]);
	const [documents, setDocuments] = useState<LibraryDoc[]>([]);
	const [activeChatId, setActiveChatId] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [leftOpen, setLeftOpen] = useState(false);
	const [rightOpen, setRightOpen] = useState(false);

	const [docName, setDocName] = useState("");
	const [docDescription, setDocDescription] = useState("");
	const libraryFileRef = useRef<HTMLInputElement>(null);
	const chatAttachRef = useRef<HTMLInputElement>(null);

	const [pendingAttachmentIds, setPendingAttachmentIds] = useState<string[]>(
		[],
	);
	const [includedLibraryDocIds, setIncludedLibraryDocIds] = useState<string[]>(
		[],
	);
	const [librarySelectionLocked, setLibrarySelectionLocked] = useState(false);
	const [savingIncludeDocId, setSavingIncludeDocId] = useState<string | null>(
		null,
	);
	const [uploadFlow, setUploadFlow] = useState<UploadFlowState>({
		kind: "idle",
	});

	const [documentDetailId, setDocumentDetailId] = useState<string | null>(null);
	const [libraryUploadOpen, setLibraryUploadOpen] = useState(false);
	const [documentDetail, setDocumentDetail] = useState<DocumentDetail | null>(
		null,
	);
	const [documentDetailLoading, setDocumentDetailLoading] = useState(false);
	const [documentDetailError, setDocumentDetailError] = useState<string | null>(
		null,
	);

	const refreshChats = useCallback(async () => {
		const res = await fetch("/api/chats", { cache: "no-store" });
		if (!res.ok) throw new Error("Could not load chats.");
		const data = (await res.json()) as { chats: ChatSummary[] };
		setChats(data.chats);
		return data.chats;
	}, []);

	const refreshDocuments = useCallback(async () => {
		const res = await fetch("/api/documents", { cache: "no-store" });
		if (!res.ok) throw new Error("Could not load documents.");
		const data = (await res.json()) as { documents: LibraryDoc[] };
		setDocuments(data.documents);
	}, []);

	const loadChat = useCallback(async (chatId: string) => {
		const res = await fetch(`/api/chats/${chatId}`, { cache: "no-store" });
		if (!res.ok) throw new Error("Could not load chat.");
		const data = (await res.json()) as {
			messages: ChatMessage[];
			includedLibraryDocumentIds?: string[];
			librarySelectionLocked?: boolean;
		};
		setMessages(data.messages);
		setIncludedLibraryDocIds(data.includedLibraryDocumentIds ?? []);
		setLibrarySelectionLocked(Boolean(data.librarySelectionLocked));
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				await refreshChats();
				await refreshDocuments();
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			}
		})();
	}, [refreshChats, refreshDocuments]);

	useEffect(() => {
		if (!activeChatId) {
			setIncludedLibraryDocIds([]);
			setLibrarySelectionLocked(false);
			return;
		}
		void loadChat(activeChatId).catch((e) =>
			setError(e instanceof Error ? e.message : String(e)),
		);
	}, [activeChatId, loadChat]);

	useEffect(() => {
		if (!documentDetailId) {
			setDocumentDetail(null);
			setDocumentDetailLoading(false);
			setDocumentDetailError(null);
			return;
		}
		let cancelled = false;
		setDocumentDetailLoading(true);
		setDocumentDetail(null);
		setDocumentDetailError(null);
		void (async () => {
			try {
				const res = await fetch(`/api/documents/${documentDetailId}`, {
					cache: "no-store",
				});
				const data = (await res.json()) as {
					document?: DocumentDetail;
					error?: string;
				};
				if (!res.ok || !data.document) {
					throw new Error(data.error ?? "Could not load document.");
				}
				if (!cancelled) setDocumentDetail(data.document);
			} catch (e) {
				if (!cancelled) {
					setDocumentDetailError(
						e instanceof Error ? e.message : String(e),
					);
				}
			} finally {
				if (!cancelled) setDocumentDetailLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [documentDetailId]);

	const activeChatTitle = useMemo(() => {
		if (!activeChatId) return "Select a chat";
		return chats.find((c) => c.id === activeChatId)?.title ?? "Chat";
	}, [activeChatId, chats]);

	async function handleNewChat() {
		setError(null);
		setBusy(true);
		try {
			const res = await fetch("/api/chats", { method: "POST" });
			if (!res.ok) throw new Error("Could not create chat.");
			const data = (await res.json()) as { chat: { id: string } };
			setPendingAttachmentIds([]);
			setIncludedLibraryDocIds([]);
			setLibrarySelectionLocked(false);
			await refreshChats();
			setActiveChatId(data.chat.id);
			setMessages([]);
			setLeftOpen(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function handleSelectChat(id: string) {
		setActiveChatId(id);
		setPendingAttachmentIds([]);
		setLeftOpen(false);
	}

	async function handleDeleteChat(id: string) {
		if (!window.confirm("Delete this chat and its uploaded chat files?"))
			return;
		setError(null);
		setBusy(true);
		try {
			const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
			if (!res.ok) throw new Error("Could not delete chat.");
			if (activeChatId === id) {
				setActiveChatId(null);
				setMessages([]);
				setIncludedLibraryDocIds([]);
				setLibrarySelectionLocked(false);
			}
			await refreshChats();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function handleLibraryUpload(e: React.FormEvent) {
		e.preventDefault();
		const input = libraryFileRef.current;
		const file = input?.files?.[0];
		if (!file) {
			setError("Choose a file to upload.");
			return;
		}
		setError(null);
		setBusy(true);
		setUploadFlow({ kind: "library", stage: "prepare" });
		try {
			const fd = new FormData();
			fd.set("file", file);
			fd.set("name", docName.trim() || file.name);
			fd.set("description", docDescription.trim());
			setUploadFlow({ kind: "library", stage: "upload" });
			const res = await fetch("/api/documents", { method: "POST", body: fd });
			setUploadFlow({ kind: "library", stage: "process" });
			const payload = (await res.json()) as { error?: string };
			if (!res.ok)
				throw new Error(payload.error ?? "Upload failed.");
			setUploadFlow({ kind: "library", stage: "refresh" });
			await refreshDocuments();
			setDocName("");
			setDocDescription("");
			if (input) input.value = "";
			setLibraryUploadOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setUploadFlow({ kind: "idle" });
			setBusy(false);
		}
	}

	async function handleDeleteDocument(id: string) {
		if (!window.confirm("Remove this document from the library?")) return;
		setBusy(true);
		try {
			const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
			if (!res.ok) throw new Error("Could not delete document.");
			if (documentDetailId === id) {
				setDocumentDetailId(null);
				setDocumentDetail(null);
			}
			await refreshDocuments();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function setDocIncludeInChat(
		documentId: string,
		includeInChat: boolean,
	) {
		if (!activeChatId || librarySelectionLocked) return;
		setError(null);
		setSavingIncludeDocId(documentId);
		try {
			const res = await fetch(`/api/chats/${activeChatId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ documentId, includeInChat }),
			});
			const payload = (await res.json()) as {
				error?: string;
				includedLibraryDocumentIds?: string[];
			};
			if (!res.ok) throw new Error(payload.error ?? "Could not update.");
			setIncludedLibraryDocIds(payload.includedLibraryDocumentIds ?? []);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSavingIncludeDocId(null);
		}
	}

	async function uploadChatAttachment(file: File) {
		if (!activeChatId) {
			setError("Create or select a chat first.");
			return;
		}
		setBusy(true);
		setUploadFlow({ kind: "attachment", stage: "prepare" });
		try {
			const fd = new FormData();
			fd.set("file", file);
			setUploadFlow({ kind: "attachment", stage: "upload" });
			const res = await fetch(`/api/chats/${activeChatId}/attachments`, {
				method: "POST",
				body: fd,
			});
			const payload = (await res.json()) as {
				error?: string;
				document?: { id: string };
			};
			setUploadFlow({ kind: "attachment", stage: "link" });
			if (!res.ok) {
				throw new Error(payload.error ?? "Attachment upload failed.");
			}
			const docId = payload.document?.id;
			if (docId) {
				setPendingAttachmentIds((prev) =>
					prev.includes(docId) ? prev : [...prev, docId],
				);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setUploadFlow({ kind: "idle" });
			setBusy(false);
		}
	}

	async function handleSend() {
		if (!activeChatId) {
			setError("Create or select a chat.");
			return;
		}
		const text = draft.trim();
		if (!text) return;
		setError(null);
		setBusy(true);
		try {
			const res = await fetch(`/api/chats/${activeChatId}/messages`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					content: text,
					attachmentIds: pendingAttachmentIds,
				}),
			});
			const payload = (await res.json()) as { error?: string };
			if (!res.ok) throw new Error(payload.error ?? "Send failed.");
			setDraft("");
			setPendingAttachmentIds([]);
			await loadChat(activeChatId);
			await refreshChats();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	function ChatListPanel({ className }: { className?: string }) {
		return (
			<div className={cn("flex min-h-0 flex-col gap-3", className)}>
				<div className="flex items-center gap-2">
					<Button
						className="flex-1"
						onClick={() => void handleNewChat()}
						disabled={busy}
					>
						<MessageSquarePlus className="h-4 w-4" />
						New chat
					</Button>
				</div>
				<Separator />
				<ScrollArea className="min-h-0 flex-1 pr-2">
					<div className="space-y-2 pb-2">
						{chats.map((c) => (
							<div
								key={c.id}
								className={cn(
									"rounded-lg border border-border p-2",
									c.id === activeChatId && "bg-accent",
								)}
							>
								<button
									type="button"
									className="w-full text-left text-sm font-medium"
									onClick={() => void handleSelectChat(c.id)}
								>
									{c.title?.trim() || "Untitled chat"}
								</button>
								<div className="mt-2 flex justify-end">
									<Button
										variant="ghost"
										size="sm"
										className="text-destructive hover:text-destructive"
										onClick={() => void handleDeleteChat(c.id)}
										disabled={busy}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</div>
						))}
						{chats.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No chats yet. Start one to ask questions about your project
								documents.
							</p>
						) : null}
					</div>
				</ScrollArea>
			</div>
		);
	}

	const includedLibraryDocSet = useMemo(
		() => new Set(includedLibraryDocIds),
		[includedLibraryDocIds],
	);

	function DocumentsPanel({
		className,
		onOpenDocument,
	}: {
		className?: string;
		onOpenDocument: (id: string) => void;
	}) {
		return (
			<div className={cn("flex min-h-0 flex-col gap-3", className)}>
				<ScrollArea className="min-h-0 flex-1 pr-2">
					<div className="space-y-2 pb-2">
						{documents.map((d) => (
							<div
								key={d.id}
								className="rounded-lg border border-border bg-card p-3 text-sm"
							>
								<div className="flex gap-2">
									<button
										type="button"
										className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/50"
										onClick={() => onOpenDocument(d.id)}
									>
										<div className="min-w-0">
											<p className="font-medium leading-snug">{d.name}</p>
											{d.description ? (
												<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
													{d.description}
												</p>
											) : null}
											{d.indexingError ? (
												<p className="mt-1 line-clamp-2 text-xs text-destructive">
													{d.indexingError}
												</p>
											) : null}
										</div>
									</button>
									<Button
										variant="ghost"
										size="icon"
										className="shrink-0 self-start"
										onClick={(e) => {
											e.stopPropagation();
											void handleDeleteDocument(d.id);
										}}
										disabled={busy}
										aria-label="Delete document"
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
								<div
									className={cn(
										"mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 pt-2",
										!activeChatId && "justify-start",
										activeChatId && "justify-between",
									)}
								>
									<p className="min-w-0 text-xs text-muted-foreground">
										Status:{" "}
										<span
											className={cn(
												d.indexingStatus === "ready" &&
													"text-emerald-600 dark:text-emerald-400",
												d.indexingStatus === "failed" && "text-destructive",
											)}
										>
											{d.indexingStatus}
										</span>
									</p>
									{activeChatId ? (
										<label
											className={cn(
												"flex max-w-full cursor-pointer select-none items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-none shadow-sm hover:bg-accent/50 sm:shrink-0",
												librarySelectionLocked && "opacity-90",
											)}
										>
											<input
												type="checkbox"
												className="h-4 w-4 shrink-0 cursor-pointer rounded border border-input text-primary accent-primary shadow disabled:opacity-60"
												checked={includedLibraryDocSet.has(d.id)}
												disabled={
													busy ||
													savingIncludeDocId === d.id ||
													librarySelectionLocked ||
													d.indexingStatus !== "ready"
												}
												onChange={(e) =>
													void setDocIncludeInChat(d.id, e.target.checked)
												}
												aria-label={`Include ${d.name} in chat context`}
											/>
											<span className="text-muted-foreground">
												<span className="font-medium text-foreground">
													Include
												</span>{" "}
												in chat
												{librarySelectionLocked ? (
													<span className="ml-1 text-[10px] font-normal text-muted-foreground/90">
														(Locked)
													</span>
												) : d.indexingStatus !== "ready" ? (
													<span className="ml-1 text-[10px] font-normal text-muted-foreground/90">
														(When ready)
													</span>
												) : null}
											</span>
										</label>
									) : null}
								</div>
							</div>
						))}
						{documents.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No documents yet. Use + to upload drawings, specifications,
								contracts, or correspondence.
							</p>
						) : null}
					</div>
				</ScrollArea>
			</div>
		);
	}

	return (
		<div className="flex min-h-dvh flex-col bg-background text-foreground">
			<header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
				<div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-3 sm:px-4">
					<div className="flex items-center gap-2 lg:hidden">
						<Sheet open={leftOpen} onOpenChange={setLeftOpen}>
							<SheetTrigger asChild>
								<Button variant="outline" size="icon" aria-label="Chat history">
									<History className="h-4 w-4" />
								</Button>
							</SheetTrigger>
							<SheetContent side="left" className="flex flex-col">
								<SheetHeader>
									<SheetTitle>Chats</SheetTitle>
								</SheetHeader>
								<ChatListPanel className="mt-4 min-h-0 flex-1" />
							</SheetContent>
						</Sheet>
						<Sheet open={rightOpen} onOpenChange={setRightOpen}>
							<SheetTrigger asChild>
								<Button variant="outline" size="icon" aria-label="Documents">
									<PanelRight className="h-4 w-4" />
								</Button>
							</SheetTrigger>
							<SheetContent side="right" className="flex flex-col">
								<SheetHeader className="flex flex-row items-center justify-between gap-2 space-y-0 border-b border-border pb-4 pr-10 text-left">
									<SheetTitle>Documents</SheetTitle>
									<Button
										type="button"
										variant="outline"
										size="icon"
										aria-label="Add document"
										onClick={() => setLibraryUploadOpen(true)}
									>
										<Plus className="h-4 w-4" />
									</Button>
								</SheetHeader>
								<DocumentsPanel
									className="mt-4 min-h-0 flex-1"
									onOpenDocument={setDocumentDetailId}
								/>
							</SheetContent>
						</Sheet>
					</div>
					<div className="flex min-w-0 flex-1 items-center gap-2">
						<FileText className="hidden h-5 w-5 shrink-0 sm:block" />
						<div className="min-w-0">
							<p className="truncate text-sm font-semibold sm:text-base">
								Project Docs AI
							</p>
							<p className="truncate text-xs text-muted-foreground sm:text-sm">
								{activeChatTitle}
							</p>
						</div>
					</div>
				</div>
				{error ? (
					<div className="border-t border-border bg-destructive/10 px-3 py-2 text-xs text-destructive sm:text-sm">
						{error}
					</div>
				) : null}
			</header>

			<div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 gap-0 px-0 sm:px-2 lg:gap-3 lg:px-4 lg:py-4">
				<aside className="hidden min-h-0 w-[min(100%,17rem)] shrink-0 flex-col rounded-xl border border-border bg-card lg:flex">
					<div className="border-b border-border px-3 py-3">
						<p className="text-sm font-semibold">Chat history</p>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden p-3">
						<ChatListPanel className="h-full min-h-[40vh]" />
					</div>
				</aside>

				<main className="flex min-h-0 min-w-0 flex-1 flex-col border-border lg:rounded-xl lg:border lg:bg-card">
					<ScrollArea className="min-h-0 flex-1">
						<div className="space-y-4 px-3 py-4 sm:px-4">
							{!activeChatId ? (
								<div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
									Create a chat to begin. In the Documents panel check the files you
									want in context (indexed and ready before the first send). Locked
									after the first message.
								</div>
							) : null}

							{messages.map((m) => (
								<div
									key={m.id}
									className={cn(
										"flex",
										m.role === "user" ? "justify-end" : "justify-start",
									)}
								>
									<div
										className={cn(
											"max-w-[min(100%,52rem)] rounded-2xl border px-4 py-3 text-sm shadow-sm",
											m.role === "user"
												? "border-primary/30 bg-primary text-primary-foreground"
												: "border-border bg-background",
										)}
									>
										{m.role === "assistant" ? (
											<MarkdownMessage content={m.content} />
										) : (
											<p className="whitespace-pre-wrap">{m.content}</p>
										)}
										{m.attachments?.length ? (
											<div className="mt-2 flex flex-wrap gap-2">
												{m.attachments.map((a) => (
													<span
														key={`${m.id}-${a.id ?? a.name}`}
														className={cn(
															"rounded-full px-2 py-1 text-xs",
															m.role === "user"
																? "bg-primary-foreground/15"
																: "bg-muted text-muted-foreground",
														)}
													>
														{a.name ?? "Attachment"}
													</span>
												))}
											</div>
										) : null}
									</div>
								</div>
							))}
						</div>
					</ScrollArea>

					<div className="border-t border-border bg-background p-3 sm:p-4 lg:bg-card">
						<input
							ref={chatAttachRef}
							type="file"
							className="hidden"
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f) void uploadChatAttachment(f);
								e.target.value = "";
							}}
						/>

						{pendingAttachmentIds.length ? (
							<div className="mb-2 flex flex-wrap gap-2">
								{pendingAttachmentIds.map((id) => (
									<button
										key={id}
										type="button"
										className="rounded-full border border-border bg-muted px-3 py-1 text-xs"
										onClick={() =>
											setPendingAttachmentIds((prev) =>
												prev.filter((x) => x !== id),
											)
										}
									>
										Attachment{" "}
										<span className="font-mono text-[10px] opacity-70">
											{id.slice(0, 8)}…
										</span>
									</button>
								))}
							</div>
						) : null}

						{uploadFlow.kind === "attachment" ? (
							<div className="mb-2 rounded-md border border-border bg-muted/40 p-3">
								<p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
									<Loader2
										className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
										aria-hidden
									/>
									Uploading attachment…
								</p>
								<UploadStepsList
									steps={ATTACHMENT_UPLOAD_STEPS}
									currentStageId={uploadFlow.stage}
								/>
							</div>
						) : null}

						<div className="flex items-end gap-2">
							<Button
								type="button"
								variant="outline"
								size="icon"
								disabled={!activeChatId || busy}
								aria-label="Attach file"
								onClick={() => chatAttachRef.current?.click()}
							>
								<ImagePlus className="h-4 w-4" />
							</Button>
							<Textarea
								className="min-h-[44px] flex-1 resize-none"
								placeholder={
									activeChatId
										? "Ask about notices, delays, variations, FIDIC clauses…"
										: "Select a chat first…"
								}
								value={draft}
								disabled={!activeChatId || busy}
								onChange={(e) => setDraft(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										void handleSend();
									}
								}}
							/>
							<Button
								type="button"
								onClick={() => void handleSend()}
								disabled={!activeChatId || busy}
								size="icon"
								aria-label="Send"
							>
								<SendHorizontal className="h-4 w-4" />
							</Button>
						</div>
						<p className="mt-2 text-[11px] text-muted-foreground sm:text-xs">
							Shift+Enter adds a new line. References in answers link to the
							document viewer at the cited page and passage.
						</p>
					</div>
				</main>

				<aside className="hidden min-h-0 w-[min(100%,18rem)] shrink-0 flex-col rounded-xl border border-border bg-card lg:flex">
					<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
						<p className="font-semibold">Project documents</p>
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label="Add document"
							onClick={() => setLibraryUploadOpen(true)}
						>
							<Plus className="h-4 w-4" />
						</Button>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden p-3">
						<DocumentsPanel
							className="h-full min-h-[40vh]"
							onOpenDocument={setDocumentDetailId}
						/>
					</div>
				</aside>

				<Dialog
					open={libraryUploadOpen}
					onOpenChange={(open) => {
						if (!open && uploadFlow.kind === "library") return;
						setLibraryUploadOpen(open);
					}}
				>
					<DialogContent className="max-h-[92vh] overflow-y-auto">
						<DialogHeader>
							<DialogTitle className="pr-8">Upload project document</DialogTitle>
						</DialogHeader>
						<form
							className="space-y-2"
							onSubmit={(e) => void handleLibraryUpload(e)}
						>
							<Input
								ref={libraryFileRef}
								type="file"
								className="cursor-pointer"
							/>
							<Input
								placeholder="Document name"
								value={docName}
								onChange={(e) => setDocName(e.target.value)}
							/>
							<Textarea
								placeholder="Short description"
								className="min-h-[72px]"
								value={docDescription}
								onChange={(e) => setDocDescription(e.target.value)}
							/>
							{uploadFlow.kind === "library" ? (
								<div className="rounded-md border border-border bg-muted/40 p-3">
									<p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
										<Loader2
											className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
											aria-hidden
										/>
										Uploading document…
									</p>
									<UploadStepsList
										steps={LIBRARY_UPLOAD_STEPS}
										currentStageId={uploadFlow.stage}
									/>
								</div>
							) : null}
							<Button type="submit" className="w-full" disabled={busy}>
								{uploadFlow.kind === "library" ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Uploading…
									</>
								) : (
									"Upload to library"
								)}
							</Button>
						</form>
					</DialogContent>
				</Dialog>

				<Dialog
					open={documentDetailId !== null}
					onOpenChange={(open) => {
						if (!open) {
							setDocumentDetailId(null);
							setDocumentDetailError(null);
						}
					}}
				>
					<DialogContent className="h-auto max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-7xl overflow-y-auto">
						<DialogHeader>
							<DialogTitle className="pr-8">
								{documentDetail?.name ?? "Document details"}
							</DialogTitle>
						</DialogHeader>
						{documentDetailLoading ? (
							<div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
								<Loader2 className="h-4 w-4 shrink-0 animate-spin" />
								Loading details…
							</div>
						) : documentDetailError ? (
							<p className="text-sm text-destructive">{documentDetailError}</p>
						) : documentDetail ? (
							<div className="space-y-4 text-sm">
								<div className="space-y-3">
									<div>
										<p className="text-xs font-medium text-muted-foreground">
											Description
										</p>
										<p className="mt-1 whitespace-pre-wrap break-words">
											{documentDetail.description?.trim() || "—"}
										</p>
									</div>
									<div className="grid gap-3 sm:grid-cols-2">
										<div>
											<p className="text-xs font-medium text-muted-foreground">
												Type
											</p>
											<p className="mt-1 font-mono text-xs">
												{documentDetail.mimeType}
											</p>
										</div>
										<div>
											<p className="text-xs font-medium text-muted-foreground">
												Size
											</p>
											<p className="mt-1">
												{formatFileSize(documentDetail.sizeBytes)}
											</p>
										</div>
									</div>
									<div>
										<p className="text-xs font-medium text-muted-foreground">
											Indexing status
										</p>
										<p
											className={cn(
												"mt-1",
												documentDetail.indexingStatus === "ready" &&
													"text-emerald-600 dark:text-emerald-400",
												documentDetail.indexingStatus === "failed" &&
													"text-destructive",
											)}
										>
											{documentDetail.indexingStatus}
										</p>
										{documentDetail.indexingError ? (
											<p className="mt-1 text-xs text-destructive">
												{documentDetail.indexingError}
											</p>
										) : null}
									</div>
									<div className="grid gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
										<p>
											<span className="font-medium text-foreground">
												Added:{" "}
											</span>
											{formatDateTime(documentDetail.createdAt)}
										</p>
										<p>
											<span className="font-medium text-foreground">
												Updated:{" "}
											</span>
											{formatDateTime(documentDetail.updatedAt)}
										</p>
									</div>
								</div>
								<Button asChild className="w-full sm:w-auto">
									<Link href={`/viewer/${documentDetail.id}`}>
										Open in viewer
									</Link>
								</Button>
							</div>
						) : null}
					</DialogContent>
				</Dialog>

			</div>
		</div>
	);
}
