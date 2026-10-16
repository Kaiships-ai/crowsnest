CREATE TABLE `reel_funnel` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword` text NOT NULL,
	`source` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`captured_at` text NOT NULL,
	`agent` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reel_funnel_latest` ON `reel_funnel` (lower("keyword"),`source`,`metric`,`captured_at`);