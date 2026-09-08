CREATE TABLE `content_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`source_video_ids` text,
	`agent` text NOT NULL,
	`model` text,
	`assumptions` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `content_artifacts_kind_created` ON `content_artifacts` (`kind`,`created_at`);