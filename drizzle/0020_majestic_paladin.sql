CREATE TABLE `create_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`heartbeat_at` text,
	`render_asset_id` text,
	`error_message` text,
	`pid` integer
);
--> statement-breakpoint
CREATE INDEX `create_runs_post` ON `create_runs` (`post_id`);--> statement-breakpoint
CREATE INDEX `create_runs_started` ON `create_runs` (`started_at`);