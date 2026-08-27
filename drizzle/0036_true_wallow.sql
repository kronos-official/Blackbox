CREATE TABLE `xtrRateAlerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`intervalMinutes` int NOT NULL DEFAULT 15,
	`thresholdBps` int NOT NULL DEFAULT 500,
	`scheduleCronTaskUid` varchar(65),
	`lastObservedUsd` varchar(48),
	`lastCheckedAt` timestamp,
	`lastAlertedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `xtrRateAlerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `xtr_rate_alerts_user_unique` UNIQUE(`telegramUserId`)
);
--> statement-breakpoint
CREATE INDEX `xtr_rate_alerts_enabled_idx` ON `xtrRateAlerts` (`enabled`);--> statement-breakpoint
CREATE INDEX `xtr_rate_alerts_task_uid_idx` ON `xtrRateAlerts` (`scheduleCronTaskUid`);