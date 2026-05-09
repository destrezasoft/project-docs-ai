import {
	GoogleGenAI,
	type GroundingMetadata,
	type Operation,
	ThinkingLevel,
	Type,
} from "@google/genai";
import type { ProjectDocument } from "@/models";
import {
	DOCUMENT_SELECTION_SYSTEM_INSTRUCTION,
	GEMINI_MODEL,
	SYSTEM_INSTRUCTION,
} from "@/lib/constants";

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

export type DocumentCandidate = {
	id: string;
	name: string;
	description: string | null;
};

export type DocumentSelectionResult = {
	selectedIds: string[];
	reasoning: string | null;
};

/**
 * Routing step: ask Gemini which library documents (if any) the answering
 * model should consult via file_search to address the user's latest question.
 * Returns an empty selection when there are no candidates or when parsing fails,
 * so callers can safely proceed without file_search context in those cases.
 */
export async function selectRelevantDocuments(params: {
	history: GeminiHistoryTurn[];
	userMessage: string;
	candidates: DocumentCandidate[];
}): Promise<DocumentSelectionResult> {
	if (params.candidates.length === 0) {
		return { selectedIds: [], reasoning: null };
	}

	const ai = getGenAI();

	const catalogueText = params.candidates
		.map((c, i) => {
			const desc = c.description?.trim() || "(no description provided)";
			return `${i + 1}. id: ${c.id}\n   name: ${c.name}\n   description: ${desc}`;
		})
		.join("\n\n");

	const routingPrompt = `Available project documents (${params.candidates.length}):\n\n${catalogueText}\n\nUser's latest question:\n"""\n${params.userMessage}\n"""\n\nReturn the IDs of the documents the answering assistant should consult. If none are needed, return an empty list.`;

	const contents = [
		...params.history.map((h) => ({
			role: h.role,
			parts: [{ text: h.text }],
		})),
		{
			role: "user" as const,
			parts: [{ text: routingPrompt }],
		},
	];

	const validIds = new Set(params.candidates.map((c) => c.id));

	const response = await ai.models.generateContent({
		model: GEMINI_MODEL,
		contents,
		config: {
			systemInstruction: DOCUMENT_SELECTION_SYSTEM_INSTRUCTION,
			thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
			responseMimeType: "application/json",
			responseSchema: {
				type: Type.OBJECT,
				properties: {
					selectedDocumentIds: {
						type: Type.ARRAY,
						description:
							"IDs of project documents the answering assistant should consult. Use only IDs from the provided catalogue. May be empty.",
						items: { type: Type.STRING },
					},
					reasoning: {
						type: Type.STRING,
						description:
							"One short sentence explaining why those documents were selected (or why none were).",
					},
				},
				required: ["selectedDocumentIds"],
				propertyOrdering: ["selectedDocumentIds", "reasoning"],
			},
		},
	});

	const raw = response.text ?? "";
	let parsed: { selectedDocumentIds?: unknown; reasoning?: unknown };
	try {
		parsed = JSON.parse(raw) as typeof parsed;
	} catch {
		return { selectedIds: [], reasoning: null };
	}

	const rawIds = Array.isArray(parsed.selectedDocumentIds)
		? parsed.selectedDocumentIds
		: [];
	const selectedIds = Array.from(
		new Set(
			rawIds
				.filter((x): x is string => typeof x === "string")
				.filter((id) => validIds.has(id)),
		),
	);
	const reasoning =
		typeof parsed.reasoning === "string" && parsed.reasoning.trim()
			? parsed.reasoning.trim()
			: null;

	return { selectedIds, reasoning };
}

function buildAnswerRequest(params: {
	history: GeminiHistoryTurn[];
	userMessage: string;
	fileSearchStoreNames: string[];
}) {
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

	return {
		model: GEMINI_MODEL,
		contents,
		config: {
			systemInstruction: SYSTEM_INSTRUCTION,
			thinkingConfig: {
				thinkingLevel: ThinkingLevel.HIGH,
			},
			...(tools ? { tools } : {}),
		},
	};
}

export async function generateProjectAnswer(params: {
	history: GeminiHistoryTurn[];
	userMessage: string;
	fileSearchStoreNames: string[];
}): Promise<{ text: string; grounding?: GroundingMetadata }> {
	const ai = getGenAI();
	const response = await ai.models.generateContent(buildAnswerRequest(params));
	const text = response.text ?? "";
	const grounding = response.candidates?.[0]?.groundingMetadata;
	return { text, grounding };
}

export type AnswerStreamChunk =
	| { kind: "delta"; text: string }
	| { kind: "final"; text: string; grounding?: GroundingMetadata };

/**
 * Streams the answering model's output as it arrives. Yields one `delta`
 * chunk per non-empty text token from the SDK and finally a `final` chunk
 * carrying the full concatenated text plus the latest grounding metadata
 * (citations typically arrive in the last chunk).
 */
export async function* streamProjectAnswer(params: {
	history: GeminiHistoryTurn[];
	userMessage: string;
	fileSearchStoreNames: string[];
}): AsyncGenerator<AnswerStreamChunk> {
	const ai = getGenAI();
	const stream = await ai.models.generateContentStream(
		buildAnswerRequest(params),
	);

	let fullText = "";
	let lastGrounding: GroundingMetadata | undefined;

	for await (const chunk of stream) {
		const piece = chunk.text ?? "";
		const grounding = chunk.candidates?.[0]?.groundingMetadata;
		if (grounding) lastGrounding = grounding;
		if (piece) {
			fullText += piece;
			yield { kind: "delta", text: piece };
		}
	}

	yield { kind: "final", text: fullText, grounding: lastGrounding };
}
