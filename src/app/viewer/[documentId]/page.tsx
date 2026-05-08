import { Suspense } from "react";
import { ViewerBody } from "./viewer-body";

export default function ViewerPage() {
	return (
		<Suspense
			fallback={
				<div className="p-4 text-sm text-muted-foreground">
					Loading document viewer…
				</div>
			}
		>
			<ViewerBody />
		</Suspense>
	);
}
