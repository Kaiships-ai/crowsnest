CREATE TABLE `mcp_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tokens_hash` ON `mcp_tokens` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tokens_live_name` ON `mcp_tokens` (`name`) WHERE revoked_at IS NULL;
