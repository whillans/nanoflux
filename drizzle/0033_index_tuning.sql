DROP INDEX `idx_feeds_next_fetched_at`;--> statement-breakpoint
DROP INDEX `idx_feeds_last_published_at`;--> statement-breakpoint
DROP INDEX `idx_items_sim_id`;--> statement-breakpoint
DROP INDEX `idx_items_cover`;--> statement-breakpoint
CREATE INDEX `idx_items_feed_id_published_at` ON `t_items` (`feed_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_items_status_is_read` ON `t_items` (`status`,`is_read`);--> statement-breakpoint
CREATE INDEX `idx_items_status_published_at` ON `t_items` (`status`,`published_at`,`is_read`);--> statement-breakpoint
CREATE INDEX `idx_items_sim_id` ON `t_items` (`sim_id`) WHERE `t_items`.`sim_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_items_cover` ON `t_items` (`cover`,`sim_id`) WHERE `t_items`.`cover` IS NOT NULL;--> statement-breakpoint
ANALYZE;
