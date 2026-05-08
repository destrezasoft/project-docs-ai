"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = DialogPrimitive.Root;

const SheetTrigger = DialogPrimitive.Trigger;

const SheetClose = DialogPrimitive.Close;

const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Overlay
		className={cn("fixed inset-0 z-50 bg-black/80", className)}
		{...props}
		ref={ref}
	/>
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

type SheetSide = "top" | "bottom" | "left" | "right";

const sheetVariants: Record<SheetSide, string> = {
	top: "inset-x-0 top-0 border-b max-h-[85vh] rounded-b-lg",
	bottom: "inset-x-0 bottom-0 border-t max-h-[85vh] rounded-t-lg",
	left: "inset-y-0 left-0 h-full w-[min(100vw,18rem)] border-r sm:max-w-md",
	right:
		"inset-y-0 right-0 h-full w-[min(100vw,18rem)] border-l sm:max-w-md",
};

interface SheetContentProps
	extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
	side?: SheetSide;
}

const SheetContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	SheetContentProps
>(({ side = "left", className, children, ...props }, ref) => (
	<SheetPortal>
		<SheetOverlay />
		<DialogPrimitive.Content
			ref={ref}
			className={cn(
				"fixed z-50 gap-4 bg-background p-4 shadow-lg outline-none",
				sheetVariants[side],
				className,
			)}
			{...props}
		>
			{children}
			<DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
				<X className="h-4 w-4" />
				<span className="sr-only">Close</span>
			</DialogPrimitive.Close>
		</DialogPrimitive.Content>
	</SheetPortal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;

const SheetHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex flex-col space-y-2 text-center sm:text-left",
			className,
		)}
		{...props}
	/>
);
SheetHeader.displayName = "SheetHeader";

const SheetTitle = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Title
		ref={ref}
		className={cn("text-lg font-semibold text-foreground", className)}
		{...props}
	/>
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

export {
	Sheet,
	SheetPortal,
	SheetOverlay,
	SheetTrigger,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetTitle,
};
