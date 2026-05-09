export type SseEvent = { event: string; data: string };

/**
 * Reads an SSE stream from a fetch Response body and yields one parsed
 * event at a time. Tolerates multiple `data:` lines per event (concatenated
 * with newlines per the SSE spec) and ignores comments/blank fields.
 */
export async function* readSseStream(
	res: Response,
): AsyncGenerator<SseEvent> {
	const body = res.body;
	if (!body) return;

	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = "";

	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });

			while (true) {
				const sepIdx = findFrameSeparator(buf);
				if (sepIdx === -1) break;
				const frame = buf.slice(0, sepIdx.start);
				buf = buf.slice(sepIdx.end);
				const evt = parseFrame(frame);
				if (evt) yield evt;
			}
		}

		buf += decoder.decode();
		const tail = parseFrame(buf.trim());
		if (tail) yield tail;
	} finally {
		reader.releaseLock();
	}
}

function findFrameSeparator(
	buf: string,
): { start: number; end: number } | -1 {
	const a = buf.indexOf("\n\n");
	const b = buf.indexOf("\r\n\r\n");
	if (a === -1 && b === -1) return -1;
	if (a === -1) return { start: b, end: b + 4 };
	if (b === -1) return { start: a, end: a + 2 };
	return a < b ? { start: a, end: a + 2 } : { start: b, end: b + 4 };
}

function parseFrame(frame: string): SseEvent | null {
	if (!frame) return null;
	let event = "message";
	const dataLines: string[] = [];
	for (const rawLine of frame.split(/\r?\n/)) {
		if (!rawLine || rawLine.startsWith(":")) continue;
		const colon = rawLine.indexOf(":");
		const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
		let value = colon === -1 ? "" : rawLine.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "event") event = value;
		else if (field === "data") dataLines.push(value);
	}
	if (dataLines.length === 0) return null;
	return { event, data: dataLines.join("\n") };
}
