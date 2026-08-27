CREATE TABLE `forcedJoinDailyStats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`forcedJoinChannelId` int NOT NULL,
	`dayKey` varchar(10) NOT NULL,
	`verifiedCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `forcedJoinDailyStats_id` PRIMARY KEY(`id`),
	CONSTRAINT `forced_join_daily_channel_day_unique` UNIQUE(`forcedJoinChannelId`,`dayKey`)
);
--> statement-breakpoint
CREATE INDEX `forced_join_daily_day_idx` ON `forcedJoinDailyStats` (`dayKey`);