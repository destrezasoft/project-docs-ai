import {
	GoogleGenAI,
	type GroundingMetadata,
	type Operation,
	ThinkingLevel,
} from "@google/genai";
import type { ProjectDocument } from "@/models";
import { GEMINI_MODEL, SYSTEM_INSTRUCTION } from "@/lib/constants";

export function getGenAI(): GoogleGenAI {
	const key = process.env.GEMINI_API_KEY;
	if (!key) throw new Error("GEMINI_API_KEY is not set.");
	return new GoogleGenAI({ apiKey: key });
}

function delay(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export async function pollUploadOperation(
	ai: GoogleGenAI,
	op: Operation<unknown>,
	timeoutMs = 900_000,
): Promise<Operation<unknown>> {
	const started = Date.now();
	let current = op;
	while (!current.done) {
		if (Date.now() - started > timeoutMs) {
			throw new Error("Timed out waiting for File Search indexing.");
		}
		await delay(2500);
		current = await ai.operations.get({
			operation: current,
		});
	}
	if (current.error) {
		throw new Error(
			`Indexing failed: ${JSON.stringify(current.error)}`,
		);
	}
	return current;
}

export async function createStoreAndIndexDocument(params: {
	buffer: Buffer;
	mimeType: string;
	displayName: string;
	docId: string;
}): Promise<{ fileSearchStoreName: string }> {
	const ai = getGenAI();

	const store = await ai.fileSearchStores.create({});
	const fileSearchStoreName = store.name ?? "";
	if (!fileSearchStoreName) {
		throw new Error("Failed to create File Search store.");
	}

	const blob = new Blob([new Uint8Array(params.buffer)], {
		type: params.mimeType,
	});

	let op = (await ai.fileSearchStores.uploadToFileSearchStore({
		file: blob,
		fileSearchStoreName,
		config: {
			mimeType: params.mimeType,
			displayName: params.displayName,
			customMetadata: [{ key: "doc_id", stringValue: params.docId }],
		},
	})) as Operation<unknown>;

	op = await pollUploadOperation(ai, op);
	void op;

	return { fileSearchStoreName };
}

export async function deleteFileSearchStore(name: string): Promise<void> {
	const ai = getGenAI();
	await ai.fileSearchStores.delete({
		name,
		config: { force: true },
	});
}

export type CitationPayload = {
	docId: string | null;
	label: string;
	page?: number;
	snippet?: string;
	fileSearchStore?: string;
};

export function buildDocLookup(
	docs: ProjectDocument[],
): Map<string, ProjectDocument> {
	const map = new Map<string, ProjectDocument>();
	for (const d of docs) {
		if (d.fileSearchStoreName) map.set(d.fileSearchStoreName, d);
	}
	return map;
}

export function citationsFromGrounding(
	metadata: GroundingMetadata | undefined,
	lookup: Map<string, ProjectDocument>,
): CitationPayload[] {
	const chunks = metadata?.groundingChunks ?? [];
	const seen = new Set<string>();
	const out: CitationPayload[] = [];

	for (const ch of chunks) {
		const ctx = ch.retrievedContext;
		if (!ctx?.fileSearchStore) continue;

		const doc = lookup.get(ctx.fileSearchStore);
		const metaDocId = ctx.customMetadata?.find((m) => m.key === "doc_id")
			?.stringValue;
		const docId = doc?.id ?? metaDocId ?? null;

		const label = doc?.name ?? ctx.title ?? "Document";
		const page = ctx.pageNumber ?? undefined;
		const snippet = ctx.text ?? undefined;
		const key = `${docId ?? ctx.fileSearchStore}:${page ?? 0}:${snippet?.slice(0, 80) ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);

		out.push({
			docId,
			label,
			page,
			snippet,
			fileSearchStore: ctx.fileSearchStore,
		});
	}

	return out;
}

export function appendReferencesMarkdown(
	text: string,
	citations: CitationPayload[],
): string {
	if (!citations.length) return text;
	const lines = citations.map((c, idx) => {
		const page = c.page ? ` (p. ${c.page})` : "";
		if (!c.docId) {
			return `- [${idx + 1}] ${c.label}${page}`;
		}
		const qs = new URLSearchParams();
		if (c.page) qs.set("page", String(c.page));
		if (c.snippet) qs.set("highlight", c.snippet.slice(0, 600));
		const href = `/viewer/${c.docId}?${qs.toString()}`;
		return `- [${idx + 1}] [${c.label}${page}](${href})`;
	});

	return `${text.trimEnd()}\n\n---\n\n### References\n\n${lines.join("\n")}\n`;
}

export type GeminiHistoryTurn = {
	role: "user" | "model";
	text: string;
};

export async function generateProjectAnswer(params: {
	history: GeminiHistoryTurn[];
	userMessage: string;
	fileSearchStoreNames: string[];
}): Promise<{ text: string; grounding?: GroundingMetadata }> {
	const ai = getGenAI();

	const contents = [
		...params.history.map((h) => ({
			role: h.role,
			parts: [{ text: h.text }],
		})),
		{
			role: "user" as const,
			parts: [{ text: params.userMessage }],
		},
	];

	const tools =
		params.fileSearchStoreNames.length > 0
			? [
					{
						fileSearch: {
							fileSearchStoreNames: params.fileSearchStoreNames,
						},
					},
				]
			: undefined;

	const response = await ai.models.generateContent({
		model: GEMINI_MODEL,
		contents,
		config: {
			systemInstruction: SYSTEM_INSTRUCTION,
			thinkingConfig: {
				thinkingLevel: ThinkingLevel.HIGH,
			},
			...(tools ? { tools } : {}),
		},
	});

	const text = response.text ?? "";
	const grounding = response.candidates?.[0]?.groundingMetadata;

	return { text, grounding };
}
