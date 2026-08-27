CREATE TABLE `groupStatisticsReportDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`scheduleCronTaskUid` varchar(65) NOT NULL,
	`reportDate` varchar(10) NOT NULL,
	`frequency` enum('daily','weekly','monthly') NOT NULL,
	`deliveryKey` varchar(160) NOT NULL,
	`status` enum('pending','delivered','failed') NOT NULL DEFAULT 'pending',
	`telegramMessageId` int,
	`errorMessage` varchar(512),
	`deliveredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `groupStatisticsReportDeliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_statistics_report_deliveries_key_unique` UNIQUE(`deliveryKey`)
);
--> statement-breakpoint
CREATE INDEX `group_statistics_report_deliveries_group_date_idx` ON `groupStatisticsReportDeliveries` (`groupId`,`reportDate`);--> statement-breakpoint
CREATE INDEX `group_statistics_report_deliveries_task_uid_idx` ON `groupStatisticsReportDeliveries` (`scheduleCronTaskUid`);