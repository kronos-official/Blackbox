CREATE TABLE `groupUserHourlyStats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`hourKey` varchar(13) NOT NULL,
	`dayOfWeek` int NOT NULL,
	`messageCount` int NOT NULL DEFAULT 0,
	`addedMemberCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `groupUserHourlyStats_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_user_hourly_stats_scope_hour_unique` UNIQUE(`groupId`,`telegramUserId`,`hourKey`)
);
--> statement-breakpoint
CREATE INDEX `group_user_hourly_stats_group_user_idx` ON `groupUserHourlyStats` (`groupId`,`telegramUserId`);--> statement-breakpoint
CREATE INDEX `group_user_hourly_stats_day_idx` ON `groupUserHourlyStats` (`dayOfWeek`);