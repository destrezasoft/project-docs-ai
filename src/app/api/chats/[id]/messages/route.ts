import { NextResponse } from "next/server";
import { Op } from "sequelize";
import {
	Chat,
	ChatIncludedLibraryDoc,
	Message,
	MessageAttachment,
	ProjectDocument,
} from "@/models";
import { ensureDb } from "@/lib/route-setup";
import {
	appendReferencesMarkdown,
	buildDocLookup,
	citationsFromGrounding,
	generateProjectAnswer,
} from "@/lib/gemini";
import { stripReferencesSection } from "@/lib/format-chat-history";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

	const inclusions = await ChatIncludedLibraryDoc.findAll({
		where: { chatId },
		attributes: ["documentId"],
	});
	const includedIds = new Set(inclusions.map((r) => r.documentId));

	const libraryDocsRaw = await ProjectDocument.findAll({
		where: {
			scope: "library",
			indexingStatus: "ready",
			fileSearchStoreName: { [Op.ne]: null },
		},
	});
	const libraryDocs = libraryDocsRaw.filter((d) => includedIds.has(d.id));

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

	const contextDocs = [...libraryDocs, ...chatAttachments];
	const storeNames = contextDocs
		.map((d) => d.fileSearchStoreName)
		.filter((s): s is string => Boolean(s));

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

	let assistantText = "";
	let citationsPayload: ReturnType<typeof citationsFromGrounding> = [];

	try {
		const { text, grounding } = await generateProjectAnswer({
			history,
			userMessage: content,
			fileSearchStoreNames: storeNames,
		});

		citationsPayload = citationsFromGrounding(
			grounding,
			buildDocLookup(contextDocs),
		);

		assistantText = appendReferencesMarkdown(text, citationsPayload);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		await Message.create({
			chatId,
			role: "assistant",
			content: `There was a problem generating a response: ${message}`,
			citationsJson: JSON.stringify([]),
		});
		await Chat.update({ updatedAt: new Date() }, { where: { id: chatId } });
		return NextResponse.json({ error: message }, { status: 502 });
	}

	await Message.create({
		chatId,
		role: "assistant",
		content: assistantText,
		citationsJson: JSON.stringify(citationsPayload),
	});

	if (!chat.title) {
		await chat.update({ title: content.slice(0, 120) });
	} else {
		await Chat.update({ updatedAt: new Date() }, { where: { id: chatId } });
	}

	return NextResponse.json({ ok: true });
}
