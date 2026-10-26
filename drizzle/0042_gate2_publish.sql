ALTER TABLE `planned_posts` ADD `cover_asset_id` text REFERENCES media_assets(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `gate_drafts` ADD `decided_by` text;--> statement-breakpoint
ALTER TABLE `gate_drafts` ADD `decided_at` text;--> statement-breakpoint
ALTER TABLE `gate_drafts` ADD `last_error` text;--> statement-breakpoint
UPDATE `planned_posts` SET `planned_date` = date(`scheduled_at`, 'localtime') WHERE `state` = 'scheduled' AND `scheduled_at` IS NOT NULL;
