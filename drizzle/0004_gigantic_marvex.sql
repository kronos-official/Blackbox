CREATE TABLE `projectSchedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scheduleKey` varchar(96) NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`cronExpression` varchar(64) NOT NULL,
	`callbackPath` varchar(255) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectSchedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `projectSchedules_scheduleKey_unique` UNIQUE(`scheduleKey`)
);
--> statement-breakpoint
CREATE INDEX `projectSchedules_taskUid_idx` ON `projectSchedules` (`scheduleCronTaskUid`);