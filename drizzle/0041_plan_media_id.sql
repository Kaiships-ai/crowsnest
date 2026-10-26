ALTER TABLE `planned_posts` ADD `published_media_id` text;--> statement-breakpoint
UPDATE `planned_posts` SET `published_media_id` = `published_own_post_id`, `published_own_post_id` = NULL WHERE `published_own_post_id` IS NOT NULL AND `published_own_post_id` NOT IN (SELECT `id` FROM `own_posts`);
