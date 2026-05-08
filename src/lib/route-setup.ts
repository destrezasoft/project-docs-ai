import { syncDatabase } from "@/lib/db";
import { randomUUID } from "crypto";

let dbReady: Promise<void> | null = null;

export async function ensureDb(): Promise<void> {
	if (!dbReady) dbReady = syncDatabase();
	await dbReady;
}

export function newId(): string {
	return randomUUID();
}
