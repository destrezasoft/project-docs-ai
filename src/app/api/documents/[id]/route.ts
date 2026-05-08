import { NextResponse } from "next/server";
import { ProjectDocument } from "@/models";
import { ensureDb } from "@/lib/route-setup";
import { deleteFileSearchStore } from "@/lib/gemini";
import { deleteDocumentObject } from "@/lib/s3";

export const dynamic = "force-dynamic";

export async function GET(
	_req: Request,
	ctx: { params: Promise<{ id: string }> },
) {
	await ensureDb();
	const { id } = await ctx.params;
	const doc = await ProjectDocument.findByPk(id);
	if (!doc) {
		return NextResponse.json({ error: "Not found." }, { status: 404 });
	}
	if (doc.scope !== "library") {
		return NextResponse.json({ error: "Not found." }, { status: 404 });
	}
	return NextResponse.json({
		document: {
			id: doc.id,
			name: doc.name,
			description: doc.description,
			mimeType: doc.mimeType,
			sizeBytes: doc.sizeBytes,
			indexingStatus: doc.indexingStatus,
			indexingError: doc.indexingError,
			createdAt: doc.createdAt.toISOString(),
			updatedAt: doc.updatedAt.toISOString(),
		},
	});
}

export async function DELETE(
	_req: Request,
	ctx: { params: Promise<{ id: string }> },
) {
	await ensureDb();
	const { id } = await ctx.params;
	const doc = await ProjectDocument.findByPk(id);
	if (!doc) {
		return NextResponse.json({ error: "Not found." }, { status: 404 });
	}
	if (doc.scope !== "library") {
		return NextResponse.json(
			{ error: "Only library documents can be deleted from this endpoint." },
			{ status: 400 },
		);
	}

	if (doc.fileSearchStoreName) {
		try {
			await deleteFileSearchStore(doc.fileSearchStoreName);
		} catch {
			/* still remove local record */
		}
	}
	// await deleteDocumentObject(doc.s3Key);
	await doc.destroy();

	return NextResponse.json({ ok: true });
}
