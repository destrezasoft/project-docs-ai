import { NextResponse } from "next/server";
import { Chat, ProjectDocument } from "@/models";
import { ensureDb, newId } from "@/lib/route-setup";
import { createStoreAndIndexDocument } from "@/lib/gemini";
import { getBucket, putDocumentObject } from "@/lib/s3";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function indexChatDocument(doc: ProjectDocument, buffer: Buffer) {
	try {
		const { fileSearchStoreName } = await createStoreAndIndexDocument({
			buffer,
			mimeType: doc.mimeType,
			displayName: doc.name,
			docId: doc.id,
		});
		doc.fileSearchStoreName = fileSearchStoreName;
		doc.indexingStatus = "ready";
		doc.indexingError = null;
		await doc.save();
	} catch (e) {
		doc.indexingStatus = "failed";
		doc.indexingError = e instanceof Error ? e.message : String(e);
		await doc.save();
		throw e;
	}
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

	const form = await req.formData();
	const file = form.get("file");

	if (!(file instanceof File)) {
		return NextResponse.json({ error: "file is required." }, { status: 400 });
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const id = newId();
	const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
	const key = `documents/chat/${chatId}/${id}/${safeName}`;

	const doc = await ProjectDocument.create({
		id,
		scope: "chat",
		chatId,
		name: file.name || "Attachment",
		description: null,
		s3Key: key,
		s3Bucket: getBucket(),
		mimeType: file.type || "application/octet-stream",
		sizeBytes: buffer.length,
		indexingStatus: "pending",
	});

	await putDocumentObject({
		key,
		body: buffer,
		contentType: doc.mimeType,
	});

	try {
		await indexChatDocument(doc, buffer);
	} catch {
		await doc.reload();
		return NextResponse.json(
			{
				document: {
					id: doc.id,
					name: doc.name,
					indexingStatus: doc.indexingStatus,
					indexingError: doc.indexingError,
				},
				error: doc.indexingError ?? "Indexing failed.",
			},
			{ status: 502 },
		);
	}

	await doc.reload();

	await Chat.update({ updatedAt: new Date() }, { where: { id: chatId } });

	return NextResponse.json({
		document: {
			id: doc.id,
			name: doc.name,
			mimeType: doc.mimeType,
			indexingStatus: doc.indexingStatus,
		},
	});
}
