import { NextResponse } from "next/server";
import { Op } from "sequelize";
import {
	Chat,
	Message,
	MessageAttachment,
	ProjectDocument,
} from "@/models";
import { ensureDb } from "@/lib/route-setup";
import type { GroundingMetadata } from "@google/genai";
import {
	appendReferencesMarkdown,
	buildDocLookup,
	citationsFromGrounding,
	selectRelevantDocuments,
	streamProjectAnswer,
} from "@/lib/gemini";
import { stripReferencesSection } from "@/lib/format-chat-history";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sseFrame(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
	req: Request,
	ctx: { params: Promise<{ id: string }> },
) {
	await ensureDb();
	const { id: chatId } = await ctx.params;

	const chat = await Chat.findByPk(chatId);
	if (!chat) {
		return NextResponse.json({ error: "Not found." }, { status: 404 });
	}

	const body = (await req.json()) as {
		content?: unknown;
		attachmentIds?: unknown;
	};

	const content =
		typeof body.content === "string" ? body.content.trim() : "";
	const attachmentIds = Array.isArray(body.attachmentIds)
		? body.attachmentIds.filter((x): x is string => typeof x === "string")
		: [];

	if (!content) {
		return NextResponse.json({ error: "content is required." }, { status: 400 });
	}

	const libraryDocsRaw = await ProjectDocument.findAll({
		where: {
			scope: "library",
			indexingStatus: "ready",
			fileSearchStoreName: { [Op.ne]: null },
		},
	});

	let chatAttachments: ProjectDocument[] = [];
	if (attachmentIds.length) {
		chatAttachments = await ProjectDocument.findAll({
			where: {
				id: attachmentIds,
				chatId,
				scope: "chat",
				indexingStatus: "ready",
				fileSearchStoreName: { [Op.ne]: null },
			},
		});

		if (chatAttachments.length !== attachmentIds.length) {
			return NextResponse.json(
				{ error: "One or more attachments are invalid or still indexing." },
				{ status: 400 },
			);
		}
	}

	const prior = await Message.findAll({
		where: { chatId },
		order: [["createdAt", "ASC"]],
	});

	const history = prior.map((m) => ({
		role: m.role === "user" ? ("user" as const) : ("model" as const),
		text:
			m.role === "assistant"
				? stripReferencesSection(m.content)
				: m.content,
	}));

	const userRow = await Message.create({
		chatId,
		role: "user",
		content,
	});

	for (const doc of chatAttachments) {
		await MessageAttachment.create({
			messageId: userRow.id,
			documentId: doc.id,
		});
	}

	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (event: string, data: unknown) => {
				controller.enqueue(encoder.encode(sseFrame(event, data)));
			};

			let savedAssistant = false;

			try {
				const {
					selectedIds: selectedLibraryIds,
					reasoning: selectionReasoning,
				} = await selectRelevantDocuments({
					history,
					userMessage: content,
					candidates: libraryDocsRaw.map((d) => ({
						id: d.id,
						name: d.name,
						description: d.description,
					})),
				});

				const selectedSet = new Set(selectedLibraryIds);
				const libraryDocs = libraryDocsRaw.filter((d) =>
					selectedSet.has(d.id),
				);
				const contextDocs = [...libraryDocs, ...chatAttachments];
				const storeNames = contextDocs
					.map((d) => d.fileSearchStoreName)
					.filter((s): s is string => Boolean(s));

				if (process.env.NODE_ENV !== "production") {
					console.log(
						`[chat ${chatId}] document routing -> ${selectedLibraryIds.length}/${libraryDocsRaw.length} library doc(s) selected${
							selectionReasoning ? `: ${selectionReasoning}` : ""
						}`,
					);
				}

				send("meta", {
					userMessageId: userRow.id,
					selectedDocumentIds: selectedLibraryIds,
					selectedDocumentNames: libraryDocs.map((d) => d.name),
					attachmentDocumentIds: chatAttachments.map((d) => d.id),
					reasoning: selectionReasoning,
				});

				let fullText = "";
				let grounding: GroundingMetadata | undefined;

				for await (const chunk of streamProjectAnswer({
					history,
					userMessage: content,
					fileSearchStoreNames: storeNames,
				})) {
					if (chunk.kind === "delta") {
						fullText += chunk.text;
						send("delta", { text: chunk.text });
					} else {
						fullText = chunk.text || fullText;
						grounding = chunk.grounding;
					}
				}

				const citationsPayload = citationsFromGrounding(
					grounding,
					buildDocLookup(contextDocs),
				);
				const assistantText = appendReferencesMarkdown(
					fullText,
					citationsPayload,
				);

				const assistantRow = await Message.create({
					chatId,
					role: "assistant",
					content: assistantText,
					citationsJson: JSON.stringify(citationsPayload),
				});
				savedAssistant = true;

				if (!chat.title) {
					await chat.update({ title: content.slice(0, 120) });
				} else {
					await Chat.update(
						{ updatedAt: new Date() },
						{ where: { id: chatId } },
					);
				}

				send("done", {
					assistantMessageId: assistantRow.id,
					content: assistantText,
					citations: citationsPayload,
				});
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				if (!savedAssistant) {
					try {
						await Message.create({
							chatId,
							role: "assistant",
							content: `There was a problem generating a response: ${message}`,
							citationsJson: JSON.stringify([]),
						});
						await Chat.update(
							{ updatedAt: new Date() },
							{ where: { id: chatId } },
						);
					} catch {
						/* best-effort */
					}
				}
				send("error", { message });
			} finally {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}
