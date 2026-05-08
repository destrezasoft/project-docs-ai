import { NextResponse } from "next/server";
import { ProjectDocument } from "@/models";
import { ensureDb } from "@/lib/route-setup";
import { getPresignedGetUrl } from "@/lib/s3";

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

	const url = await getPresignedGetUrl({
		key: doc.s3Key,
		inlineFilename: doc.name,
	});

	return NextResponse.json({
		url,
		mimeType: doc.mimeType,
		name: doc.name,
	});
}
