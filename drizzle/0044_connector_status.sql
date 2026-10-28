CREATE TABLE `connector_status` (
	`connector_id` text PRIMARY KEY NOT NULL,
	`pull_state` text,
	`pull_message` text,
	`pull_detail` text,
	`pulled_at` text,
	`check_message` text,
	`checked_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "connector_status_pull_state" CHECK("connector_status"."pull_state" in ('ready', 'partial', 'error'))
);
--> statement-breakpoint
DROP TABLE `daily_pulls`;
