CREATE TABLE `agent_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`call_id` text NOT NULL,
	`at` text NOT NULL,
	`caller` text NOT NULL,
	`tool` text NOT NULL,
	`input` text NOT NULL,
	`result` text NOT NULL,
	`gate` text NOT NULL,
	`draft_id` text
);
--> statement-breakpoint
CREATE TABLE `gate_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`tool` text NOT NULL,
	`input` text NOT NULL,
	`caller` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `agent_actions_no_update` BEFORE UPDATE ON `agent_actions` BEGIN SELECT RAISE(ABORT, 'agent_actions is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `agent_actions_no_delete` BEFORE DELETE ON `agent_actions` BEGIN SELECT RAISE(ABORT, 'agent_actions is append-only'); END;
