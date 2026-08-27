CREATE TABLE `groupMemberDailyStats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`dayKey` varchar(10) NOT NULL,
	`joinedCount` int NOT NULL DEFAULT 0,
	`leftCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `groupMemberDailyStats_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_member_daily_stats_scope_day_unique` UNIQUE(`groupId`,`dayKey`)
);
--> statement-breakpoint
ALTER TABLE `groupUserDailyStats` ADD `photoCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupUserDailyStats` ADD `videoCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupUserDailyStats` ADD `documentCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupUserDailyStats` ADD `audioCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupUserDailyStats` ADD `stickerCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupUserDailyStats` ADD `voiceCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `group_member_daily_stats_group_day_idx` ON `groupMemberDailyStats` (`groupId`,`dayKey`);