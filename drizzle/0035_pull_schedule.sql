CREATE TABLE `daily_pulls` (
	`slot` text NOT NULL,
	`connector_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`outcome` text,
	`detail` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`slot`, `connector_id`)
);
--> statement-breakpoint
CREATE TABLE `source_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`called_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `source_calls_source_at` ON `source_calls` (`source`,`called_at`);