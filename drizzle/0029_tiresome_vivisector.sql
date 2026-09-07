CREATE TABLE `ig_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`username` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`proxy` text,
	`device_seed` text,
	`session_path` text,
	`port` integer,
	`cooldown_until` text,
	`last_sync_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ig_accounts_username` ON `ig_accounts` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `ig_accounts_single_default` ON `ig_accounts` (`is_default`) WHERE "ig_accounts"."is_default" = 1;--> statement-breakpoint
ALTER TABLE `channels` ADD `account_id` text REFERENCES ig_accounts(id);--> statement-breakpoint
CREATE INDEX `channels_account` ON `channels` (`account_id`);