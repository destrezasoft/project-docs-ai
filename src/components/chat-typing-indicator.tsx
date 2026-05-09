/** Chat-style “assistant is typing”: staggered bouncing dots in an assistant bubble. */
export function ChatTypingIndicator() {
	return (
		<div
			className="flex max-w-[min(100%,52rem)] justify-start"
			role="status"
			aria-live="polite"
			aria-label="Assistant is thinking"
		>
			<div className="rounded-2xl border border-border bg-background px-4 py-3.5 shadow-sm">
				<div className="flex items-center gap-1 px-0.5">
					<span className="chat-typing-dot size-2 rounded-full bg-muted-foreground/55" />
					<span className="chat-typing-dot size-2 rounded-full bg-muted-foreground/55 [animation-delay:0.2s]" />
					<span className="chat-typing-dot size-2 rounded-full bg-muted-foreground/55 [animation-delay:0.4s]" />
				</div>
			</div>
		</div>
	);
}
