import { NextResponse } from "next/server";
import { ProjectDocument } from "@/models";
import { ensureDb, newId } from "@/lib/route-setup";
import { createStoreAndIndexDocument } from "@/lib/gemini";
import { deleteDocumentObject, getBucket, putDocumentObject } from "@/lib/s3";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function indexDocumentRecord(doc: ProjectDocument, buffer: Buffer) {
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

export async function GET() {
	await ensureDb();
	const docs = await ProjectDocument.findAll({
		where: { scope: "library" },
		order: [["updatedAt", "DESC"]],
	});
	return NextResponse.json({
		documents: docs.map((d) => ({
			id: d.id,
			name: d.name,
			description: d.description,
			mimeType: d.mimeType,
			sizeBytes: d.sizeBytes,
			indexingStatus: d.indexingStatus,
			indexingError: d.indexingError,
			updatedAt: d.updatedAt,
		})),
	});
}

export async function POST(req: Request) {
	await ensureDb();
	const form = await req.formData();
	const file = form.get("file");
	const nameRaw = form.get("name");
	const descriptionRaw = form.get("description");

	if (!(file instanceof File)) {
		return NextResponse.json({ error: "file is required." }, { status: 400 });
	}
	const name =
		(typeof nameRaw === "string" && nameRaw.trim()) || file.name || "Untitled";
	const description =
		typeof descriptionRaw === "string" && descriptionRaw.trim()
			? descriptionRaw.trim()
			: null;

	const buffer = Buffer.from(await file.arrayBuffer());
	const id = newId();
	const key = `documents/library/${id}/${file.name.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;

	const doc = await ProjectDocument.create({
		id,
		scope: "library",
		chatId: null,
		name,
		description,
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
		await indexDocumentRecord(doc, buffer);
	} catch {
		await doc.reload();
		return NextResponse.json(
			{
				document: {
					id: doc.id,
					name: doc.name,
					description: doc.description,
					indexingStatus: doc.indexingStatus,
					indexingError: doc.indexingError,
				},
				error: doc.indexingError ?? "Indexing failed.",
			},
			{ status: 502 },
		);
	}

	await doc.reload();
	return NextResponse.json({
		document: {
			id: doc.id,
			name: doc.name,
			description: doc.description,
			indexingStatus: doc.indexingStatus,
		},
	});
}
