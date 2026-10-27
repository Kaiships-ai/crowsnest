PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_connector_status` (
	`connector_id` text PRIMARY KEY NOT NULL,
	`pull_state` text,
	`pull_message` text,
	`pull_detail` text,
	`pulled_at` text,
	`check_message` text,
	`checked_at` text,
	`updated_at` text NOT NULL,
	`off_at` text,
	`progress_done` integer,
	`progress_total` integer,
	`progress_label` text,
	`started_at` text,
	`retry_after` text,
	`summary` text,
	CONSTRAINT "connector_status_pull_state" CHECK("__new_connector_status"."pull_state" in ('ready', 'pulling', 'partial', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_connector_status`("connector_id", "pull_state", "pull_message", "pull_detail", "pulled_at", "check_message", "checked_at", "updated_at") SELECT "connector_id", "pull_state", "pull_message", "pull_detail", "pulled_at", "check_message", "checked_at", "updated_at" FROM `connector_status`;--> statement-breakpoint
DROP TABLE `connector_status`;--> statement-breakpoint
ALTER TABLE `__new_connector_status` RENAME TO `connector_status`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
