CREATE TABLE `xtrRateAlertHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`alertId` int NOT NULL,
	`triggerType` enum('change','target_above','target_below') NOT NULL,
	`priceUsd` varchar(48) NOT NULL,
	`priceToman` varchar(48) NOT NULL,
	`previousUsd` varchar(48),
	`targetPriceUsd` varchar(48),
	`changeBps` int,
	`source` varchar(32) NOT NULL DEFAULT 'fragment',
	`privateDeliveryRequested` boolean NOT NULL DEFAULT false,
	`privateDelivered` boolean,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `xtrRateAlertHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `xtrRateAlerts` ADD `targetEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `xtrRateAlerts` ADD `targetPriceUsd` varchar(48);--> statement-breakpoint
ALTER TABLE `xtrRateAlerts` ADD `targetDirection` enum('above','below') DEFAULT 'above' NOT NULL;--> statement-breakpoint
ALTER TABLE `xtrRateAlerts` ADD `privateDeliveryEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `xtr_rate_alert_history_user_created_idx` ON `xtrRateAlertHistory` (`telegramUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `xtr_rate_alert_history_alert_created_idx` ON `xtrRateAlertHistory` (`alertId`,`createdAt`);