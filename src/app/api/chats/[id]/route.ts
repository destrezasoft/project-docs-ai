import { NextResponse } from "next/server";
import {
	Chat,
	ChatIncludedLibraryDoc,
	Message,
	MessageAttachment,
	ProjectDocument,
} from "@/models";
import { ensureDb } from "@/lib/route-setup";
import { deleteFileSearchStore } from "@/lib/gemini";
import { deleteDocumentObject } from "@/lib/s3";
import { getSequelize } from "@/lib/db";

function safeParseCitations(raw: string | null): unknown[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export const dynamic = "force-dynamic";

export async function GET(
	_req: Request,
	ctx: { params: Promise<{ id: string }> },
) {
	await ensureDb();
	const { id } = await ctx.params;
	const chat = await Chat.findByPk(id);
	if (!chat) {
		return NextResponse.json({ error: "Not found." }, { status: 404 });
	}

	const messages = await Message.findAll({
		where: { chatId: id },
		order: [["createdAt", "ASC"]],
		include: [
			{
				model: MessageAttachment,
				as: "attachments",
				include: [{ model: ProjectDocument, as: "document" }],
			},
		],
	});

	const inclusionRows = await ChatIncludedLibraryDoc.findAll({
		where: { chatId: id },
		attributes: ["documentId"],
	});

	const librarySelectionLocked = messages.length > 0;

	return NextResponse.json({
		chat: {
			id: chat.id,
			title: chat.title,
			updatedAt: chat.updatedAt,
		},
		includedLibraryDocumentIds: inclusionRows.map((r) => r.documentId),
		librarySelectionLocked,
		messages: messages.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
			citations: safeParseCitations(m.citationsJson),
			createdAt: m.createdAt,
			attachments:
				m.attachments?.map((a) => ({
					id: a.document?.id,
					name: a.document?.name,
					mimeType: a.document?.mimeType,
				})) ?? [],
		})),
	});
}

export async function PATCH(
	req: Request,
	ctx: { params: Promise<{ id: string }> },
) {
	await ensureDb();
	const { id } = await ctx.params;
	const chat = await Chat.findByPk(id);
	if (!chat) {
		return NextResponse.json({ error: "Not found." }, { status: 404 });
	}

	const msgCount = await Message.count({ where: { chatId: id } });
	if (msgCount > 0) {
		return NextResponse.json(
			{
				error:
					"Library document inclusion cannot be changed after the first message in this chat.",
			},
			{ status: 409 },
		);
	}

	const body = (await req.json()) as {
		documentId?: unknown;
		includeInChat?: unknown;
	};
	const documentId =
		typeof body.documentId === "string" ? body.documentId.trim() : "";

	if (!documentId) {
		return NextResponse.json(
			{ error: "documentId is required." },
			{ status: 400 },
		);
	}
	if (typeof body.includeInChat !== "boolean") {
		return NextResponse.json(
			{ error: "includeInChat (boolean) is required." },
			{ status: 400 },
		);
	}

	const libraryDoc = await ProjectDocument.findOne({
		where: { id: documentId, scope: "library" },
	});
	if (!libraryDoc) {
		return NextResponse.json(
			{ error: "Document not found or not a library document." },
			{ status: 404 },
		);
	}

	const existing = await ChatIncludedLibraryDoc.findOne({
		where: { chatId: id, documentId },
	});

	if (body.includeInChat) {
		if (!existing) {
			await ChatIncludedLibraryDoc.create({ chatId: id, documentId });
		}
	} else if (existing) {
		await existing.destroy();
	}

	const inclusions = await ChatIncludedLibraryDoc.findAll({
		where: { chatId: id },
		attributes: ["documentId"],
	});

	return NextResponse.json({
		includedLibraryDocumentIds: inclusions.map((r) => r.documentId),
	});
}

export async function DELETE(
	_req: Request,
	ctx: { params: Promise<{ id: string }> },
) {
	await ensureDb();
	const { id } = await ctx.params;
	const chat = await Chat.findByPk(id);
	if (!chat) {
		return NextResponse.json({ error: "Not found." }, { status: 404 });
	}

	const sql = getSequelize();

	await sql.transaction(async (t) => {
		await Message.destroy({ where: { chatId: id }, transaction: t });
		const chatDocs = await ProjectDocument.findAll({
			where: { chatId: id, scope: "chat" },
			transaction: t,
		});
		for (const doc of chatDocs) {
			if (doc.fileSearchStoreName) {
				try {
					await deleteFileSearchStore(doc.fileSearchStoreName);
				} catch {
					/* best-effort */
				}
			}
			try {
				await deleteDocumentObject(doc.s3Key);
			} catch {
				/* best-effort */
			}
			await doc.destroy({ transaction: t });
		}
		await Chat.destroy({ where: { id }, transaction: t });
	});

	return NextResponse.json({ ok: true });
}
