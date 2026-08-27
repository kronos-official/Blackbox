ALTER TABLE `groupRecentMessages` ADD `autoDeleteAt` timestamp;--> statement-breakpoint
CREATE INDEX `group_recent_messages_auto_delete_idx` ON `groupRecentMessages` (`autoDeleteAt`);