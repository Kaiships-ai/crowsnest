CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`kind` text NOT NULL,
	`run_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE INDEX `notifications_read_created` ON `notifications` (`read_at`,`id`);--> statement-breakpoint
ALTER TABLE `log_events` ADD `run_id` text;--> statement-breakpoint
CREATE INDEX `log_events_run_id` ON `log_events` (`run_id`,`id`);