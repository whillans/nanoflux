ALTER TABLE `t_feeds` ADD `fetch_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `t_feeds` ADD `last_error` text;
