ALTER TABLE `video_analyses` ADD `source` text;--> statement-breakpoint
UPDATE `video_analyses` SET `source` = 'legacy' WHERE `source` IS NULL;