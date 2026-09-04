CREATE TABLE `creator_seeds` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text DEFAULT 'instagram' NOT NULL,
	`handle` text NOT NULL,
	`niche` text NOT NULL,
	`why` text NOT NULL,
	`source` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creator_seeds_platform_handle` ON `creator_seeds` (`platform`,`handle`);