CREATE INDEX `idx_items_status_is_read_published_at` ON `t_items` (`status`,`is_read`,`published_at`);--> statement-breakpoint
ANALYZE;
