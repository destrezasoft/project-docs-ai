import { NextResponse } from "next/server";
import { Chat } from "@/models";
import { ensureDb } from "@/lib/route-setup";

export const dynamic = "force-dynamic";

export async function GET() {
	await ensureDb();
	const chats = await Chat.findAll({
		order: [["updatedAt", "DESC"]],
	});
	return NextResponse.json({
		chats: chats.map((c) => ({
			id: c.id,
			title: c.title,
			updatedAt: c.updatedAt,
			createdAt: c.createdAt,
		})),
	});
}

export async function POST() {
	await ensureDb();
	const chat = await Chat.create({});
	return NextResponse.json({
		chat: { id: chat.id, title: chat.title, createdAt: chat.createdAt },
	});
}
