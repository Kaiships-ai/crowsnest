CREATE TABLE `plan_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`period_key` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`reels` text NOT NULL,
	`agent` text NOT NULL,
	`approved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_versions_period_version` ON `plan_versions` (`period`,`period_key`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_versions_single_live` ON `plan_versions` (`period`,`period_key`) WHERE "plan_versions"."status" = 'live';--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `plan_version_id` text REFERENCES plan_versions(id);--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `plan_reel_key` text;--> statement-breakpoint
CREATE INDEX `planned_posts_plan_version` ON `planned_posts` (`plan_version_id`);