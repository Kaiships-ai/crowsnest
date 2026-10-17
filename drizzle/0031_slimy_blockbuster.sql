ALTER TABLE `planned_posts` ADD `keyword` text;--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `magnet_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `planned_posts_keyword_lower` ON `planned_posts` (lower("keyword")) WHERE "planned_posts"."keyword" IS NOT NULL;