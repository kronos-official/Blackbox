CREATE TABLE `groupStatisticsSchedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`createdByTelegramId` bigint NOT NULL,
	`frequency` enum('daily','weekly','monthly') NOT NULL DEFAULT 'daily',
	`dayOfWeek` int NOT NULL DEFAULT 1,
	`dayOfMonth` int NOT NULL DEFAULT 1,
	`hour` int NOT NULL DEFAULT 9,
	`minute` int NOT NULL DEFAULT 0,
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Tehran',
	`enabled` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `groupStatisticsSchedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_statistics_schedules_group_unique` UNIQUE(`groupId`)
);
--> statement-breakpoint
CREATE INDEX `group_statistics_schedules_enabled_idx` ON `groupStatisticsSchedules` (`enabled`);