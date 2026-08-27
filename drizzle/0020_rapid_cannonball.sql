CREATE TABLE `groupUserDailyStats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`dayKey` varchar(10) NOT NULL,
	`messageCount` int NOT NULL DEFAULT 0,
	`addedMemberCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `groupUserDailyStats_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_user_daily_stats_scope_day_unique` UNIQUE(`groupId`,`telegramUserId`,`dayKey`)
);
--> statement-breakpoint
CREATE INDEX `group_user_daily_stats_group_day_idx` ON `groupUserDailyStats` (`groupId`,`dayKey`);--> statement-breakpoint
CREATE INDEX `group_user_daily_stats_user_idx` ON `groupUserDailyStats` (`telegramUserId`,`dayKey`);