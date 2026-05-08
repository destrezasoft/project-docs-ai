/**
 * Removes appended References sections before replaying assistant turns into Gemini history,
 * so prompts stay concise without dropping substantive prose.
 */
export function stripReferencesSection(markdown: string): string {
	return markdown.replace(/\r?\n---\r?\n\r?\n### References[\s\S]*$/m, "").trimEnd();
}
