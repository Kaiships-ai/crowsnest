CREATE TABLE `own_account_breakdowns` (
	`id` text PRIMARY KEY NOT NULL,
	`captured_at` text NOT NULL,
	`metric` text NOT NULL,
	`dimension` text NOT NULL,
	`key` text NOT NULL,
	`value` integer NOT NULL,
	`timeframe` text
);
--> statement-breakpoint
CREATE INDEX `own_account_breakdowns_metric_captured` ON `own_account_breakdowns` (`metric`,`captured_at`);--> statement-breakpoint
ALTER TABLE `own_post_insights` ADD `reposts` integer;--> statement-breakpoint
ALTER TABLE `own_post_insights` ADD `skip_rate` real;--> statement-breakpoint
ALTER TABLE `own_post_insights` ADD `bio_link_taps` integer;--> statement-breakpoint
ALTER TABLE `own_post_insights` ADD `avg_watch_time_ms` real;--> statement-breakpoint
ALTER TABLE `own_post_insights` ADD `total_watch_time_ms` real;--> statement-breakpoint
ALTER TABLE `own_posts` ADD `thumbnail_url` text;