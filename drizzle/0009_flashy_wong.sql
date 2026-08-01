CREATE TABLE `log_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`level` text NOT NULL,
	`source` text NOT NULL,
	`event` text NOT NULL,
	`fields` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `log_events_level_id` ON `log_events` (`level`,`id`);--> statement-breakpoint
CREATE INDEX `log_events_source_id` ON `log_events` (`source`,`id`);